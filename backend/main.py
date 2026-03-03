import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from database import init_db
from routers import admin, alerts, city, events, pharmacies, reports, schedules
from utils.data_poller import start_pollers
from utils.gtfs import reload_loop

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    threading.Thread(target=reload_loop, daemon=True).start()
    start_pollers()
    yield


app = FastAPI(title="Tczewik API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(schedules.router, prefix="/schedules", tags=["schedules"])
app.include_router(city.router,      prefix="/city",      tags=["city"])
app.include_router(events.router,    prefix="/events",    tags=["events"])
app.include_router(reports.router,   prefix="/reports",   tags=["reports"])
app.include_router(admin.router,     prefix="/admin",     tags=["admin"])
app.include_router(alerts.router,      prefix="/alerts",      tags=["alerts"])
app.include_router(pharmacies.router,  prefix="/pharmacies",  tags=["pharmacies"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "tczewik-api"}


handler = Mangum(app)
