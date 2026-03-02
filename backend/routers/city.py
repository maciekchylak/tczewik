import requests
from fastapi import APIRouter, HTTPException

router = APIRouter()

TCZEW_LAT = 53.7752
TCZEW_LON = 18.7597
HYDRO_STATION_ID = "154180150"

WATER_WARNING = 480   # stan ostrzegawczy (cm) — Tczew/Wisła
WATER_ALARM = 540     # stan alarmowy (cm)


@router.get("/weather")
def get_weather():
    try:
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
    except Exception as e:
        raise HTTPException(502, detail=f"Błąd pobierania pogody: {e}")


@router.get("/water")
def get_water():
    try:
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
    except Exception as e:
        raise HTTPException(502, detail=f"Błąd pobierania stanu wody: {e}")
