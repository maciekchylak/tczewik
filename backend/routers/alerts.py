"""
Alerty i powiadomienia miejskie — agregator 3 źródeł:
  1. GDDKiA   – utrudnienia drogowe (DK91, A1 węzeł Stanisławie)  [XML]
  2. RSO/TVP  – alerty kryzysowe dla woj. pomorskiego             [XML]
  3. tczew.pl – komunikaty urzędowe i aktualności                 [RSS]

Każde źródło cache'owane osobno z TTL (żeby nie hammrować zewnętrznych API).
"""
import hashlib
import logging
import math
import time
import xml.etree.ElementTree as ET
from typing import Optional

import requests
from bs4 import BeautifulSoup
from fastapi import APIRouter

logger = logging.getLogger(__name__)
router = APIRouter()

# ── Tczew coordinates ──────────────────────────────────────────────────────────
_LAT = 53.7752
_LON = 18.7597
_RADIUS_KM = 40          # promień wyszukiwania dla GDDKiA

# ── TTL cache (in-memory, per klucz) ──────────────────────────────────────────
_cache: dict = {}


def _ttl(key: str, ttl_sec: int, fn):
    now = time.time()
    if key in _cache:
        val, ts = _cache[key]
        if now - ts < ttl_sec:
            return val
    result = fn()
    _cache[key] = (result, now)
    return result


# ── Helpers ────────────────────────────────────────────────────────────────────

def _haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlon / 2) ** 2
    return R * 2 * math.asin(math.sqrt(a))


def _uid(prefix: str, *parts: str) -> str:
    h = hashlib.md5("".join(parts)[:200].encode()).hexdigest()[:10]
    return f"{prefix}-{h}"


def _txt(el, *tags) -> str:
    """Znajdź tekst pierwszego pasującego tagu w elemencie XML."""
    for tag in tags:
        for variant in (tag, tag.lower(), tag.upper()):
            v = el.findtext(variant)
            if v and v.strip():
                return v.strip()
    return ""


# ── 1. GDDKiA – utrudnienia drogowe ───────────────────────────────────────────
#
# utrdane.xml   – aktywne utrudnienia; root <utrudnienia>, item <utr>
#   <nr_drogi>  – numer drogi (np. "91", "A1")
#   <nazwa_odcinka> – opis odcinka
#   <geo_lat/geo_long> – współrzędne
#   <data_powstania>   – czas powstania
#   <typ>              – W=wypadek, U=utrudnienie, I=inne
#   <objazd>           – opis objazdu
#   <km>               – kilometraż
#
# warunkidane.xml – warunki jazdy; root <warunki>, item <warunek>
#   <nr_drogi>      – numer drogi
#   <km_od/km_do>   – zakres kilometrów
#   <warunek_kod>   – 1=bez utrudnień, >1=utrudnienia
#   <warunek_opis>  – opis słowny
#   <warunek_data>  – timestamp

_GDDKIA_UTR_URL = "https://www.archiwum.gddkia.gov.pl/dane/zima_html/utrdane.xml"
_GDDKIA_WAR_URL = "https://www.archiwum.gddkia.gov.pl/dane/zima_html/warunkidane.xml"
_GDDKIA_LINK    = "https://www.archiwum.gddkia.gov.pl"

# Promień dla utrdane.xml (ma współrzędne GPS) — obejmuje Tczew, Pelplin,
# Gniew, dojazd DK91 w kierunku Gdańska i węzeł Stanisławie na A1.
_INCIDENT_RADIUS_KM = 35

# Słowa kluczowe w nazwie odcinka — fallback gdy brak współrzędnych GPS.
_ODCINEK_KW = {
    "tczew", "tczewski", "pelplin", "gniew",
    "stanisławie", "stanislawie", "subkowy", "cedry", "morzeszczyn",
}

# Numery dróg akceptowane w trybie fallback (brak GPS w utrdane.xml).
_INCIDENT_ROADS_FALLBACK = {"91", "A1", "22"}

# Typy utrudnień → severity (W=wypadek, U=utrudnienie, I=inne)
_UTR_TYP_SEV = {"W": "critical", "U": "warning", "I": "info"}

# warunkidane.xml nie ma współrzędnych — filtrujemy po numerze drogi I zakresie km.
# DK91: km 0 (Gdańsk) → ok. km 100 (okolice Pelplina/Tczewa i dalej na południe)
# A1:   km 0 (Gdańsk) → ok. km 40 (węzeł Stanisławie i okolice)
_CONDITION_KM_RANGES: dict = {
    "91": (0.0, 100.0),
    "A1": (0.0,  40.0),
}


