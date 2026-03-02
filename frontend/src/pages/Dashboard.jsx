import { useEffect, useState } from 'react'
import { getWeather, getWaterLevel } from '../api/city'
import './Dashboard.css'

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
      </div>
    </div>
  )
}
