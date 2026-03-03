import csv
import io
import logging
import re
import threading
import time as time_module
import zipfile
from datetime import date, datetime, timedelta

import requests

logger = logging.getLogger(__name__)

BUS_PAGE_URL = "https://komunikacja.tczew.pl/17-2/"
BUS_GTFS_FALLBACK = "https://komunikacja.tczew.pl/wp-content/uploads/2025/12/20260101_20260307.zip"
TRAIN_GTFS_URL = "https://mkuran.pl/gtfs/polish_trains.zip"
TRAIN_RT_URL = "https://mkuran.pl/gtfs/polish_trains/updates.json"


def _parse_time(t: str) -> int:
    h, m, s = t.strip().split(":")
    return int(h) * 3600 + int(m) * 60 + int(s)


def _seconds_to_hhmm(seconds: int) -> str:
    h = seconds // 3600
    m = (seconds % 3600) // 60
    return f"{h % 24:02d}:{m:02d}"


def _read_csv_from_zip(data: bytes, filename: str) -> list[dict]:
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        with z.open(filename) as f:
            return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))


def _read_train_stop_data(data: bytes, tczew_ids: set) -> tuple[list[dict], dict[str, int]]:
    """Single pass: collect Tczew stop times + max stop_sequence per trip."""
    tczew_rows: list[dict] = []
    max_seq: dict[str, int] = {}
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        with z.open("stop_times.txt") as f:
            for row in csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")):
                tid = row["trip_id"]
                try:
                    seq = int(row.get("stop_sequence", 0))
                except ValueError:
                    seq = 0
                if seq > max_seq.get(tid, 0):
                    max_seq[tid] = seq
                if row["stop_id"] in tczew_ids:
                    tczew_rows.append({**row, "_seq": seq})
    return tczew_rows, max_seq


def _get_active_services(calendar_rows: list, calendar_dates_rows: list, target: date) -> set[str]:
    weekday_fields = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    date_str = target.strftime("%Y%m%d")
    active = set()
    for row in calendar_rows:
        start = datetime.strptime(row["start_date"], "%Y%m%d").date()
        end = datetime.strptime(row["end_date"], "%Y%m%d").date()
        if start <= target <= end and row[weekday_fields[target.weekday()]] == "1":
            active.add(row["service_id"])
    for row in calendar_dates_rows:
        if row["date"] == date_str:
            if row["exception_type"] == "1":
                active.add(row["service_id"])
            elif row["exception_type"] == "2":
                active.discard(row["service_id"])
    return active


class RTUpdates:
    """Fetches and caches GTFS-RT train delay data, refreshes every 60s."""

    def __init__(self):
        self._lock = threading.Lock()
        self._delays: dict[str, dict] = {}  # trip_id -> {stop_id -> delay_sec}
        self._last_fetch: float = 0

    def _refresh(self):
        now = time_module.time()
        if now - self._last_fetch < 60:
            return
        with self._lock:
            if time_module.time() - self._last_fetch < 60:
                return
            try:
                data = requests.get(TRAIN_RT_URL, timeout=10).json()
                delays: dict[str, dict] = {}
                for entity in data.get("entity", []):
                    tu = entity.get("tripUpdate", {})
                    tid = tu.get("trip", {}).get("tripId", "")
                    if not tid:
                        continue
                    stop_map: dict[str, int] = {}
                    for stu in tu.get("stopTimeUpdate", []):
                        sid = stu.get("stopId", "")
                        dep = stu.get("departure") or stu.get("arrival") or {}
                        stop_map[sid] = dep.get("delay", 0)
                    delays[tid] = stop_map
                self._delays = delays
                self._last_fetch = time_module.time()
                logger.info(f"GTFS-RT refreshed: {len(delays)} trip updates")
            except Exception as e:
                logger.warning(f"GTFS-RT fetch failed: {e}")

    def get_delay(self, trip_id: str, stop_ids: set) -> int | None:
        self._refresh()
        stop_map = self._delays.get(trip_id, {})
        for sid in stop_ids:
            if sid in stop_map:
                return stop_map[sid]
        return None