def _fetch_road_incidents() -> list:
    """
    Parsuje utrdane.xml.
    Podstawowa logika: współrzędne GPS w promieniu _INCIDENT_RADIUS_KM.
    Fallback gdy brak GPS: numer drogi + słowo kluczowe w nazwie odcinka.
    """
    resp = requests.get(_GDDKIA_UTR_URL, timeout=15, headers={"User-Agent": "Tczewik/1.0"})
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    alerts = []

    for item in root.iter("utr"):
        nr    = (item.findtext("nr_drogi") or "").strip()
        odcin = (item.findtext("nazwa_odcinka") or "").strip()
        km    = (item.findtext("km") or "").strip()
        objaz = (item.findtext("objazd") or "").strip()
        typ   = (item.findtext("typ") or "U").strip().upper()
        date  = (item.findtext("data_powstania") or "").strip()

        try:
            lat = float(item.findtext("geo_lat") or 0) or None
            lon = float(item.findtext("geo_long") or 0) or None
        except (TypeError, ValueError):
            lat = lon = None

        if lat and lon:
            # Współrzędne dostępne — sprawdź odległość od Tczewa.
            if _haversine(_LAT, _LON, lat, lon) > _INCIDENT_RADIUS_KM:
                continue
        else:
            # Brak GPS — akceptuj tylko znane drogi z rozpoznawalną nazwą odcinka.
            odcin_lower = odcin.lower()
            if nr.upper() not in _INCIDENT_ROADS_FALLBACK:
                continue
            if not any(kw in odcin_lower for kw in _ODCINEK_KW):
                continue

        road_label = f"DK{nr}" if nr and not nr.upper().startswith("A") else nr
        title = f"Utrudnienie {road_label}: {odcin}" if odcin else f"Utrudnienie na {road_label}"
        desc  = f"km {km}" if km else ""
        if objaz:
            desc = f"{desc} — objazd: {objaz}".strip(" —")

        alerts.append({
            "id":           _uid("utr", nr, odcin, km),
            "category":     "road",
            "severity":     _UTR_TYP_SEV.get(typ, "warning"),
            "title":        title,
            "description":  desc,
            "source":       "GDDKiA",
            "url":          _GDDKIA_LINK,
            "published_at": date or None,
        })

    return alerts


def _fetch_road_conditions() -> list:
    """
    Parsuje warunkidane.xml.
    Brak GPS — filtruje po numerze drogi I zakresie km bliskim Tczewa.
    Pomija odcinki z kodem 1 (warunki bez utrudnień).
    """
    resp = requests.get(_GDDKIA_WAR_URL, timeout=15, headers={"User-Agent": "Tczewik/1.0"})
    resp.raise_for_status()
    root = ET.fromstring(resp.content)
    alerts = []

    for item in root.iter("warunek"):
        nr   = (item.findtext("nr_drogi") or "").strip().upper()
        kod  = (item.findtext("warunek_kod") or "1").strip()
        opis = (item.findtext("warunek_opis") or "").strip()
        date = (item.findtext("warunek_data") or "").strip()

        if kod == "1":
            continue

        km_range_def = _CONDITION_KM_RANGES.get(nr)
        if km_range_def is None:
            continue

        try:
            km_od_val = float(item.findtext("km_od") or 0)
        except (TypeError, ValueError):
            km_od_val = 0.0

        km_min, km_max = km_range_def
        if not (km_min <= km_od_val <= km_max):
            continue

        km_od = (item.findtext("km_od") or "").strip()
        km_do = (item.findtext("km_do") or "").strip()
        road_label = f"DK{nr}" if not nr.startswith("A") else nr
        km_range   = f"km {km_od}–{km_do}" if km_od and km_do else ""
        title = f"Warunki drogowe {road_label}" + (f" ({km_range})" if km_range else "")

        alerts.append({
            "id":           _uid("war", nr, km_od, km_do),
            "category":     "road",
            "severity":     "warning",
            "title":        title,
            "description":  opis,
            "source":       "GDDKiA",
            "url":          _GDDKIA_LINK,
            "published_at": date or None,
        })

    return alerts


def _fetch_road() -> dict:
    alerts = []
    errors = []

    try:
        alerts += _fetch_road_incidents()
    except Exception as e:
        logger.warning("GDDKiA utrdane.xml failed: %s", e)
        errors.append(str(e))

    try:
        alerts += _fetch_road_conditions()
    except Exception as e:
        logger.warning("GDDKiA warunkidane.xml failed: %s", e)
        errors.append(str(e))

    if not alerts and errors:
        return {"ok": False, "error": "Nie udało się pobrać danych GDDKiA", "alerts": []}

    return {"ok": True, "alerts": alerts}


# ── 2. RSO – Regionalny System Ostrzegania ────────────────────────────────────
#
# komunikaty.tvp.pl XML — komunikaty dla woj. pomorskiego
# root <newses>, item <news>
#   <id>          – unikalny identyfikator
#   <title>       – tytuł komunikatu
#   <content>     – pełna treść
#   <rso_alarm>   – poziom alarmu: 1=alarm RSO (critical), 0=informacja (warning)
#   <valid_from>  – ważny od (format: "2026-03-02 09:27:00")
#   <valid_to>    – ważny do
#   <provinces><province> – województwo (już przefiltrowane przez URL)

_RSO_URL = "https://komunikaty.tvp.pl/komunikaty/pomorskie/wszystkie/0?_format=xml"


