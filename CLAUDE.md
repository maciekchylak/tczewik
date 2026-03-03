# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Smart city dashboard for Tczew, Poland. Combines real-time public transport (bus/train GTFS), environmental data (weather, Vistula water levels, air quality), civic issue reporting, and emergency alerts aggregation.

## Development Commands

**Docker-based workflow (primary):**
```bash
make up        # Build and start all services
make down      # Stop all services
make logs      # Tail logs for all services
make restart   # Rebuild and restart everything
make clean     # Full cleanup including volumes and images
```

**Frontend standalone (inside `frontend/`):**
```bash
npm run dev    # Vite dev server
npm run build  # Production build
```

**Backend standalone (inside `backend/`):**
```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

No automated tests or lint configuration exists.

## Architecture

**Stack:** React 19 + Vite (frontend, served by Nginx) / FastAPI + SQLAlchemy (backend) / MariaDB 11 / Docker Compose

**Services:**
- Frontend: port 3000 (Nginx serving built React app)
- Backend: port 8000 (FastAPI/Uvicorn)
- MariaDB: port 3306

**Backend structure (`backend/`):**
- `main.py` — FastAPI app, mounts all routers, starts background threads on startup
- `database.py` — SQLAlchemy models (`Reports`, `Votes`, `ApiCache`) and DB initialization
- `routers/` — One file per feature: `schedules.py`, `city.py`, `events.py`, `reports.py`, `alerts.py`, `admin.py`
- `utils/data_poller.py` — Background thread scheduler (weather/water/air every 1h, events every 6h, GTFS every 2min)
- `utils/gtfs.py` — Downloads and parses GTFS zip files for bus and train schedules
- `utils/cache_db.py` — TTL-based API response caching via `ApiCache` table

**Frontend structure (`frontend/src/`):**
- `App.jsx` — React Router setup, top-level routing
- `pages/` — One component per route (Dashboard, Buses, Trains, Events, Reports, Alerts, Admin)
- Maps use Leaflet 1.9.4

## Key Data Flows

**External APIs consumed:**
- Open-Meteo (weather, no key required)
- IMGW public API (Vistula river water levels)
- GTFS feeds: `komunikacja.tczew.pl` (buses), `mkuran.pl/gtfs/` (trains)
- GDDKiA XML (road obstructions), RSO/TVP XML (crisis alerts), tczew.pl RSS (municipal news)
- AWS S3 (optional photo storage for reports, presigned URLs)

**Civic reports flow:** Client requests presigned S3 URL → uploads photo directly → submits report with `photo_key`. Votes are deduplicated via SHA256 hash of IP+User-Agent stored in `Votes` table.

**Alerts aggregation:** `/alerts` endpoint fetches all 3 sources in parallel, filters by 40km radius from Tczew center (53.7752°N, 18.7597°E).

## Environment Variables

Set in `docker-compose.yml`. Key ones:
- `SECRET_KEY` — JWT signing key (default `zmien-mnie-przed-wdrozeniem` must be changed for production)
- `ADMIN_LOGIN` / `ADMIN_PASSWORD` — Admin panel credentials (default `admin`/`admin123`)
- `DATABASE_URL` — SQLAlchemy connection string
- `REPORTS_S3_BUCKET` — Optional; if unset, photo uploads are disabled
- `BACKEND_URL` — Used by frontend Nginx proxy config
