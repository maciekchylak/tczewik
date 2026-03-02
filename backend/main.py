import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from mangum import Mangum

from routers import city, events, schedules
from utils.gtfs import load_all

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    thread = threading.Thread(target=load_all, daemon=True)
    thread.start()
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
app.include_router(city.router, prefix="/city", tags=["city"])
app.include_router(events.router, prefix="/events", tags=["events"])

# Pozostałe routery (do podpięcia później)
# from routers import auth, players, matches, rounds, standings, courts
# app.include_router(auth.router, prefix="/auth", tags=["auth"])


@app.get("/health")
def health():
    return {"status": "ok", "service": "tczewik-api"}


# AWS Lambda handler
handler = Mangum(app)
