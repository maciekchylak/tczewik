"""
Połączenie z MariaDB przez SQLAlchemy.
Tabele tworzone automatycznie przy starcie aplikacji (create_all).
"""
import os
from datetime import datetime
from sqlalchemy import (
    Column, DateTime, Float, Integer, String, Text,
    create_engine, func,
)
from sqlalchemy.orm import declarative_base, sessionmaker

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "mysql+pymysql://tczewik:tczewik@mariadb:3306/tczewik",
)

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_recycle=3600,
)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
Base = declarative_base()


# ── Models ─────────────────────────────────────────────────────────────────────

class Report(Base):
    __tablename__ = "reports"

    id          = Column(String(36), primary_key=True)
    report_type = Column(String(64), nullable=False, index=True)
    lat         = Column(Float, nullable=False)
    lon         = Column(Float, nullable=False)
    description = Column(Text, default="")
    address_hint= Column(String(300), default="")
    status      = Column(String(32), default="new", index=True)
    status_note = Column(Text, default="")
    votes       = Column(Integer, default=0, index=True)
    photo_key   = Column(String(300), default="")
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class Vote(Base):
    """Przechowuje hash klienta żeby zapobiec wielokrotnemu głosowaniu."""
    __tablename__ = "votes"

    id          = Column(Integer, primary_key=True, autoincrement=True)
    report_id   = Column(String(36), nullable=False, index=True)
    client_hash = Column(String(64), nullable=False)

    __table_args__ = (
        # unikalność: jeden hash = jeden głos per zgłoszenie
        __import__("sqlalchemy").UniqueConstraint("report_id", "client_hash", name="uq_vote"),
    )


class ApiCache(Base):
    """Cache dla danych z zewnętrznych API (TTL zarządzany przez pollers)."""
    __tablename__ = "api_cache"

    key        = Column(String(100), primary_key=True)
    data       = Column(Text, nullable=False)
    fetched_at = Column(DateTime, nullable=False, default=datetime.utcnow)


def init_db():
    """Tworzy tabele jeśli nie istnieją. Wywoływane przy starcie aplikacji."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency — sesja DB na request."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
