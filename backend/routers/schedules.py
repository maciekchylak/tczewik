from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from utils.cache_db import read_cache
from utils.gtfs import bus_data, rt_updates, train_data

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
def get_train_departures(
    limit: int = Query(60),
    db: Session = Depends(get_db),
):
    if not train_data.loaded:
        cached, _ = read_cache(db, "trains_all")
        if cached is not None:
            now = _now_sec()
            departed = [d for d in cached if d["time_sec"] < now][-2:]
            upcoming = [d for d in cached if d["time_sec"] >= now][:limit]
            return [
                {
                    "time":          d["time"],
                    "number":        d["number"],
                    "train_name":    d["train_name"],
                    "route":         d["route"],
                    "headsign":      d["headsign"],
                    "operator":      d["operator"],
                    "delay_minutes": d.get("delay_minutes"),
                    "departed":      d["time_sec"] < now,
                }
                for d in departed + upcoming
            ]
        raise HTTPException(503, detail=train_data.error or "Dane kolejowe jeszcze się ładują")

    now = _now_sec()
    all_deps = train_data.departures
    departed = [d for d in all_deps if d["time_sec"] < now][-2:]
    upcoming = [d for d in all_deps if d["time_sec"] >= now][:limit]

    result = []
    for d in departed + upcoming:
        delay_sec = rt_updates.get_delay(d["trip_id"], train_data.tczew_ids)
        delay_min = round(delay_sec / 60) if delay_sec is not None else None
        result.append({
            "time":          d["time"],
            "number":        d["number"],
            "train_name":    d["train_name"],
            "route":         d["route"],
            "headsign":      d["headsign"],
            "operator":      d["operator"],
            "delay_minutes": delay_min,
            "departed":      d["time_sec"] < now,
        })

    return result


@router.get("/status")
def get_status():
    rt_updates._refresh()
    return {
        "buses": {"loaded": bus_data.loaded, "error": bus_data.error},
        "trains": {
            "loaded": train_data.loaded,
            "error": train_data.error,
            "count": len(train_data.departures),
            "tczew_stop_ids": list(train_data.tczew_ids),
        },
        "rt": {
            "trip_updates_count": len(rt_updates._delays),
            "sample_trip_ids_static": [d["trip_id"] for d in train_data.departures[:3]],
            "sample_trip_ids_rt": list(rt_updates._delays.keys())[:3],
        },
    }
