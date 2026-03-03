import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getPharmacies } from '../api/pharmacies'
import './Pharmacies.css'

const TCZEW_LAT = 54.09242
const TCZEW_LON = 18.77787
const TCZEW_ZOOM = 14

const STATUS_CONFIG = {
  open:         { label: 'Otwarta',              color: '#15803d', bg: '#f0fdf4', border: '#22c55e', marker: '#22c55e' },
  closing_soon: { label: 'Zamyka się wkrótce',   color: '#b45309', bg: '#fffbeb', border: '#f59e0b', marker: '#f59e0b' },
  closed:       { label: 'Zamknięta',            color: '#b91c1c', bg: '#fef2f2', border: '#ef4444', marker: '#ef4444' },
  unknown:      { label: 'Godziny nieznane',     color: '#475569', bg: '#f8fafc', border: '#94a3b8', marker: '#94a3b8' },
}

// ── Open/closed logic ──────────────────────────────────────────────────────────

function getPolishMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const h = parseInt(parts.find(p => p.type === 'hour').value)
  const m = parseInt(parts.find(p => p.type === 'minute').value)
  return h * 60 + m
}

function getStatus(pharmacy) {
  const { open_time, close_time } = pharmacy
  if (!open_time || !close_time) return 'unknown'
  const current = getPolishMinutes()
  const [oh, om] = open_time.split(':').map(Number)
  const [ch, cm] = close_time.split(':').map(Number)
  const openMins  = oh * 60 + om
  const closeMins = ch * 60 + cm
  if (current < openMins || current >= closeMins) return 'closed'
  if (closeMins - current <= 60) return 'closing_soon'
  return 'open'
}

// ── Subcomponents ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      className="pharm-status-badge"
      style={{ color: cfg.color, background: cfg.bg, borderColor: cfg.border }}
    >
      {cfg.label}
    </span>
  )
}

function PharmaciesMap({ pharmacies }) {
  const mapRef      = useRef(null)
  const instanceRef = useRef(null)
  const markersRef  = useRef([])

  useEffect(() => {
    if (!mapRef.current || instanceRef.current) return
    const map = L.map(mapRef.current)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)
    map.setView([TCZEW_LAT, TCZEW_LON], TCZEW_ZOOM)
    instanceRef.current = map
    return () => { map.remove(); instanceRef.current = null }
  }, [])

  useEffect(() => {
    const map = instanceRef.current
    if (!map) return
    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    pharmacies.forEach(p => {
      if (p.lat == null || p.lon == null) return
      const status = getStatus(p)
      const cfg    = STATUS_CONFIG[status]
      const hours  = p.open_time && p.close_time ? `${p.open_time} – ${p.close_time}` : 'nieznane'

      const marker = L.circleMarker([p.lat, p.lon], {
        radius:      10,
        fillColor:   cfg.marker,
        color:       '#fff',
        weight:      2,
        fillOpacity: 0.9,
      })

      marker.bindPopup(`
        <div style="min-width:210px;font-family:system-ui;line-height:1.5">
          <div style="font-weight:700;font-size:0.95rem;margin-bottom:5px">💊 ${p.name}</div>
          <div style="font-size:0.82rem;color:#475569;margin-bottom:3px">📍 ${p.address}, Tczew</div>
          ${p.phone ? `<div style="font-size:0.82rem;color:#475569;margin-bottom:3px">📞 ${p.phone}</div>` : ''}
          <div style="font-size:0.82rem;color:#475569;margin-bottom:7px">🕐 ${hours}</div>
          <span style="display:inline-block;font-size:0.78rem;font-weight:700;padding:2px 10px;border-radius:12px;background:${cfg.bg};color:${cfg.color};border:1px solid ${cfg.border}">
            ${cfg.label}
          </span>
        </div>
      `, { maxWidth: 290 })

      marker.addTo(map)
      markersRef.current.push(marker)
    })
  }, [pharmacies])

  return <div ref={mapRef} className="pharm-map" />
}

