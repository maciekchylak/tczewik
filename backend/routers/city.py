import requests
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from utils.cache_db import get_cached

router = APIRouter()

TCZEW_LAT = 53.7752
TCZEW_LON = 18.7597
HYDRO_STATION_ID = "154180150"

WATER_WARNING = 480   # stan ostrzegawczy (cm) — Tczew/Wisła
WATER_ALARM = 540     # stan alarmowy (cm)


# ── Fetch functions (czysta logika, bez obsługi HTTP) ─────────────────────────

def _fetch_weather() -> dict:
    resp = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": TCZEW_LAT,
            "longitude": TCZEW_LON,
            "current": "temperature_2m,relativehumidity_2m,windspeed_10m,weathercode,precipitation",
            "daily": "weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum",
            "timezone": "Europe/Warsaw",
            "forecast_days": 5,
        },
        timeout=10,
    )
    resp.raise_for_status()
    data = resp.json()
    c = data["current"]
    d = data["daily"]
    return {
        "current": {
            "temperature": round(c["temperature_2m"], 1),
            "humidity": c["relativehumidity_2m"],
            "windspeed": round(c["windspeed_10m"], 1),
            "weathercode": c["weathercode"],
            "precipitation": c["precipitation"],
        },
        "forecast": [
            {
                "date": d["time"][i],
                "weathercode": d["weathercode"][i],
                "temp_max": round(d["temperature_2m_max"][i], 1),
                "temp_min": round(d["temperature_2m_min"][i], 1),
                "precipitation": round(d["precipitation_sum"][i], 1),
            }
            for i in range(len(d["time"]))
        ],
    }


def _fetch_water() -> dict:
    resp = requests.get(
        "https://danepubliczne.imgw.pl/api/data/hydro",
        timeout=10,
    )
    resp.raise_for_status()
    stations = resp.json()
    s = next(
        (x for x in stations if str(x.get("id_stacji", "")) == HYDRO_STATION_ID),
        None,
    )
    if s is None:
        raise ValueError(f"Nie znaleziono stacji {HYDRO_STATION_ID}")
    raw = s.get("stan_wody")
    level = int(raw) if raw not in (None, "", "0") else None

    if level is None:
        status = "unknown"
    elif level < 200:
        status = "low"
    elif level < WATER_WARNING:
        status = "normal"
    elif level < WATER_ALARM:
        status = "warning"
    else:
        status = "alarm"

    return {
        "level_cm": level,
        "updated": s.get("stan_wody_data_pomiaru"),
        "status": status,
        "warning_level": WATER_WARNING,
        "alarm_level": WATER_ALARM,
    }


GIOS_STATION_ID = 20607  # Tczew, ul. Czyżykowska (jedyna aktywna stacja w Tczewie)
GIOS_STATION_NAME = "Tczew, ul. Czyżykowska"

# Normy dobowe wg rozporządzenia MŚ (µg/m³)
_NORMS = {"PM10": 50.0, "PM2.5": 25.0, "NO2": 200.0, "O3": 120.0, "SO2": 350.0}


def _latest_sensor_value(sensor_id: int) -> float | None:
    """Pobiera najnowszy niezerowy pomiar dla danego czujnika."""
    resp = requests.get(
        f"https://api.gios.gov.pl/pjp-api/v1/rest/data/getData/{sensor_id}",
        timeout=10,
    )
    resp.raise_for_status()
    entries = resp.json().get("Lista danych pomiarowych", [])
    for entry in entries:
        v = entry.get("Warto\u015b\u0107")
        if v is not None:
            return round(float(v), 1)
    return None


def _fetch_air() -> dict:
    # 1. Pobierz indeks jakości powietrza
    resp = requests.get(
        f"https://api.gios.gov.pl/pjp-api/v1/rest/aqindex/getIndex/{GIOS_STATION_ID}",
        timeout=10,
    )
    resp.raise_for_status()
    # API zwraca dane opakowane w klucz "AqIndex"
    d = resp.json().get("AqIndex", {})

    def parse_pollutant(code: str):
        # GIOS API ma literówkę: "Wartość..." używa wskaźnika (ź=U+017A),
        # a "Nazwa kategorii..." używa wskaŻnika (ż=U+017C) — niespójność w API.
        val = d.get(f"Warto\u015b\u0107 indeksu dla wska\u017anika {code}")
        cat = d.get(f"Nazwa kategorii indeksu dla wska\u017cnika {code}")
        if val is None:
            return None
        return {"index": val, "category": cat}

    # 2. Pobierz czujniki stacji i rzeczywiste wartości w µg/m³
    sensors_resp = requests.get(
        f"https://api.gios.gov.pl/pjp-api/v1/rest/station/sensors/{GIOS_STATION_ID}",
        timeout=10,
    )
    sensor_values: dict[str, float | None] = {}
    if sensors_resp.ok:
        for s in sensors_resp.json().get("Lista stanowisk pomiarowych dla podanej stacji", []):
            code = s.get("Wska\u017anik - kod")  # "PM10", "PM2.5" itp.
            sid  = s.get("Identyfikator stanowiska")
            if code and sid:
                try:
                    sensor_values[code] = _latest_sensor_value(sid)
                except Exception:
                    sensor_values[code] = None

    def build_pollutant(code: str):
        base = parse_pollutant(code)
        if base is None:
            return None
        value = sensor_values.get(code)
        norm  = _NORMS.get(code)
        base["value_ugm3"] = value
        base["norm_ugm3"]  = norm
        if value is not None and norm:
            base["pct_of_norm"] = round(value / norm * 100)
        return base

    return {
        "index":              d.get("Warto\u015b\u0107 indeksu"),
        "category":           d.get("Nazwa kategorii indeksu"),
        "critical_pollutant": d.get("Kod zanieczyszczenia krytycznego"),
        "updated":            d.get("Data wykonania oblicze\u0144 indeksu"),
        "station":            GIOS_STATION_NAME,
        "pm10":               build_pollutant("PM10"),
        "pm25":               build_pollutant("PM2.5"),
        "no2":                build_pollutant("NO2"),
        "o3":                 build_pollutant("O3"),
        "so2":                build_pollutant("SO2"),
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/weather")
def get_weather(db: Session = Depends(get_db)):
    return get_cached(db, "weather", 3600, _fetch_weather, "Błąd pobierania pogody")


@router.get("/water")
def get_water(db: Session = Depends(get_db)):
    return get_cached(db, "water", 3600, _fetch_water, "Błąd pobierania stanu wody")


@router.get("/air")
def get_air_quality(db: Session = Depends(get_db)):
    return get_cached(db, "air", 3600, _fetch_air, "Błąd pobierania jakości powietrza")
