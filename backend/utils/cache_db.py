"""
Narzędzia do cache'owania danych z API w tabeli api_cache.
"""
import json
import logging
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy.orm import Session

from database import ApiCache, SessionLocal

logger = logging.getLogger(__name__)


def read_cache(db: Session, key: str):
    """Zwraca (data_dict, age_sec) lub (None, None) gdy brak wpisu w cache."""
    row = db.query(ApiCache).filter_by(key=key).first()
    if row is None:
        return None, None
    age_sec = (datetime.utcnow() - row.fetched_at).total_seconds()
    return json.loads(row.data), age_sec


def write_cache(db: Session, key: str, data) -> None:
    payload = json.dumps(data, ensure_ascii=False, default=str)
    row = db.query(ApiCache).filter_by(key=key).first()
    if row:
        row.data = payload
        row.fetched_at = datetime.utcnow()
    else:
        db.add(ApiCache(key=key, data=payload, fetched_at=datetime.utcnow()))
    db.commit()


def get_cached(db: Session, key: str, max_age_sec: int, fetch_fn, error_msg: str):
    """
    Główna funkcja cache:
    1. Jeśli DB ma świeże dane (< max_age_sec) — zwróć z DB.
    2. Jeśli stare/brakuje — pobierz, zapisz do DB, zwróć.
    3. Jeśli pobieranie się nie powiodło a stary cache istnieje — zwróć stary.
    4. W przeciwnym razie rzuć HTTP 502.
    """
    cached, age = read_cache(db, key)
    if cached is not None and age < max_age_sec:
        return cached
    try:
        data = fetch_fn()
        write_cache(db, key, data)
        return data
    except Exception as e:
        if cached is not None:
            logger.warning("Fetch failed [%s], returning stale (%.0fs old): %s", key, age, e)
            return cached
        raise HTTPException(502, detail=f"{error_msg}: {e}")


def write_cache_bg(key: str, data) -> None:
    """Zapisuje do cache z osobną sesją DB — do użycia w wątkach tła."""
    db = SessionLocal()
    try:
        write_cache(db, key, data)
    except Exception as e:
        logger.warning("BG cache write failed [%s]: %s", key, e)
        db.rollback()
    finally:
        db.close()
