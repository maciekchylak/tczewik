"""
Panel administratora zgłoszeń.
- POST /admin/login  → zwraca JWT
- GET  /admin/reports → lista wszystkich zgłoszeń
- PATCH /admin/reports/{id}/status → zmiana statusu
- DELETE /admin/reports/{id} → usunięcie zgłoszenia
"""
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import Report, get_db

router = APIRouter()
security = HTTPBearer()

SECRET_KEY = os.getenv("SECRET_KEY", "dev-secret-key-change-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRE_HOURS = 12

ADMIN_LOGIN = os.getenv("ADMIN_LOGIN", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")

VALID_STATUSES = {"new", "in_progress", "resolved", "rejected"}


# ── Auth helpers ───────────────────────────────────────────────────────────────

def _create_token(username: str) -> str:
    payload = {
        "sub": username,
        "exp": datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRE_HOURS),
        "role": "admin",
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def _require_admin(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        if payload.get("role") != "admin":
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="Brak dostępu")
        return payload["sub"]
    except JWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Nieprawidłowy lub wygasły token")


# ── Schematy ───────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str


class StatusUpdate(BaseModel):
    status: str
    note: str = ""


# ── Helpers ────────────────────────────────────────────────────────────────────

def _serialize(r: Report) -> dict:
    from routers.reports import _photo_url
    return {
        "id":           r.id,
        "report_type":  r.report_type,
        "lat":          r.lat,
        "lon":          r.lon,
        "description":  r.description,
        "address_hint": r.address_hint,
        "status":       r.status,
        "status_note":  r.status_note,
        "votes":        r.votes,
        "photo_url":    _photo_url(r.photo_key or ""),
        "created_at":   r.created_at.isoformat() if r.created_at else None,
        "updated_at":   r.updated_at.isoformat() if r.updated_at else None,
    }


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post("/login")
def admin_login(body: LoginRequest):
    if body.username != ADMIN_LOGIN or body.password != ADMIN_PASSWORD:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="Nieprawidłowy login lub hasło")
    token = _create_token(body.username)
    return {"access_token": token, "token_type": "bearer", "expires_in": TOKEN_EXPIRE_HOURS * 3600}


@router.get("/reports")
def admin_list_reports(
    report_type: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    sort: str = Query("date"),
    search: Optional[str] = Query(None),
    limit: int = Query(500, le=1000),
    offset: int = Query(0),
    db: Session = Depends(get_db),
    _admin: str = Depends(_require_admin),
):
    q = db.query(Report)

    if report_type:
        q = q.filter(Report.report_type == report_type)
    if status_filter:
        q = q.filter(Report.status == status_filter)
    if search:
        term = f"%{search}%"
        q = q.filter(
            Report.description.ilike(term) |
            Report.address_hint.ilike(term)
        )

    total = q.count()

    if sort == "votes":
        q = q.order_by(Report.votes.desc(), Report.created_at.desc())
    elif sort == "status":
        q = q.order_by(Report.status, Report.created_at.desc())
    else:
        q = q.order_by(Report.created_at.desc())

    items = [_serialize(r) for r in q.offset(offset).limit(limit).all()]
    return {"total": total, "items": items}


@router.patch("/reports/{report_id}/status")
def admin_update_status(
    report_id: str,
    body: StatusUpdate,
    db: Session = Depends(get_db),
    _admin: str = Depends(_require_admin),
):
    if body.status not in VALID_STATUSES:
        raise HTTPException(400, detail=f"Nieprawidłowy status. Dozwolone: {VALID_STATUSES}")

    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(404, detail="Zgłoszenie nie istnieje")

    r.status = body.status
    r.status_note = body.note
    db.commit()
    return _serialize(r)


@router.delete("/reports/{report_id}", status_code=204)
def admin_delete_report(
    report_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(_require_admin),
):
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(404, detail="Zgłoszenie nie istnieje")

    # Usuń też powiązane głosy
    from database import Vote
    db.query(Vote).filter(Vote.report_id == report_id).delete()
    db.delete(r)
    db.commit()


@router.get("/stats")
def admin_stats(
    db: Session = Depends(get_db),
    _admin: str = Depends(_require_admin),
):
    from sqlalchemy import func
    rows = db.query(Report.status, func.count(Report.id)).group_by(Report.status).all()
    counts = {s: c for s, c in rows}
    total = sum(counts.values())
    return {
        "total": total,
        "new": counts.get("new", 0),
        "in_progress": counts.get("in_progress", 0),
        "resolved": counts.get("resolved", 0),
        "rejected": counts.get("rejected", 0),
    }