class BusData:
    def __init__(self):
        self.stops: dict[str, dict] = {}
        self.departures: dict[str, list] = {}
        self.loaded = False
        self.error: str | None = None

    def load(self):
        try:
            logger.info("Downloading bus GTFS...")
            url = BUS_GTFS_FALLBACK
            try:
                page = requests.get(BUS_PAGE_URL, timeout=10).text
                match = re.search(r'href="(https?://[^"]+\.zip)"', page)
                if match:
                    url = match.group(1)
            except Exception:
                logger.warning("Could not fetch bus GTFS page, using fallback URL")

            data = requests.get(url, timeout=60).content
            logger.info(f"Bus GTFS downloaded ({len(data) // 1024} KB)")

            stops = {}
            for r in _read_csv_from_zip(data, "stops.txt"):
                try:
                    lat = float(r["stop_lat"]) if r.get("stop_lat") else None
                    lon = float(r["stop_lon"]) if r.get("stop_lon") else None
                except (ValueError, KeyError):
                    lat, lon = None, None
                stops[r["stop_id"]] = {
                    "name": r["stop_name"],
                    "code": r.get("stop_code") or r["stop_id"],
                    "lat": lat,
                    "lon": lon,
                }

            routes = {
                r["route_id"]: r.get("route_short_name") or r.get("route_long_name", "")
                for r in _read_csv_from_zip(data, "routes.txt")
            }
            trips = {r["trip_id"]: r for r in _read_csv_from_zip(data, "trips.txt")}

            calendar_rows, calendar_dates_rows = [], []
            try:
                calendar_rows = _read_csv_from_zip(data, "calendar.txt")
            except Exception:
                pass
            try:
                calendar_dates_rows = _read_csv_from_zip(data, "calendar_dates.txt")
            except Exception:
                pass

            today = date.today()
            active_services = _get_active_services(calendar_rows, calendar_dates_rows, today)
            active_trips = {tid for tid, t in trips.items() if t.get("service_id") in active_services}

            departures: dict[str, list] = {}
            for row in _read_csv_from_zip(data, "stop_times.txt"):
                tid = row["trip_id"]
                if tid not in active_trips:
                    continue
                sid = row["stop_id"]
                trip = trips.get(tid, {})
                try:
                    t = _parse_time(row["departure_time"])
                except Exception:
                    continue
                departures.setdefault(sid, []).append({
                    "time_sec": t,
                    "time": _seconds_to_hhmm(t),
                    "headsign": trip.get("trip_headsign", ""),
                    "route": routes.get(trip.get("route_id", ""), ""),
                })

            for sid in departures:
                departures[sid].sort(key=lambda x: x["time_sec"])

            self.stops = stops
            self.departures = departures
            self.loaded = True
            logger.info(f"Bus GTFS loaded: {len(stops)} stops, {len(departures)} stops with departures today")

        except Exception as e:
            self.error = str(e)
            logger.error(f"Bus GTFS load failed: {e}")


