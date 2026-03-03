"""
Wątki tła odświeżające dane z zewnętrznych API i zapisujące je do api_cache.

Interwały:
  - weather, water, air  → co 1 godzinę
  - events               → co 6 godzin
  - trains, buses        → co 2 minuty
"""
import logging
import threading
import time

logger = logging.getLogger(__name__)


def _run_every(interval_sec: int, fn, name: str) -> None:
    """Uruchamia fn() w pętli co interval_sec sekund (od razu przy starcie)."""
    def loop():
        while True:
            try:
                fn()
            except Exception as e:
                logger.warning("[%s] poll failed: %s", name, e)
            time.sleep(interval_sec)

    threading.Thread(target=loop, daemon=True, name=name).start()


# ── City data (weather / water / air) ─────────────────────────────────────────

def _save_weather() -> None:
    from routers.city import _fetch_weather
    from utils.cache_db import write_cache_bg
    write_cache_bg("weather", _fetch_weather())


def _save_water() -> None:
    from routers.city import _fetch_water
    from utils.cache_db import write_cache_bg
    write_cache_bg("water", _fetch_water())


def _save_air() -> None:
    from routers.city import _fetch_air
    from utils.cache_db import write_cache_bg
    write_cache_bg("air", _fetch_air())


# ── Events ────────────────────────────────────────────────────────────────────

def _save_events() -> None:
    from routers.events import _fetch_events
    from utils.cache_db import write_cache_bg
    write_cache_bg("events", _fetch_events())


def _save_tcz_events() -> None:
    from routers.events import _fetch_tcz_events
    from utils.cache_db import write_cache_bg
    write_cache_bg("tcz_events", _fetch_tcz_events())


def _save_ckis() -> None:
    from routers.events import _fetch_ckis_events
    from utils.cache_db import write_cache_bg
    write_cache_bg("ckis_events", _fetch_ckis_events())


# ── Schedules (buses) ─────────────────────────────────────────────────────────

def _save_schedules() -> None:
    from utils.cache_db import write_cache_bg
    from utils.gtfs import bus_data

    if bus_data.loaded:
        write_cache_bg("buses_departures", bus_data.departures)
        write_cache_bg("buses_stops", bus_data.stops)
        logger.debug("Saved bus data to cache")


# ── PKP PLK trains ─────────────────────────────────────────────────────────────

def _pkp_daily() -> None:
    from utils.pkp_trains import load_pkp_daily
    load_pkp_daily()


def _pkp_rt() -> None:
    from utils.pkp_trains import refresh_pkp_rt
    refresh_pkp_rt()


# ── Public API ────────────────────────────────────────────────────────────────

def start_pollers() -> None:
    """Startuje wszystkie wątki pollujące dane. Wywoływać raz przy starcie."""
    _run_every(3600,      _save_weather,   "poll-weather")
    _run_every(3600,      _save_water,     "poll-water")
    _run_every(3600,      _save_air,       "poll-air")
    _run_every(6 * 3600,  _save_events,    "poll-events")
    _run_every(6 * 3600,  _save_tcz_events, "poll-tcz-events")
    _run_every(2 * 3600,  _save_ckis,      "poll-ckis")
    _run_every(120,       _save_schedules, "poll-schedules")
    _run_every(24 * 3600, _pkp_daily,      "poll-pkp-daily")
    _run_every(300,       _pkp_rt,         "poll-pkp-rt")
    logger.info(
        "Data pollers started (weather/water/air@1h, events@6h, tcz@6h, ckis@2h, "
        "buses@2min, pkp-schedule@24h, pkp-rt@5min)"
    )
