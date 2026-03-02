import html
import logging
import re
import time
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime

import requests
from fastapi import APIRouter, HTTPException

router = APIRouter()
logger = logging.getLogger(__name__)

FEED_URL = "https://www.tczew.pl/feed"
CACHE_TTL = 1800  # 30 minutes

_cache: dict = {"data": None, "fetched_at": 0.0}

DC_NS = "http://purl.org/dc/elements/1.1/"


def _strip_html(text: str) -> str:
    text = re.sub(r"<[^>]+>", " ", text)
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def _fetch_events() -> list[dict]:
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

        date_iso = None
        if pub_date:
            try:
                date_iso = parsedate_to_datetime(pub_date).date().isoformat()
            except Exception:
                pass

        items.append({
            "title": title,
            "link": link,
            "date": date_iso,
            "description": description[:220] + ("…" if len(description) > 220 else ""),
            "categories": categories,
        })

    return items[:20]


@router.get("")
def get_events():
    now = time.time()
    if _cache["data"] is not None and now - _cache["fetched_at"] < CACHE_TTL:
        return _cache["data"]
    try:
        data = _fetch_events()
        _cache["data"] = data
        _cache["fetched_at"] = now
        return data
    except Exception as e:
        if _cache["data"] is not None:
            logger.warning(f"Events fetch failed, returning stale cache: {e}")
            return _cache["data"]
        raise HTTPException(502, detail=f"Błąd pobierania wydarzeń: {e}")