class TrainData:
    def __init__(self):
        self.departures: list = []
        self.tczew_ids: set = set()
        self.loaded = False
        self.error: str | None = None

    def load(self):
        try:
            logger.info("Downloading train GTFS (may take a moment)...")
            data = requests.get(TRAIN_GTFS_URL, timeout=120).content
            logger.info(f"Train GTFS downloaded ({len(data) // 1024} KB)")

            stops_raw = _read_csv_from_zip(data, "stops.txt")
            tczew_ids = {r["stop_id"] for r in stops_raw if "tczew" in r.get("stop_name", "").lower()}
            logger.info(f"Tczew stop IDs: {tczew_ids}")

            if not tczew_ids:
                self.error = "Nie znaleziono przystanku Tczew w danych GTFS"
                return

            agencies = {}
            try:
                for r in _read_csv_from_zip(data, "agency.txt"):
                    agencies[r.get("agency_id", "")] = r.get("agency_name", "")
            except Exception:
                pass

            routes = {}
            for r in _read_csv_from_zip(data, "routes.txt"):
                routes[r["route_id"]] = {
                    "number": r.get("route_short_name", ""),
                    "name": r.get("route_long_name", ""),
                    "desc": r.get("route_desc", ""),
                    "operator": agencies.get(r.get("agency_id", ""), ""),
                }

            trips = {r["trip_id"]: r for r in _read_csv_from_zip(data, "trips.txt")}

            calendar_rows, calendar_dates_rows = [], []
            try:
                calendar_rows = _read_csv_from_zip(data, "calendar.txt")
            except Exception:
                pass
            try:
                calendar_dates_rows = _read_csv_from_zip(data, "calendar_dates.txt")
            except Exception:
                pass

            today = date.today()
            active_services = _get_active_services(calendar_rows, calendar_dates_rows, today)
            active_trips = {tid for tid, t in trips.items() if t.get("service_id") in active_services}

            # Single pass: get Tczew rows + max stop_sequence per trip
            tczew_rows, max_seq = _read_train_stop_data(data, tczew_ids)

            departures = []
            for row in tczew_rows:
                tid = row["trip_id"]
                if tid not in active_trips:
                    continue
                # Skip trains that TERMINATE at Tczew (Tczew is the last stop)
                if row["_seq"] >= max_seq.get(tid, 0):
                    continue
                trip = trips.get(tid, {})
                route_info = routes.get(trip.get("route_id", ""), {})
                try:
                    t = _parse_time(row["departure_time"])
                except Exception:
                    continue

                train_name = trip.get("trip_short_name", "") or route_info.get("desc", "") or ""

                departures.append({
                    "trip_id": tid,
                    "time_sec": t,
                    "time": _seconds_to_hhmm(t),
                    "headsign": trip.get("trip_headsign", ""),
                    "number": route_info.get("number", ""),
                    "train_name": train_name,
                    "route": route_info.get("name", ""),
                    "operator": route_info.get("operator", ""),
                })

            departures.sort(key=lambda x: x["time_sec"])
            self.departures = departures
            self.tczew_ids = tczew_ids
            self.loaded = True
            logger.info(f"Train GTFS loaded: {len(departures)} departing trains through Tczew today")

        except Exception as e:
            self.error = str(e)
            logger.error(f"Train GTFS load failed: {e}")


bus_data = BusData()
train_data = TrainData()
rt_updates = RTUpdates()


def load_all():
    bus_data.load()
    train_data.load()


def reload_loop():
    """
    Background thread — ładuje dane autobusowe (GTFS) i przeładowuje co dobę.
    Pociągi są obsługiwane przez PKP PLK API (utils/pkp_trains.py).
    """
    RETRY_DELAY   = 5 * 60   # 5 min przy błędzie
    MIDNIGHT_BUFFER = 90     # 90 s po północy

    while True:
        if not bus_data.loaded:
            bus_data.load()

        if not bus_data.loaded:
            logger.warning(
                "Dane autobusowe niedostępne (%s) — ponowna próba za %d min.",
                bus_data.error, RETRY_DELAY // 60,
            )
            time_module.sleep(RETRY_DELAY)
            bus_data.error = None
            continue

        # Załadowane — uśpij do następnej północy.
        now = datetime.now()
        next_midnight = datetime.combine(now.date() + timedelta(days=1), datetime.min.time())
        sleep_sec = (next_midnight - now).total_seconds() + MIDNIGHT_BUFFER
        logger.info("Dane autobusowe załadowane. Następne przeładowanie za %.1f h.", sleep_sec / 3600)
        time_module.sleep(sleep_sec)

        bus_data.loaded = False
        bus_data.error = None
