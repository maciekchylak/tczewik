import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { getWeather, getWaterLevel, getAirQuality } from '../api/city'
import { getBusStops, getBusDepartures, getTrainDepartures } from '../api/schedules'
import './Dashboard.css'

const STOPS_KEY = 'tczewik_bus_stops'

const TRAIN_CAT_COLOR = {
  IC: '#c0392b', EIC: '#922b21', EIP: '#6e1f18',
  TLK: '#1a5276', EC: '#1a5276', EN: '#154360',
  RE: '#1d6a4a', R: '#196f3d',
}

const WMO = {
  0:  ['☀️', 'Bezchmurnie'],
  1:  ['🌤️', 'Przeważnie pogodnie'],
  2:  ['⛅', 'Częściowe zachmurzenie'],
  3:  ['☁️', 'Zachmurzenie'],
  45: ['🌫️', 'Mgła'],
  48: ['🌫️', 'Mgła z szronem'],
  51: ['🌦️', 'Lekka mżawka'],
  53: ['🌦️', 'Mżawka'],
  55: ['🌧️', 'Gęsta mżawka'],
  61: ['🌧️', 'Lekki deszcz'],
  63: ['🌧️', 'Deszcz'],
  65: ['🌧️', 'Silny deszcz'],
  71: ['🌨️', 'Lekki śnieg'],
  73: ['🌨️', 'Śnieg'],
  75: ['❄️', 'Intensywny śnieg'],
  80: ['🌦️', 'Przelotne opady'],
  81: ['🌧️', 'Opady przelotne'],
  82: ['⛈️', 'Silne opady'],
  85: ['🌨️', 'Przelotny śnieg'],
  95: ['⛈️', 'Burza'],
  96: ['⛈️', 'Burza z gradem'],
  99: ['⛈️', 'Silna burza z gradem'],
}

const DAY_NAMES = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'Sb']

function wmo(code) {
  return WMO[code] ?? ['🌡️', 'Nieznane']
}

function formatDate(iso) {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Dziś'
  if (d.toDateString() === tomorrow.toDateString()) return 'Jutro'
  return DAY_NAMES[d.getDay()]
}

const WATER_STATUS = {
  low:     { label: 'Niski stan',     color: '#3b82f6', bg: '#eff6ff' },
  normal:  { label: 'Normalny stan',  color: '#16a34a', bg: '#f0fdf4' },
  warning: { label: 'Podwyższony',    color: '#d97706', bg: '#fffbeb' },
  alarm:   { label: '⚠️ Alarm',       color: '#dc2626', bg: '#fef2f2' },
  unknown: { label: 'Brak danych',    color: '#94a3b8', bg: '#f8fafc' },
}

