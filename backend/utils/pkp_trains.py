"""
Integracja z oficjalnym API PKP PLK (pdp-api.plk-sa.pl).

Strategia wywołań (mieści się w limicie Basic: 100/h, 1000/dzień):
  - raz dziennie: schedules (1 call) + fullRoutes dla tras (1 duży call)
  - co 5 min:     operations bez fullRoutes (1 call, ~180KB) → opóźnienia

Stacja Tczew ID = 7112
Auth: Authorization: Bearer <PKP_API_KEY>
"""
import logging
import os
import re
import threading
from datetime import date, datetime

import requests

logger = logging.getLogger(__name__)

PKP_BASE    = "https://pdp-api.plk-sa.pl/api/v1"
TCZEW_ID    = 7112

# Symbole kategorii handlowych → czytelna etykieta
CATEGORY_LABELS = {
    "R":   "Regionalny",
    "RE":  "RegioEkspress",
    "IC":  "InterCity",
    "EIC": "Express InterCity",
    "EIP": "Express InterCity Premium",
    "TLK": "Tanie Linie Kolejowe",
    "EC":  "EuroCity",
    "EN":  "EuroNight",
    "MP":  "MiejskiPociąg",
    "KD":  "Koleje Dolnośląskie",
    "KM":  "Koleje Mazowieckie",
    "KS":  "Koleje Śląskie",
    "KW":  "Koleje Wielkopolskie",
}

# Statusy pociągu → czytelna etykieta PL
TRAIN_STATUS_LABELS = {
    "S": "Zaplanowany",
    "N": "Nie ruszył",
    "P": "W drodze",
    "C": "Zakończony",
    "F": "Ukończony",
    "X": "Odwołany",
}


