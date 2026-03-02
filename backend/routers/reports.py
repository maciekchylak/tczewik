"""
Generyczny system zgłoszeń miejskich — backend MariaDB.
- Anonimowe zgłoszenia
- Zdjęcia via S3 presigned URLs (opcjonalne)
- System głosowania — priorytet = liczba głosów
- Statusy: new / in_progress / resolved / rejected
"""
import hashlib
import os
import uuid
from typing import Optional

import boto3
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import exc
from sqlalchemy.orm import Session

from database import Report, Vote, get_db

router = APIRouter()

S3_BUCKET  = os.getenv("REPORTS_S3_BUCKET", "")
AWS_REGION = os.getenv("AWS_DEFAULT_REGION", "us-east-1")

# ── Konfiguracja typów zgłoszeń ────────────────────────────────────────────────
# Aby dodać nowy typ — wystarczy dopisać wpis tutaj. Zero zmian w kodzie.
REPORT_TYPE_CONFIG: dict[str, dict] = {
    "pothole": {
        "label": "Dziura w drodze",
        "icon": "🕳️",
        "description": "Uszkodzenie nawierzchni drogi, dziura lub wybój",
    },
    # "broken_light": {
    #     "label": "Zepsuta latarnia",
    #     "icon": "💡",
    #     "description": "Niesprawne oświetlenie uliczne",
    # },
    # "illegal_dumping": {
    #     "label": "Dzikie wysypisko",
    #     "icon": "🗑️",
    #     "description": "Nielegalne składowanie odpadów",
    # },
}

VALID_STATUSES = {"new", "in_progress", "resolved", "rejected"}


# ── Helpers ────────────────────────────────────────────────────────────────────

def _client_hash(request: Request) -> str:
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")[:60]
    return hashlib.sha256(f"{ip}|{ua}".encode()).hexdigest()[:32]


def _photo_url(key: str) -> str:
    if not key or not S3_BUCKET:
        return ""
    return f"https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{key}"


def _serialize(r: Report) -> dict:
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
        "photo_url":    _photo_url(r.photo_key),
        "created_at":   r.created_at.isoformat() if r.created_at else None,
        "updated_at":   r.updated_at.isoformat() if r.updated_at else None,
    }


# ── Schematy ───────────────────────────────────────────────────────────────────

class ReportCreate(BaseModel):
    report_type:  str
    lat:          float = Field(..., ge=52.0, le=55.0)
    lon:          float = Field(..., ge=17.0, le=20.0)
    description:  str   = Field("", max_length=500)
    address_hint: str   = Field("", max_length=300)


class StatusUpdate(BaseModel):
    status: str
    note:   str = ""


class PhotoRequest(BaseModel):
    filename:     str = Field(..., max_length=120)
    content_type: str = Field("image/jpeg")


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("/types")
def get_report_types():
    return [{"id": k, **v} for k, v in REPORT_TYPE_CONFIG.items()]


@router.post("", status_code=201)
def create_report(body: ReportCreate, db: Session = Depends(get_db)):
    if body.report_type not in REPORT_TYPE_CONFIG:
        raise HTTPException(
            400,
            detail=f"Nieznany typ: '{body.report_type}'. Dostępne: {list(REPORT_TYPE_CONFIG.keys())}",
        )

    report = Report(
        id           = str(uuid.uuid4()),
        report_type  = body.report_type,
        lat          = body.lat,
        lon          = body.lon,
        description  = body.description,
        address_hint = body.address_hint,
        status       = "new",
        votes        = 0,
        photo_key    = "",
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return {"id": report.id, "status": report.status, "created_at": report.created_at.isoformat()}


@router.get("")
def list_reports(
    report_type: Optional[str] = Query(None),
    status:      Optional[str] = Query(None),
    sort:        str            = Query("votes", description="'votes' lub 'date'"),
    limit:       int            = Query(200, le=500),
    db:          Session        = Depends(get_db),
):
    q = db.query(Report)
    if report_type:
        q = q.filter(Report.report_type == report_type)
    if status:
        q = q.filter(Report.status == status)

    if sort == "votes":
        q = q.order_by(Report.votes.desc(), Report.created_at.desc())
    else:
        q = q.order_by(Report.created_at.desc())

    return [_serialize(r) for r in q.limit(limit).all()]


@router.get("/{report_id}")
def get_report(report_id: str, db: Session = Depends(get_db)):
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(404, detail="Zgłoszenie nie istnieje")
    return _serialize(r)


@router.post("/{report_id}/vote")
def vote_report(report_id: str, request: Request, db: Session = Depends(get_db)):
    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(404, detail="Zgłoszenie nie istnieje")

    client_hash = _client_hash(request)

    # Sprawdź czy już głosował
    existing = db.query(Vote).filter(
        Vote.report_id == report_id,
        Vote.client_hash == client_hash,
    ).first()
    if existing:
        raise HTTPException(409, detail="Już oddałeś głos na to zgłoszenie.")

    try:
        db.add(Vote(report_id=report_id, client_hash=client_hash))
        r.votes = (r.votes or 0) + 1
        db.commit()
    except exc.IntegrityError:
        db.rollback()
        raise HTTPException(409, detail="Już oddałeś głos na to zgłoszenie.")

    return {"id": report_id, "votes": r.votes, "voted": True}


@router.post("/{report_id}/photo-upload-url")
def get_photo_upload_url(report_id: str, body: PhotoRequest, db: Session = Depends(get_db)):
    if not S3_BUCKET:
        raise HTTPException(501, detail="Upload zdjęć nie jest skonfigurowany (ustaw REPORTS_S3_BUCKET)")

    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(404, detail="Zgłoszenie nie istnieje")

    ext = body.filename.rsplit(".", 1)[-1].lower() if "." in body.filename else "jpg"
    key = f"reports/{report_id}/{uuid.uuid4()}.{ext}"

    try:
        s3 = boto3.client("s3", region_name=AWS_REGION)
        upload_url = s3.generate_presigned_url(
            "put_object",
            Params={"Bucket": S3_BUCKET, "Key": key, "ContentType": body.content_type},
            ExpiresIn=300,
        )
    except Exception as e:
        raise HTTPException(502, detail=f"Błąd generowania URL: {e}")

    r.photo_key = key
    db.commit()

    return {"upload_url": upload_url, "key": key, "photo_url": _photo_url(key)}


@router.patch("/{report_id}/status")
def update_status(report_id: str, body: StatusUpdate, db: Session = Depends(get_db)):
    if body.status not in VALID_STATUSES:
        raise HTTPException(400, detail=f"Nieprawidłowy status. Dozwolone: {VALID_STATUSES}")

    r = db.query(Report).filter(Report.id == report_id).first()
    if not r:
        raise HTTPException(404, detail="Zgłoszenie nie istnieje")

    r.status      = body.status
    r.status_note = body.note
    db.commit()
    return {"id": report_id, "status": r.status}