function PharmacyCard({ pharmacy }) {
  const status = getStatus(pharmacy)
  const cfg    = STATUS_CONFIG[status]
  const hours  = pharmacy.open_time && pharmacy.close_time
    ? `${pharmacy.open_time} – ${pharmacy.close_time}`
    : '—'

  return (
    <div className="pharm-card">
      <div className="pharm-card-dot" style={{ background: cfg.marker }} />
      <div className="pharm-card-body">
        <div className="pharm-card-top">
          <span className="pharm-name">💊 {pharmacy.name}</span>
          <StatusBadge status={status} />
        </div>
        <div className="pharm-card-address">📍 {pharmacy.address}, Tczew</div>
        <div className="pharm-card-meta">
          {pharmacy.phone && <span>📞 {pharmacy.phone}</span>}
          <span>🕐 {hours}</span>
          {pharmacy.url && (
            <a href={pharmacy.url} target="_blank" rel="noopener noreferrer" className="pharm-link">
              Szczegóły →
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Pharmacies() {
  const [pharmacies,   setPharmacies]   = useState([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState(null)
  const [activeTab,    setActiveTab]    = useState('map')
  const [filterStatus, setFilterStatus] = useState('')

  useEffect(() => {
    getPharmacies()
      .then(setPharmacies)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const withStatus = pharmacies.map(p => ({ ...p, _status: getStatus(p) }))
  const filtered   = filterStatus ? withStatus.filter(p => p._status === filterStatus) : withStatus

  const counts = {
    open:         withStatus.filter(p => p._status === 'open').length,
    closing_soon: withStatus.filter(p => p._status === 'closing_soon').length,
    closed:       withStatus.filter(p => p._status === 'closed').length,
  }

  const FILTER_PILLS = [
    { key: 'open',         label: 'Otwarte' },
    { key: 'closing_soon', label: 'Zamykają się wkrótce' },
    { key: 'closed',       label: 'Zamknięte' },
  ]

  return (
    <div className="pharm-page">
      <div className="pharm-header">
        <div>
          <h1 className="page-title">Apteki w Tczewie</h1>
          <p className="page-subtitle">Mapa i lista czynnych aptek z godzinami otwarcia</p>
        </div>
      </div>

      {error && <div className="pharm-error">⚠️ {error}</div>}

      <div className="pharm-stats">
        {FILTER_PILLS.map(({ key, label }) => {
          const cfg = STATUS_CONFIG[key]
          return (
            <button
              key={key}
              className={`pharm-stat-pill ${filterStatus === key ? 'active' : ''}`}
              style={{ '--accent': cfg.color, '--accent-bg': cfg.bg, '--accent-border': cfg.border }}
              onClick={() => setFilterStatus(filterStatus === key ? '' : key)}
            >
              <span className="pharm-pill-count">{counts[key]}</span>
              <span className="pharm-pill-label">{label}</span>
            </button>
          )
        })}
      </div>

      <div className="pharm-tabs">
        <button
          className={`pharm-tab ${activeTab === 'map' ? 'active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          🗺️ Mapa
        </button>
        <button
          className={`pharm-tab ${activeTab === 'list' ? 'active' : ''}`}
          onClick={() => setActiveTab('list')}
        >
          📋 Lista ({filtered.length})
        </button>
      </div>

      {loading && (
        <div className="pharm-loading">
          <div className="pharm-spinner" />
          Wczytywanie listy aptek…
        </div>
      )}

      {!loading && activeTab === 'map' && (
        <div className="pharm-map-section">
          <div className="pharm-legend">
            {Object.entries(STATUS_CONFIG).filter(([k]) => k !== 'unknown').map(([k, cfg]) => (
              <span key={k} className="pharm-legend-item">
                <span className="pharm-legend-dot" style={{ background: cfg.marker }} />
                {cfg.label}
              </span>
            ))}
            <span className="pharm-legend-item">
              <span className="pharm-legend-dot" style={{ background: STATUS_CONFIG.unknown.marker }} />
              {STATUS_CONFIG.unknown.label}
            </span>
          </div>
          <PharmaciesMap pharmacies={filtered} />
          {filtered.filter(p => p.lat == null || p.lon == null).length > 0 && (
            <p className="pharm-map-note">
              {filtered.filter(p => p.lat == null || p.lon == null).length} aptek bez lokalizacji nie jest widocznych na mapie.
            </p>
          )}
        </div>
      )}

      {!loading && activeTab === 'list' && (
        <div className="pharm-list">
          {filtered.length === 0 && (
            <div className="pharm-empty">
              <div className="pharm-empty-icon">💊</div>
              <p>Brak aptek dla wybranego filtra.</p>
            </div>
          )}
          {filtered.map((p, i) => <PharmacyCard key={i} pharmacy={p} />)}
        </div>
      )}
    </div>
  )
}