function WeatherWidget() {
  const [data, setData] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getWeather().then(setData).catch(e => setError(e.message))
  }, [])

  if (error) return <div className="widget-error">⚠️ {error}</div>
  if (!data) return <div className="widget-loading">Ładowanie pogody…</div>

  const [icon, label] = wmo(data.current.weathercode)

  return (
    <div className="widget weather-widget">
      <div className="widget-header">
        <span className="widget-title">Pogoda w Tczewie</span>
        <span className="widget-source">Open-Meteo</span>
      </div>

      <div className="weather-current">
        <span className="weather-icon">{icon}</span>
        <div className="weather-main">
          <span className="weather-temp">{data.current.temperature}°C</span>
          <span className="weather-label">{label}</span>
        </div>
        <div className="weather-details">
          <span>💨 {data.current.windspeed} km/h</span>
          <span>💧 {data.current.humidity}%</span>
          {data.current.precipitation > 0 && (
            <span>🌧️ {data.current.precipitation} mm</span>
          )}
        </div>
      </div>

      <button
        className="expand-btn"
        onClick={() => setExpanded(e => !e)}
      >
        {expanded ? '▲ Zwiń prognozę' : '▼ Prognoza na 5 dni'}
      </button>

      {expanded && (
        <div className="forecast-grid">
          {data.forecast.map((day, i) => {
            const [fi, fl] = wmo(day.weathercode)
            return (
              <div key={i} className={`forecast-day ${i === 0 ? 'forecast-today' : ''}`}>
                <span className="forecast-day-name">{formatDate(day.date)}</span>
                <span className="forecast-icon">{fi}</span>
                <span className="forecast-label">{fl}</span>
                <span className="forecast-temps">
                  <span className="temp-max">{day.temp_max}°</span>
                  <span className="temp-min">{day.temp_min}°</span>
                </span>
                {day.precipitation > 0 && (
                  <span className="forecast-precip">🌧️ {day.precipitation} mm</span>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function WaterWidget() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getWaterLevel().then(setData).catch(e => setError(e.message))
  }, [])

  if (error) return <div className="widget-error">⚠️ {error}</div>
  if (!data) return <div className="widget-loading">Ładowanie stanu wody…</div>

  const status = WATER_STATUS[data.status] ?? WATER_STATUS.unknown
  const pct = data.level_cm
    ? Math.min(100, Math.round((data.level_cm / (data.alarm_level * 1.2)) * 100))
    : 0

  const updatedTime = data.updated
    ? new Date(data.updated).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="widget water-widget">
      <div className="widget-header">
        <span className="widget-title">🌊 Wisła w Tczewie</span>
        <span className="widget-source">IMGW</span>
      </div>

      <div className="water-main">
        <span className="water-level">{data.level_cm} <small>cm</small></span>
        <span
          className="water-status-badge"
          style={{ background: status.bg, color: status.color }}
        >
          {status.label}
        </span>
      </div>

      <div className="water-gauge-wrap">
        <div className="water-gauge-track">
          <div
            className="water-gauge-fill"
            style={{
              width: `${pct}%`,
              background: data.status === 'alarm' ? '#dc2626'
                : data.status === 'warning' ? '#f59e0b'
                : data.status === 'low' ? '#3b82f6'
                : '#22c55e',
            }}
          />
          <div
            className="gauge-marker"
            style={{ left: `${Math.round((data.warning_level / (data.alarm_level * 1.2)) * 100)}%` }}
            title={`Ostrzeżenie: ${data.warning_level} cm`}
          />
          <div
            className="gauge-marker gauge-marker-alarm"
            style={{ left: `${Math.round((data.alarm_level / (data.alarm_level * 1.2)) * 100)}%` }}
            title={`Alarm: ${data.alarm_level} cm`}
          />
        </div>
        <div className="water-gauge-labels">
          <span>0 cm</span>
          <span style={{ color: '#d97706' }}>↑ {data.warning_level} cm</span>
          <span style={{ color: '#dc2626' }}>↑ {data.alarm_level} cm</span>
        </div>
      </div>

      {updatedTime && (
        <div className="water-updated">Aktualizacja: {updatedTime}</div>
      )}
    </div>
  )
}

// GIOŚ indeks: 0=Bardzo dobry … 5=Bardzo zły
const AIR_INDEX_STYLE = {
  0: { color: '#16a34a', bg: '#f0fdf4' },
  1: { color: '#65a30d', bg: '#f7fee7' },
  2: { color: '#d97706', bg: '#fffbeb' },
  3: { color: '#ea580c', bg: '#fff7ed' },
  4: { color: '#dc2626', bg: '#fef2f2' },
  5: { color: '#7c3aed', bg: '#f5f3ff' },
}

const POLLUTANT_LABEL = {
  PYL:  'pyły (PM)',
  PM10: 'PM10',
  PM25: 'PM2.5',
  NO2:  'NO₂',
  O3:   'O₃',
  SO2:  'SO₂',
}

function AirQualityWidget() {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    getAirQuality().then(setData).catch(e => setError(e.message))
  }, [])

  if (error) return <div className="widget-error">⚠️ {error}</div>
  if (!data) return <div className="widget-loading">Ładowanie jakości powietrza…</div>

  const style = AIR_INDEX_STYLE[data.index] ?? { color: '#94a3b8', bg: '#f8fafc' }
  const pollutants = [
    { key: 'pm10', label: 'PM10' },
    { key: 'pm25', label: 'PM2.5' },
    { key: 'no2',  label: 'NO₂' },
    { key: 'o3',   label: 'O₃' },
    { key: 'so2',  label: 'SO₂' },
  ].filter(p => data[p.key] != null)

  const criticalLabel = data.critical_pollutant
    ? POLLUTANT_LABEL[data.critical_pollutant] ?? data.critical_pollutant
    : null

  return (
    <div className="widget air-quality-widget">
      <div className="widget-header">
        <span className="widget-title">Jakość powietrza</span>
        <span className="widget-source">GIOŚ</span>
      </div>

      <div className="air-quality-main">
        <span
          className="air-quality-badge"
          style={{ background: style.bg, color: style.color }}
        >
          {data.category ?? 'Brak danych'}
        </span>
        {criticalLabel && (
          <span className="air-quality-critical">Krytyczny: {criticalLabel}</span>
        )}
      </div>

      {pollutants.length > 0 && (
        <div className="air-pollutants">
          {pollutants.map(p => {
            const item = data[p.key]
            const pct  = item.pct_of_norm ?? null
            const barColor = pct == null ? '#94a3b8'
              : pct > 100 ? '#dc2626'
              : pct > 75  ? '#f59e0b'
              : '#22c55e'
            return (
              <div key={p.key} className="air-pollutant-row">
                <div className="air-pollutant-header">
                  <span className="air-pollutant-name">{p.label}</span>
                  <span className="air-pollutant-value">
                    {item.value_ugm3 != null
                      ? <><strong>{item.value_ugm3}</strong> µg/m³</>
                      : <em>{item.category}</em>
                    }
                  </span>
                  {item.norm_ugm3 && (
                    <span className="air-pollutant-norm">
                      norma {item.norm_ugm3} µg/m³
                    </span>
                  )}
                </div>
                {pct != null && (
                  <div className="air-pollutant-bar-track">
                    <div
                      className="air-pollutant-bar-fill"
                      style={{ width: `${Math.min(pct, 100)}%`, background: barColor }}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {data.updated && (
        <div className="water-updated">{data.station} · {data.updated}</div>
      )}
    </div>
  )
}

// ── Widget autobusów ──────────────────────────────────────────────────────────

function BusWidget() {
  const navigate = useNavigate()

  // [stopTam, stopPowrot] — każdy: null | {name, ids}
  const [stops, setStops] = useState(() => {
    try {
      const s = JSON.parse(localStorage.getItem(STOPS_KEY))
      return Array.isArray(s) && s.length === 2 ? s : [null, null]
    } catch { return [null, null] }
  })
  const [allStops, setAllStops] = useState([])
  const [search, setSearch]     = useState('')
  const [picking, setPicking]   = useState(null) // null | 0 | 1
  const [deps, setDeps]         = useState([[], []])

  // Lista przystanków — pobierz raz gdy otworzono picker
  useEffect(() => {
    if (picking === null || allStops.length > 0) return
    getBusStops().then(setAllStops).catch(() => {})
  }, [picking, allStops.length])

  // Odjazdy — odświeżaj co 30 s gdy któryś przystanek jest ustawiony
  useEffect(() => {
    const fetchSlot = (idx) => {
      const s = stops[idx]
      if (!s) return Promise.resolve([])
      return getBusDepartures(s.ids).then(d => d.slice(0, 3)).catch(() => [])
    }
    const run = () => Promise.all([fetchSlot(0), fetchSlot(1)]).then(setDeps)
    run()
    const id = setInterval(run, 30_000)
    return () => clearInterval(id)
  }, [stops])

  const openPicker = (idx) => { setSearch(''); setPicking(idx) }
  const closePicker = () => { setPicking(null); setSearch('') }

  const selectStop = (s) => {
    const saved = { name: s.name, ids: s.ids.join(',') }
    const next = [...stops]
    next[picking] = saved
    localStorage.setItem(STOPS_KEY, JSON.stringify(next))
    setStops(next)
    const nextDeps = [...deps]; nextDeps[picking] = []
    setDeps(nextDeps)
    closePicker()
  }

  // ── Picker ─────────────────────────────────────────────
  if (picking !== null) {
    const filtered = allStops.filter(s =>
      !search || s.name.toLowerCase().includes(search.toLowerCase())
    )
    return (
      <div className="widget">
        <div className="widget-header">
          <span className="widget-title">
            🚌 {picking === 0 ? 'Przystanek — tam' : 'Przystanek — z powrotem'}
          </span>
          <button className="widget-close-btn" onClick={closePicker}>✕</button>
        </div>
        <div className="quick-search-wrap">
          <input
            className="quick-search"
            placeholder="Szukaj przystanku…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="quick-stop-list">
          {allStops.length === 0 && <div className="widget-loading">Ładowanie przystanków…</div>}
          {filtered.slice(0, 25).map(s => (
            <button key={s.name} className="quick-stop-item" onClick={() => selectStop(s)}>
              {s.name}
            </button>
          ))}
          {allStops.length > 0 && filtered.length === 0 && (
            <div className="quick-stop-empty">Brak wyników</div>
          )}
        </div>
      </div>
    )
  }

  // ── Dwa sloty ──────────────────────────────────────────
  const Slot = ({ idx, label }) => {
    const stop     = stops[idx]
    const slotDeps = deps[idx]
    return (
      <div className="bus-slot">
        <div className="bus-slot-header">
          <span className="bus-slot-label">{label}</span>
          <button className="widget-stop-btn" onClick={() => openPicker(idx)}>
            {stop ? stop.name : 'Ustaw →'}
          </button>
        </div>
        {!stop && (
          <div className="bus-slot-empty">
            <button className="transport-pick-btn" onClick={() => openPicker(idx)}>
              Wybierz przystanek
            </button>
          </div>
        )}
        {stop && slotDeps.length === 0 && (
          <div className="widget-loading">Brak odjazdów</div>
        )}
        {slotDeps.length > 0 && (
          <div className="transport-deps">
            {slotDeps.map((d, i) => (
              <div key={i} className="transport-dep-row">
                <span className="transport-dep-time">{d.time}</span>
                <span className="transport-dep-route">{d.route}</span>
                <span className="transport-dep-head">{d.headsign}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="widget widget-full">
      <div className="widget-header">
        <span className="widget-title">🚌 Autobusy</span>
        <button className="widget-nav-btn" onClick={() => navigate('/buses')}>
          Pełny rozkład →
        </button>
      </div>
      <div className="bus-slots">
        <Slot idx={0} label="Tam →" />
        <div className="bus-slot-divider" />
        <Slot idx={1} label="← Z powrotem" />
      </div>
    </div>
  )
}

// ── Widget pociągów ───────────────────────────────────────────────────────────

function TrainWidget() {
  const navigate = useNavigate()
  const [deps, setDeps]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetch = () => {
      getTrainDepartures()
        .then(data => {
          setDeps(data.filter(d => !d.departed).slice(0, 3))
          setError(null)
        })
        .catch(e => setError(e.message))
        .finally(() => setLoading(false))
    }
    fetch()
    const id = setInterval(fetch, 120_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="widget widget-full transport-widget" onClick={() => navigate('/trains')} role="button">
      <div className="widget-header">
        <span className="widget-title">🚆 Pociągi ze stacji Tczew</span>
        <span className="widget-source">PKP PLK</span>
      </div>

      {loading && <div className="widget-loading">Ładowanie…</div>}
      {error   && <div className="widget-error">⚠️ {error}</div>}
      {!loading && !error && deps.length === 0 && (
        <div className="widget-loading">Brak kolejnych odjazdów</div>
      )}

      {deps.length > 0 && (
        <div className="train-deps-row">
          {deps.map((d, i) => (
            <div key={i} className="train-dep-card">
              <div className="train-dep-card-time">{d.departure_time}</div>
              <div className="train-dep-card-route">
                {d.category && (
                  <span
                    className="transport-cat-badge"
                    style={{ background: TRAIN_CAT_COLOR[d.category] ?? '#475569' }}
                  >
                    {d.category}
                  </span>
                )}
                <span>{d.number}</span>
              </div>
              <div className="train-dep-card-dest">{d.destination || '—'}</div>
              {d.platform && (
                <div className="train-dep-card-platform">peron {d.platform}{d.track ? `, tor ${d.track}` : ''}</div>
              )}
              {d.delay_minutes > 0 && (
                <div className="transport-dep-delay">+{d.delay_minutes} min</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function Dashboard() {
  return (
    <div className="dashboard">
      <div className="dashboard-hero">
        <h1>Dzień dobry, Tczewie 👋</h1>
        <p>Wszystko co ważne w jednym miejscu</p>
      </div>

      <div className="widgets-grid">
        <WeatherWidget />
        <WaterWidget />
        <BusWidget />
        <TrainWidget />
        <AirQualityWidget />
      </div>
    </div>
  )
}