def _parse_rss_items(root: ET.Element) -> list:
    """Parsuje standardowy RSS 2.0 — zwraca listę dictów. Używane przez _fetch_city."""
    items = []
    for item in root.iter("item"):
        items.append({
            "title":    item.findtext("title") or "",
            "desc":     item.findtext("description") or "",
            "link":     item.findtext("link") or "",
            "pub_date": item.findtext("pubDate") or "",
        })
    return items


def _fetch_crisis() -> dict:
    try:
        resp = requests.get(_RSO_URL, timeout=10, headers={"User-Agent": "Tczewik/1.0"})
        resp.raise_for_status()
        root = ET.fromstring(resp.content)
        alerts = []

        for item in root.iter("news"):
            news_id   = (item.findtext("id") or "").strip()
            title     = (item.findtext("title") or "").strip()
            content   = (item.findtext("content") or "").strip()
            rso_alarm = (item.findtext("rso_alarm") or "0").strip()
            valid_from = (item.findtext("valid_from") or "").strip()
            valid_to   = (item.findtext("valid_to") or "").strip()

            severity = "critical" if rso_alarm == "1" else "warning"

            desc = content[:300]
            if valid_to:
                desc = f"{desc}\nWażny do: {valid_to}".strip()

            alerts.append({
                "id":           f"rso-{news_id}" if news_id else _uid("rso", title, valid_from),
                "category":     "crisis",
                "severity":     severity,
                "title":        title,
                "description":  desc,
                "source":       "RSO / TVP",
                "url":          "https://komunikaty.tvp.pl/komunikaty/pomorskie/wszystkie/0",
                "published_at": valid_from or None,
            })

        return {"ok": True, "alerts": alerts}

    except Exception as e:
        logger.warning("RSO failed: %s", e)
        return {"ok": False, "error": "Brak aktywnych alertów RSO dla woj. pomorskiego", "alerts": []}


# ── 3. tczew.pl – RSS komunikatów urzędowych ──────────────────────────────────

_CITY_RSS_URLS = [
    "https://www.tczew.pl/?feed=rss2",
    "https://www.tczew.pl/feed/",
]

_ALERT_KW = {
    "ważne", "wazne", "utrudnienia", "awaria", "zamknięcie", "zamkniecie",
    "komunikat", "ostrzeżenie", "ostrzezenie", "uwaga", "przerwa", "remont",
    "objazd", "zakaz",
}


def _fetch_city() -> dict:
    for url in _CITY_RSS_URLS:
        try:
            resp = requests.get(url, timeout=10, headers={"User-Agent": "Tczewik/1.0"})
            resp.raise_for_status()
            root = ET.fromstring(resp.content)
            raw_items = _parse_rss_items(root)
            alerts = []

            for r in raw_items[:30]:
                full = f"{r['title']} {r['desc']}".lower()

                # Pomijamy zwykłe aktualności — tylko ostrzeżenia i komunikaty alarmowe.
                if not any(kw in full for kw in _ALERT_KW):
                    continue

                severity = "warning"
                if any(w in full for w in ("awaria", "zamknięcie", "zamkniecie", "ostrzeżenie", "ostrzezenie", "zakaz", "niebezpieczeństwo")):
                    severity = "warning"

                desc_clean = BeautifulSoup(r["desc"], "html.parser").get_text(separator=" ")[:300].strip()

                alerts.append({
                    "id": _uid("city", r["title"], r["pub_date"]),
                    "category": "city",
                    "severity": severity,
                    "title": r["title"],
                    "description": desc_clean,
                    "source": "tczew.pl",
                    "url": r["link"] or "https://www.tczew.pl",
                    "published_at": r["pub_date"] or None,
                })

            return {"ok": True, "alerts": alerts}

        except Exception as e:
            logger.warning("tczew.pl RSS [%s] failed: %s", url, e)

    return {"ok": False, "error": "Nie udało się pobrać RSS tczew.pl", "alerts": []}


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.get("/feed")
def get_alerts():
    """
    Zwraca zagregowane alerty ze wszystkich 4 źródeł.
    Każde źródło jest cache'owane niezależnie z TTL.
    """
    road   = _ttl("alerts_road",   15 * 60, _fetch_road)
    crisis = _ttl("alerts_crisis", 10 * 60, _fetch_crisis)
    city   = _ttl("alerts_city",   30 * 60, _fetch_city)

    all_alerts = road["alerts"] + crisis["alerts"] + city["alerts"]

    def src_meta(result: dict) -> dict:
        base = {"ok": result["ok"], "count": len(result["alerts"])}
        if not result["ok"] and result.get("error"):
            base["error"] = result["error"]
        return base

    return {
        "alerts": all_alerts,
        "meta": {
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "sources": {
                "road":   src_meta(road),
                "crisis": src_meta(crisis),
                "city":   src_meta(city),
            },
        },
    }


@router.post("/cache/clear")
def clear_cache():
    """Wymuś ponowne pobranie wszystkich źródeł (admin)."""
    for key in ("alerts_road", "alerts_crisis", "alerts_city"):
        _cache.pop(key, None)
    return {"cleared": True}
