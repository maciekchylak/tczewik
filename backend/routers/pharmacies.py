"""
Apteki w Tczewie — pobiera listę aptek z RSS tcz.pl i zwraca dane
z godzinami otwarcia oraz hardkodowanymi współrzędnymi GPS.
"""
import logging
import re
import xml.etree.ElementTree as ET

import requests
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import SessionLocal
from utils.cache_db import get_cached

logger = logging.getLogger(__name__)
router = APIRouter()

RSS_URL = "https://www.tcz.pl/rss/apteki/sitemap.xml"
PHARMACY_LIST_TTL = 6 * 3600   # 6 godzin
CACHE_KEY = "pharmacies_list_v2"  # zmień gdy aktualizujesz _COORDS

# ── Statyczna mapa adres → koordynaty (WGS-84) ───────────────────────────────
# Dane na podstawie OpenStreetMap / Nominatim, zweryfikowane dla Tczewa.
_COORDS = {
    "al. Solidarności 11/25":        (54.1030261, 18.7747068),
    "ul. Plac Gen.Józefa Hallera 24": (54.0870999, 18.7993310),
    "ul. Kopernika Mikołaja 1":       (54.0869383, 18.7915937),
    "ul. 30-go Stycznia 57/58":       (54.0827268, 18.7899844),
    "al. Zwycięstwa 16":              (54.0934032, 18.7860828),
    "ul. Jasia i Małgosi 8/3":        (54.0868171, 18.7720284),
    "ul. Czyżykowska 68":             (54.0770836, 18.8007436),
    "ul. Jodłowa 13A":                (54.0977949, 18.7694289),
    "ul. Jedności Narodu 16/2":       (54.0970303, 18.7811192),
    "ul. Wojska Polskiego 16A":       (54.0890250, 18.7854398),
    "ul. Armii Krajowej 19E":         (54.1003894, 18.7670494),
    "ul. Czyżykowska 37":             (54.0771435, 18.7997887),
    "ul. Franciszka Żwirki 49":       (54.0960625, 18.7672577),
    "ul. Gdańska 8C":                 (54.0952637, 18.7873356),
    "ul. Jarosława Dąbrowskiego 10":  (54.0869448, 18.7940316),
    "ul. Franciszka Żwirki 38":       (54.0975495, 18.7651139),
    "ul. Armii Krajowej 74":          (54.0988322, 18.7640520),
    "ul. Wojska Polskiego 5A":        (54.0866761, 18.7903847),
    "ul. Bartosza Głowackiego 57":    (54.0676809, 18.7671786),
    "ul. Wojska Polskiego 5":         (54.0861000, 18.7898106),
    "ul. Armii Krajowej 35":          (54.0985257, 18.7651104),
    "ul. Wojska Polskiego 22":        (54.0900346, 18.7852975),
}


def _lookup_coords(address: str):
    """Zwraca koordynaty dla podanego adresu (dopasowanie dokładne lub znormalizowane)."""
    if address in _COORDS:
        return _COORDS[address]
    norm = " ".join(address.lower().split())
    for key, coords in _COORDS.items():
        if " ".join(key.lower().split()) == norm:
            return coords
    return None, None


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _parse_description(desc: str) -> dict:
    """Parsuje opis apteki z RSS.

    Format: 'ul. Foo 1, 83-110 Tczew, tel. 123 456 789, otwarte 08:00 - 20:00'
    Warianty: 'otwarte:' lub 'otwarte ' przed godziną.
    """
    address_match = re.match(r'^(.+?),\s*\d{2}-\d{3}', desc)
    phone_match   = re.search(r'tel\.\s*([\d\s]+?)(?:,|$)', desc)
    hours_match   = re.search(
        r'otwarte[:\s]+(\d{1,2}:\d{2})\s*[-\u2013]\s*(\d{1,2}:\d{2})',
        desc, re.IGNORECASE,
    )
    return {
        "address":    address_match.group(1).strip() if address_match else desc[:80],
        "phone":      re.sub(r'\s+', ' ', phone_match.group(1)).strip() if phone_match else "",
        "open_time":  hours_match.group(1) if hours_match else None,
        "close_time": hours_match.group(2) if hours_match else None,
    }


def _fetch_pharmacies() -> list:
    """Pobiera RSS aptek i parsuje dane z godzinami otwarcia i koordynatami."""
    resp = requests.get(RSS_URL, timeout=15, headers={"User-Agent": "Tczewik/1.0"})
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    pharmacies = []

    for item in root.iter("item"):
        name = (item.findtext("title") or "").strip()
        desc = (item.findtext("description") or "").strip()
        link = (item.findtext("link") or "").strip()

        if not name or not desc:
            continue

        parsed = _parse_description(desc)
        lat, lon = _lookup_coords(parsed["address"])

        pharmacies.append({
            "name":       name,
            "address":    parsed["address"],
            "phone":      parsed["phone"],
            "open_time":  parsed["open_time"],
            "close_time": parsed["close_time"],
            "lat":        lat,
            "lon":        lon,
            "url":        link,
        })

    return pharmacies


@router.get("/list")
def get_pharmacies(db: Session = Depends(get_db)):
    """Zwraca listę aptek w Tczewie z lokalizacją i godzinami otwarcia."""
    return get_cached(
        db,
        key=CACHE_KEY,
        max_age_sec=PHARMACY_LIST_TTL,
        fetch_fn=_fetch_pharmacies,
        error_msg="Nie udało się pobrać listy aptek",
    )