class PKPTrainStore:
    """
    In-memory store z danymi pociągów. Wątkobezpieczny.

    schedule:  {orderId -> info}   — dzienny rozkład (numer, czasy, peron, tor)
    routes:    {orderId -> info}   — trasy (skąd/dokąd), z cache
    rt:        {orderId -> info}   — real-time (opóźnienia, status)
    stations:  {stationId -> name} — słownik nazw stacji
    """

    def __init__(self):
        self._lock        = threading.Lock()
        self.schedule     : dict[int, dict] = {}
        self.routes       : dict[int, dict] = {}
        self.rt           : dict[int, dict] = {}
        self.stations     : dict[str, str]  = {}
        self.disruptions  : dict[int, str]  = {}  # orderId → message
        self.loaded       = False
        self.error        : str | None      = None
        self._load_date   : str | None      = None

    # ── Internal HTTP ──────────────────────────────────────────────────────────

    def _headers(self) -> dict:
        key = os.getenv("PKP_API_KEY", "")
        return {"Authorization": f"Bearer {key}"}

    def _get(self, path: str, params: dict | None = None) -> dict:
        resp = requests.get(
            f"{PKP_BASE}{path}",
            headers=self._headers(),
            params=params,
            timeout=30,
        )
        resp.raise_for_status()
        return resp.json()

    # ── Schedule (raz dziennie) ────────────────────────────────────────────────

    def load_schedule(self) -> None:
        today = date.today().isoformat()
        logger.info("PKP: pobieranie rozkładu dla Tczewa (%s)...", today)
        data  = self._get("/schedules", {
            "stations": TCZEW_ID,
            "dateFrom": today,
            "dateTo":   today,
            "pageSize": 500,
        })
        schedule = {}
        for route in data.get("routes", []):
            oid        = route["orderId"]
            tczew_stop = next(
                (s for s in route.get("stations", []) if s["stationId"] == TCZEW_ID),
                None,
            )
            if tczew_stop is None:
                continue
            # Pomijamy pociągi, dla których Tczew to stacja końcowa (brak czasu odjazdu)
            if not tczew_stop.get("departureTime"):
                continue
            schedule[oid] = {
                "schedule_id":   route["scheduleId"],
                "order_id":      oid,
                "number":        route.get("nationalNumber", ""),
                "name":          route.get("name") or "",
                "carrier":       route.get("carrierCode", ""),
                "category":      route.get("commercialCategorySymbol", ""),
                "departure_time": tczew_stop.get("departureTime", ""),
                "arrival_time":  tczew_stop.get("arrivalTime"),
                "platform":      tczew_stop.get("departurePlatform"),
                "track":         tczew_stop.get("departureTrack"),
                "order_number":  tczew_stop.get("orderNumber", 0),
            }

        with self._lock:
            self.schedule   = schedule
            self._load_date = today
            self.loaded     = True
        logger.info("PKP: załadowano %d pociągów przez Tczew", len(schedule))

    # ── Routes (raz dziennie, jeden duży call) ─────────────────────────────────

    def load_routes_from_operations(self) -> None:
        """
        Pobiera operations z fullRoutes=true (jeden call) i wyciąga
        skąd/dokąd dla każdego pociągu w rozkładzie Tczewa.
        """
        logger.info("PKP: pobieranie tras pociągów (fullRoutes)...")
        try:
            data = self._get("/operations", {
                "stations":    TCZEW_ID,
                "withPlanned": "true",
                "fullRoutes":  "true",
                "pageSize":    2000,
            })
        except Exception as e:
            logger.warning("PKP: fullRoutes fetch failed: %s", e)
            return

        station_names: dict[str, str] = data.get("stations", {})
        routes: dict[int, dict] = {}

        with self._lock:
            schedule_ids = set(self.schedule.keys())

        for train in data.get("trains", []):
            oid = train["orderId"]
            if oid not in schedule_ids:
                continue
            stops = train.get("stations", [])
            if not stops:
                continue
            origin_id = str(stops[0]["stationId"])
            dest_id   = str(stops[-1]["stationId"])
            routes[oid] = {
                "origin":      station_names.get(origin_id, f"#{origin_id}"),
                "destination": station_names.get(dest_id,   f"#{dest_id}"),
            }

        with self._lock:
            self.routes   = routes
            self.stations = station_names
        logger.info("PKP: wyciągnięto trasy dla %d/%d pociągów", len(routes), len(schedule_ids))

    # ── Disruptions (raz dziennie) ────────────────────────────────────────────

    def load_disruptions(self) -> None:
        """Pobiera zakłócenia i buduje mapę orderId → treść komunikatu."""
        logger.info("PKP: pobieranie zakłóceń...")
        try:
            data = self._get("/disruptions", {"pageSize": 2000})
        except Exception as e:
            logger.warning("PKP: disruptions fetch failed: %s", e)
            return

        disruptions: dict[int, str] = {}
        for item in data.get("disruptions", []):
            msg = item.get("message", "").strip()
            # Odrzuć puste, zbyt krótkie i ID-like kody (np. "utr_55", "uu_123")
            if not msg or len(msg) < 15 or not re.search(r'\s', msg):
                continue
            for route in item.get("affectedRoutes", []):
                oid = route.get("orderId")
                if oid and oid not in disruptions:
                    disruptions[oid] = msg

        with self._lock:
            self.disruptions = disruptions
        logger.info("PKP: załadowano zakłócenia dla %d pociągów", len(disruptions))

    # ── Real-time (co 5 minut) ────────────────────────────────────────────────

    def refresh_rt(self) -> None:
        data = self._get("/operations", {
            "stations":    TCZEW_ID,
            "withPlanned": "true",
            "pageSize":    2000,
        })
        rt: dict[int, dict] = {}
        with self._lock:
            schedule_ids = set(self.schedule.keys())

        for train in data.get("trains", []):
            oid = train["orderId"]
            if oid not in schedule_ids:
                continue
            tczew = next(
                (s for s in train.get("stations", []) if s.get("stationId") == TCZEW_ID),
                None,
            )
            if tczew is None:
                continue
            rt[oid] = {
                "status":           train.get("trainStatus", "S"),
                "delay_dep":        tczew.get("departureDelayMinutes"),
                "delay_arr":        tczew.get("arrivalDelayMinutes"),
                "actual_departure": tczew.get("actualDeparture"),
                "actual_arrival":   tczew.get("actualArrival"),
                "confirmed":        tczew.get("isConfirmed", False),
                "cancelled":        tczew.get("isCancelled", False),
            }

        with self._lock:
            self.rt = rt
        logger.debug("PKP RT: zaktualizowano %d pociągów", len(rt))

    # ── Composite view ────────────────────────────────────────────────────────

    def get_departures(self, limit: int = 80) -> list[dict]:
        """
        Zwraca listę odjazdów ze stacji Tczew posortowaną po czasie.
        Łączy schedule + routes + RT.
        """
        now_str = datetime.now().strftime("%H:%M:%S")

        with self._lock:
            schedule     = dict(self.schedule)
            routes       = dict(self.routes)
            rt           = dict(self.rt)
            disruptions  = dict(self.disruptions)

        result = []
        for oid, info in schedule.items():
            dep_time = info["departure_time"]  # "HH:MM:SS"
            rt_info  = rt.get(oid, {})
            route    = routes.get(oid, {})

            # Pomiń pociągi z absurdalnym opóźnieniem (>8h = błąd danych)
            raw_delay = rt_info.get("delay_dep")
            if raw_delay is not None and raw_delay > 480:
                continue

            status        = rt_info.get("status", "S")
            delay_dep     = rt_info.get("delay_dep")
            cancelled     = rt_info.get("cancelled", False) or status == "X"
            confirmed     = rt_info.get("confirmed", False)
            actual_dep    = rt_info.get("actual_departure")

            carrier  = info["carrier"]
            category = info["category"]

            result.append({
                "departure_time":  dep_time[:5],        # HH:MM
                "arrival_time":    (info["arrival_time"] or "")[:5],
                "number":          info["number"],
                "name":            info["name"],
                "carrier":         carrier,
                "category":        category,
                "category_label":  CATEGORY_LABELS.get(category, category),
                "platform":        info["platform"],
                "track":           info["track"],
                "origin":          route.get("origin", ""),
                "destination":     route.get("destination", ""),
                "status":          status,
                "status_label":    TRAIN_STATUS_LABELS.get(status, status),
                "delay_minutes":   delay_dep,
                "cancelled":       cancelled,
                "confirmed":       confirmed,
                "actual_departure": actual_dep,
                "departed":        dep_time[:5] < now_str[:5] and status in ("C", "F", "P"),
                "disruption":      disruptions.get(oid),
            })

        result.sort(key=lambda x: x["departure_time"])

        # Ostatnie 2 które już odjechały + nadchodzące
        departed  = [r for r in result if r["departed"]][-2:]
        upcoming  = [r for r in result if not r["departed"]][:limit]
        return departed + upcoming


# Singleton
pkp_store = PKPTrainStore()


def load_pkp_daily() -> None:
    """Pełne załadowanie danych dziennych: schedule + trasy + zakłócenia."""
    try:
        pkp_store.load_schedule()
    except Exception as e:
        logger.error("PKP schedule load failed: %s", e)
        pkp_store.error = str(e)
        return
    try:
        pkp_store.load_routes_from_operations()
    except Exception as e:
        logger.warning("PKP routes load failed (non-fatal): %s", e)
    try:
        pkp_store.load_disruptions()
    except Exception as e:
        logger.warning("PKP disruptions load failed (non-fatal): %s", e)


def refresh_pkp_rt() -> None:
    """Odświeża tylko dane RT (opóźnienia). Wywoływane co 5 minut."""
    try:
        pkp_store.refresh_rt()
    except Exception as e:
        logger.warning("PKP RT refresh failed: %s", e)
