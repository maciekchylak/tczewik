import hashlib
import html
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from email.utils import parsedate_to_datetime

import requests
from fastapi import APIRouter, Depends, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import EventVote, get_db
from utils.cache_db import read_cache, write_cache

router = APIRouter()
logger = logging.getLogger(__name__)

FEED_URL = "https://www.tczew.pl/feed"
CKIS_SITEMAP_URL = "https://ckis.tczew.pl/sitemap.xml"
TCZ_FEED_URLS = [
    "https://www.tcz.pl/rss/wszystkie/",
    "https://www.tcz.pl/rss/imprezy/sitemap.xml",
]
CULTURAL_CATEGORIES = {"Kultura", "Sport", "Dla Dzieci", "Aktualności"}


def _parse_date(raw: str) -> str | None:
    """Parsuje datę w formacie RFC 2822 lub ISO 8601 i zwraca YYYY-MM-DD."""
    if not raw:
        return None
    # ISO 8601: 2026-03-03T14:34:00+01:00
    try:
        return datetime.fromisoformat(raw).date().isoformat()
    except ValueError:
        pass
    # RFC 2822: Mon, 03 Mar 2026 14:34:00 +0100
    try:
        return parsedate_to_datetime(raw).date().isoformat()
    except Exception:
        return None


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _client_hash(request: Request) -> str:
    ip = request.client.host if request.client else "unknown"
    ua = request.headers.get("user-agent", "")[:60]
    return hashlib.sha256(f"{ip}|{ua}".encode()).hexdigest()[:32]


def _event_hash(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:32]


def _fetch_events() -> list:
    resp = requests.get(FEED_URL, timeout=10, headers={"User-Agent": "Tczewik/1.0"})
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    channel = root.find("channel")
    if channel is None:
        return []

    items = []
    for item in channel.findall("item"):
        title = _strip_html(item.findtext("title", ""))
        link = item.findtext("link", "").strip()
        pub_date = item.findtext("pubDate", "").strip()
        description = _strip_html(item.findtext("description", ""))
        categories = [
            c.text.strip() for c in item.findall("category") if c.text and c.text.strip()
        ]

        if not any(c in CULTURAL_CATEGORIES for c in categories):
            continue

        items.append({
            "id": _event_hash(link),
            "title": title,
            "link": link,
            "date": _parse_date(pub_date),
            "description": description[:220] + ("…" if len(description) > 220 else ""),
            "categories": categories,
            "source": "tczew.pl",
        })

    return items[:20]


def _parse_tcz_feed(content: bytes) -> list:
    """Parsuje jeden feed tcz.pl (RSS lub sitemap XML) i zwraca listę wydarzeń."""
    root = ET.fromstring(content)

    # Standardowe RSS (<channel><item>...)
    channel = root.find("channel")
    if channel is not None:
        items = []
        for item in channel.findall("item"):
            title = _strip_html(item.findtext("title", ""))
            link = item.findtext("link", "").strip()
            pub_date = item.findtext("pubDate", "").strip()
            description = _strip_html(item.findtext("description", ""))
            categories = [c.text.strip() for c in item.findall("category") if c.text and c.text.strip()]
            if not title and not link:
                continue
            items.append({
                "id": _event_hash(link or title),
                "title": title,
                "link": link,
                "date": _parse_date(pub_date),
                "description": description[:220] + ("…" if len(description) > 220 else ""),
                "categories": categories or ["tcz.pl"],
                "source": "tcz.pl",
            })
        return items

    # Sitemap XML (<urlset><url><loc>...)
    SM = "http://www.sitemaps.org/schemas/sitemap/0.9"
    urls = root.findall(f"{{{SM}}}url") or root.findall("url")
    items = []
    for url_el in urls:
        loc = (url_el.findtext(f"{{{SM}}}loc") or url_el.findtext("loc") or "").strip()
        lastmod = (url_el.findtext(f"{{{SM}}}lastmod") or url_el.findtext("lastmod") or "").strip()
        if not loc:
            continue
        slug = loc.rstrip("/").rsplit("/", 1)[-1].replace("-", " ").replace("_", " ")
        title = slug.capitalize() if slug else loc
        date_iso = lastmod[:10] if len(lastmod) >= 10 else None
        items.append({
            "id": _event_hash(loc),
            "title": title,
            "link": loc,
            "date": date_iso,
            "description": "",
            "categories": ["Imprezy"],
            "source": "tcz.pl",
        })
    return items


def _fetch_tcz_events() -> list:
    seen: set = set()
    result = []
    for url in TCZ_FEED_URLS:
        try:
            resp = requests.get(url, timeout=10, headers={"User-Agent": "Tczewik/1.0"})
            resp.raise_for_status()
            for item in _parse_tcz_feed(resp.content):
                if item["id"] not in seen:
                    seen.add(item["id"])
                    result.append(item)
        except Exception as e:
            logger.warning("Failed to fetch tcz.pl feed %s: %s", url, e)
    return result[:40]


