from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from utils.cache_db import read_cache
from utils.gtfs import bus_data
from utils.pkp_trains import pkp_store

router = APIRouter()


def _now_sec() -> int:
    n = datetime.now()
    return n.hour * 3600 + n.minute * 60 + n.second


@router.get("/buses/stops")
def get_bus_stops(db: Session = Depends(get_db)):
    if not bus_data.loaded:
        stops_cached, _ = read_cache(db, "buses_stops")
        deps_cached, _  = read_cache(db, "buses_departures")
        if stops_cached is not None and deps_cached is not None:
            groups: dict[str, dict] = {}
            for sid, s in stops_cached.items():
                if sid not in deps_cached:
                    continue
                name = s["name"]
                if name not in groups:
                    groups[name] = {"name": name, "ids": [], "lat": s["lat"], "lon": s["lon"]}
                groups[name]["ids"].append(sid)
            return sorted(groups.values(), key=lambda x: x["name"])
        raise HTTPException(503, detail=bus_data.error or "Dane autobusowe jeszcze się ładują")

    groups: dict[str, dict] = {}
    for sid, s in bus_data.stops.items():
        if sid not in bus_data.departures:
            continue
        name = s["name"]
        if name not in groups:
            groups[name] = {"name": name, "ids": [], "lat": s["lat"], "lon": s["lon"]}
        groups[name]["ids"].append(sid)

    return sorted(groups.values(), key=lambda x: x["name"])


@router.get("/buses/departures")
def get_bus_departures(
    ids: str = Query(...),
    limit: int = Query(20),
    db: Session = Depends(get_db),
):
    if not bus_data.loaded:
        deps_cached, _ = read_cache(db, "buses_departures")
        if deps_cached is not None:
            stop_ids = ids.split(",")
            all_deps = []
            for sid in stop_ids:
                all_deps.extend(deps_cached.get(sid, []))
            all_deps.sort(key=lambda x: x["time_sec"])
            now = _now_sec()
            upcoming = [d for d in all_deps if d["time_sec"] >= now] or all_deps
            return [{"time": d["time"], "route": d["route"], "headsign": d["headsign"]} for d in upcoming[:limit]]
        raise HTTPException(503, detail=bus_data.error or "Dane autobusowe jeszcze się ładują")

    stop_ids = ids.split(",")
    all_deps = []
    for sid in stop_ids:
        all_deps.extend(bus_data.departures.get(sid, []))
    all_deps.sort(key=lambda x: x["time_sec"])

    now = _now_sec()
    upcoming = [d for d in all_deps if d["time_sec"] >= now] or all_deps
    return [{"time": d["time"], "route": d["route"], "headsign": d["headsign"]} for d in upcoming[:limit]]


@router.get("/trains/departures")
def get_train_departures(limit: int = Query(60)):
    if not pkp_store.loaded:
        raise HTTPException(503, detail=pkp_store.error or "Dane PKP jeszcze się ładują")
    return pkp_store.get_departures(limit)


@router.get("/status")
def get_status():
    with pkp_store._lock:
        pkp_loaded        = pkp_store.loaded
        pkp_error         = pkp_store.error
        pkp_schedule_cnt  = len(pkp_store.schedule)
        pkp_rt_cnt        = len(pkp_store.rt)
    return {
        "buses": {"loaded": bus_data.loaded, "error": bus_data.error},
        "trains": {
            "source":         "PKP PLK API",
            "loaded":         pkp_loaded,
            "error":          pkp_error,
            "schedule_count": pkp_schedule_cnt,
            "rt_count":       pkp_rt_cnt,
        },
    }
