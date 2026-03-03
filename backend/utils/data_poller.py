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
from datetime import datetime

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


# ── Schedules (trains + buses) ────────────────────────────────────────────────

def _save_schedules() -> None:
    from utils.cache_db import write_cache_bg
    from utils.gtfs import bus_data, rt_updates, train_data

    if train_data.loaded:
        now_sec = (
            datetime.now().hour * 3600
            + datetime.now().minute * 60
            + datetime.now().second
        )
        result = []
        for d in train_data.departures:
            delay_sec = rt_updates.get_delay(d["trip_id"], train_data.tczew_ids)
            delay_min = round(delay_sec / 60) if delay_sec is not None else None
            result.append({
                "time":          d["time"],
                "time_sec":      d["time_sec"],
                "number":        d["number"],
                "train_name":    d["train_name"],
                "route":         d["route"],
                "headsign":      d["headsign"],
                "operator":      d["operator"],
                "delay_minutes": delay_min,
            })
        write_cache_bg("trains_all", result)
        logger.debug("Saved %d train departures to cache", len(result))

    if bus_data.loaded:
        write_cache_bg("buses_departures", bus_data.departures)
        write_cache_bg("buses_stops", bus_data.stops)
        logger.debug("Saved bus data to cache")


# ── Public API ────────────────────────────────────────────────────────────────

def start_pollers() -> None:
    """Startuje wszystkie wątki pollujące dane. Wywoływać raz przy starcie."""
    _run_every(3600,     _save_weather,   "poll-weather")
    _run_every(3600,     _save_water,     "poll-water")
    _run_every(3600,     _save_air,       "poll-air")
    _run_every(6 * 3600, _save_events,     "poll-events")
    _run_every(6 * 3600, _save_tcz_events, "poll-tcz-events")
    _run_every(2 * 3600, _save_ckis,       "poll-ckis")
    _run_every(120,      _save_schedules,  "poll-schedules")
    logger.info("Data pollers started (weather/water/air@1h, events@6h, tcz@6h, ckis@2h, schedules@2min)")