_CKIS_SKIP_SEGMENTS = {
    "o-nas", "kontakt", "historia", "galeria", "regulamin",
    "deklaracja", "polityka", "cookies", "mapa-strony", "404",
}


def _fetch_ckis_events() -> list:
    from urllib.parse import urlparse
    try:
        resp = requests.get(CKIS_SITEMAP_URL, timeout=10, headers={"User-Agent": "Tczewik/1.0"})
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
    except Exception as e:
        logger.warning("CKiS sitemap fetch failed: %s", e)
        return []

    SM = "http://www.sitemaps.org/schemas/sitemap/0.9"
    url_els = root.findall(f"{{{SM}}}url") or root.findall("url")
    items = []
    for url_el in url_els:
        loc = (url_el.findtext(f"{{{SM}}}loc") or url_el.findtext("loc") or "").strip()
        lastmod = (url_el.findtext(f"{{{SM}}}lastmod") or url_el.findtext("lastmod") or "").strip()
        if not loc:
            continue

        segments = [s for s in urlparse(loc).path.strip("/").split("/") if s]
        # Tylko podstrony (min. 2 segmenty), z pominięciem statycznych sekcji
        if len(segments) < 2 or segments[0] in _CKIS_SKIP_SEGMENTS:
            continue

        slug = segments[-1].replace("-", " ").replace("_", " ")
        date_iso = lastmod[:10] if len(lastmod) >= 10 else None
        items.append({
            "id": _event_hash(loc),
            "title": slug.capitalize(),
            "link": loc,
            "date": date_iso,
            "description": "",
            "categories": ["CKiS"],
            "source": "ckis",
        })

    items.sort(key=lambda x: x["date"] or "", reverse=True)
    return items[:20]


@router.get("")
def get_events(
    sort: str = "latest",
    source: str = "all",
    request: Request = None,
    db: Session = Depends(get_db),
):
    # Read tczew.pl events from cache; fetch fresh if missing
    tczew_events, _ = read_cache(db, "events")
    if tczew_events is None:
        try:
            tczew_events = _fetch_events()
            write_cache(db, "events", tczew_events)
        except Exception as e:
            logger.warning("Failed to fetch tczew events: %s", e)
            tczew_events = []

    # Read CKiS events from cache (populated by background poller)
    ckis_events, _ = read_cache(db, "ckis_events")
    if ckis_events is None:
        ckis_events = []

    # Read tcz.pl events from cache; fetch fresh if missing
    tcz_events, _ = read_cache(db, "tcz_events")
    if tcz_events is None:
        try:
            tcz_events = _fetch_tcz_events()
            write_cache(db, "tcz_events", tcz_events)
        except Exception as e:
            logger.warning("Failed to fetch tcz.pl events: %s", e)
            tcz_events = []

    all_events = list(tczew_events) + list(ckis_events) + list(tcz_events)

    # Vote counts per event_hash
    vote_counts = dict(
        db.query(EventVote.event_hash, func.count(EventVote.id))
        .group_by(EventVote.event_hash)
        .all()
    )

    # Current user's voted hashes
    user_voted_hashes: set = set()
    if request:
        ch = _client_hash(request)
        user_voted_hashes = {
            row.event_hash
            for row in db.query(EventVote).filter_by(client_hash=ch).all()
        }

    # Enrich each event with vote data
    for ev in all_events:
        ev_id = ev.get("id", "")
        ev["votes"] = vote_counts.get(ev_id, 0)
        ev["user_voted"] = ev_id in user_voted_hashes

    # Filter by source
    if source != "all":
        all_events = [e for e in all_events if e.get("source") == source]

    # Sort
    if sort == "popular":
        all_events.sort(key=lambda e: e["votes"], reverse=True)
    else:
        all_events.sort(key=lambda e: (e.get("date") or ""), reverse=True)

    return all_events


@router.post("/{event_hash}/vote")
def vote_event(event_hash: str, request: Request, db: Session = Depends(get_db)):
    ch = _client_hash(request)
    existing = db.query(EventVote).filter_by(event_hash=event_hash, client_hash=ch).first()
    if existing:
        db.delete(existing)
        db.commit()
        count = db.query(EventVote).filter_by(event_hash=event_hash).count()
        return {"event_hash": event_hash, "votes": count, "voted": False}
    else:
        db.add(EventVote(event_hash=event_hash, client_hash=ch))
        db.commit()
        count = db.query(EventVote).filter_by(event_hash=event_hash).count()
        return {"event_hash": event_hash, "votes": count, "voted": True}
