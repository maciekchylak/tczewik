from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from utils.gtfs import bus_data, rt_updates, train_data

router = APIRouter()


@router.get("/buses/stops")
def get_bus_stops():
    if not bus_data.loaded:
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
def get_bus_departures(ids: str = Query(...), limit: int = Query(20)):
    if not bus_data.loaded:
        raise HTTPException(503, detail=bus_data.error or "Dane autobusowe jeszcze się ładują")

    stop_ids = ids.split(",")
    all_deps = []
    for sid in stop_ids:
        all_deps.extend(bus_data.departures.get(sid, []))
    all_deps.sort(key=lambda x: x["time_sec"])

    now_sec = datetime.now().hour * 3600 + datetime.now().minute * 60 + datetime.now().second
    upcoming = [d for d in all_deps if d["time_sec"] >= now_sec] or all_deps
    return [{"time": d["time"], "route": d["route"], "headsign": d["headsign"]} for d in upcoming[:limit]]


@router.get("/trains/departures")
def get_train_departures(limit: int = Query(60)):
    if not train_data.loaded:
        raise HTTPException(503, detail=train_data.error or "Dane kolejowe jeszcze się ładują")

    now_sec = datetime.now().hour * 3600 + datetime.now().minute * 60 + datetime.now().second

    # Last 2 departed + all upcoming
    all_deps = train_data.departures
    departed = [d for d in all_deps if d["time_sec"] < now_sec][-2:]
    upcoming = [d for d in all_deps if d["time_sec"] >= now_sec][:limit]

    result = []
    for d in departed + upcoming:
        delay_sec = rt_updates.get_delay(d["trip_id"], train_data.tczew_ids)
        delay_min = round(delay_sec / 60) if delay_sec is not None else None
        result.append({
            "time": d["time"],
            "number": d["number"],
            "train_name": d["train_name"],
            "route": d["route"],
            "headsign": d["headsign"],
            "operator": d["operator"],
            "delay_minutes": delay_min,
            "departed": d["time_sec"] < now_sec,
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
