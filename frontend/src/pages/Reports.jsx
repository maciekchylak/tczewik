import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { createReport, getReports, getReportTypes, uploadPhoto, voteReport } from '../api/reports'
import './Reports.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const TCZEW_LAT = 54.09242
const TCZEW_LON = 18.77787
const TCZEW_ZOOM = 13

const STATUS_CONFIG = {
  new:         { label: 'Nowe',         color: '#2563eb', bg: '#eff6ff', border: '#3b82f6' },
  in_progress: { label: 'W realizacji', color: '#d97706', bg: '#fffbeb', border: '#f59e0b' },
  resolved:    { label: 'Naprawione',   color: '#16a34a', bg: '#f0fdf4', border: '#22c55e' },
  rejected:    { label: 'Odrzucone',    color: '#dc2626', bg: '#fef2f2', border: '#ef4444' },
}

const MARKER_COLORS = {
  new: '#3b82f6',
  in_progress: '#f59e0b',
  resolved: '#22c55e',
  rejected: '#ef4444',
}

const VOTED_KEY = 'tczewik_voted_reports'
function getVotedSet() {
  try { return new Set(JSON.parse(localStorage.getItem(VOTED_KEY) || '[]')) } catch { return new Set() }
}
function markVoted(id) {
  const s = getVotedSet(); s.add(id)
  localStorage.setItem(VOTED_KEY, JSON.stringify([...s]))
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: '#64748b', bg: '#f1f5f9' }
  return <span className="status-badge" style={{ color: cfg.color, background: cfg.bg }}>{cfg.label}</span>
}

function formatDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Map ────────────────────────────────────────────────────────────────────────
function ReportsMap({ reports, onMapClick, pendingPin, reportTypes }) {
  const mapRef = useRef(null)
  const instanceRef = useRef(null)
  const markersRef = useRef([])
  const pendingMarkerRef = useRef(null)

  // Init map — zawsze wyśrodkowana na Tczew
  useEffect(() => {
    if (!mapRef.current || instanceRef.current) return

    const map = L.map(mapRef.current, { zoomControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    map.setView([TCZEW_LAT, TCZEW_LON], TCZEW_ZOOM)
    map.on('click', e => onMapClick(e.latlng.lat, e.latlng.lng))

    instanceRef.current = map
    return () => { map.remove(); instanceRef.current = null }
  }, [])

  // Aktualizuj markery zgłoszeń
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const typeMap = Object.fromEntries((reportTypes || []).map(t => [t.id, t]))

    reports.forEach(r => {
      if (!r.lat || !r.lon) return
      const color = MARKER_COLORS[r.status] || '#64748b'
      const typeInfo = typeMap[r.report_type] || {}

      const marker = L.circleMarker([r.lat, r.lon], {
        radius: 8 + Math.min(r.votes || 0, 10),
        fillColor: color,
        color: '#fff',
        weight: 2,
        fillOpacity: 0.88,
      })

      marker.bindPopup(`
        <div style="min-width:190px;font-family:system-ui">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="font-size:1.2rem">${typeInfo.icon || '📍'}</span>
            <strong>${typeInfo.label || r.report_type}</strong>
          </div>
          ${r.address_hint ? `<div style="font-size:0.78rem;color:#64748b;margin-bottom:4px">📍 ${r.address_hint}</div>` : ''}
          ${r.description ? `<div style="font-size:0.82rem;margin-bottom:6px">${r.description}</div>` : ''}
          ${r.photo_url ? `<img src="${r.photo_url}" style="width:100%;border-radius:6px;margin-bottom:6px" />` : ''}
          <div style="display:flex;align-items:center;justify-content:space-between;font-size:0.75rem;color:#94a3b8">
            <span>👍 ${r.votes || 0} głosów</span>
            <span>${formatDate(r.created_at)}</span>
          </div>
        </div>
      `, { maxWidth: 280 })

      marker.addTo(map)
      markersRef.current.push(marker)
    })
  }, [reports, reportTypes])

  // Pin nowego zgłoszenia
  useEffect(() => {
    const map = instanceRef.current
    if (!map) return
    if (pendingMarkerRef.current) {
      pendingMarkerRef.current.remove()
      pendingMarkerRef.current = null
    }
    if (pendingPin) {
      const m = L.marker([pendingPin.lat, pendingPin.lon])
      m.bindTooltip('📍 Nowe zgłoszenie', { permanent: true, direction: 'top', offset: [0, -30] })
      m.addTo(map)
      pendingMarkerRef.current = m
    }
  }, [pendingPin])

  return <div ref={mapRef} className="reports-map" />
}

// ── Form ───────────────────────────────────────────────────────────────────────
function ReportForm({ pin, reportTypes, onSuccess, onCancel }) {
  const [form, setForm] = useState({ report_type: reportTypes[0]?.id || 'pothole', description: '' })
  const [photo, setPhoto] = useState(null)
  const [photoPreview, setPhotoPreview] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handlePhotoChange = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setError('Zdjęcie może mieć maksymalnie 10 MB.'); return }
    setPhoto(file)
    setPhotoPreview(URL.createObjectURL(file))
  }

  const handleSubmit = async () => {
    setSubmitting(true); setError(null)
    try {
      let addressHint = ''
      try {
        const geo = await fetch(
          `https://nominatim.openstreetmap.org/reverse?lat=${pin.lat}&lon=${pin.lon}&format=json&accept-language=pl`
        ).then(r => r.json())
        addressHint = geo.display_name?.split(',').slice(0, 3).join(', ') || ''
      } catch (_) {}

      const { id } = await createReport({
        report_type: form.report_type,
        lat: pin.lat,
        lon: pin.lon,
        description: form.description,
        address_hint: addressHint,
      })

      if (photo) {
        try { await uploadPhoto(id, photo) } catch (e) { console.warn('Photo upload failed:', e) }
      }

      onSuccess()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="report-form-card">
      <div className="form-header">
        <h3>📍 Nowe zgłoszenie</h3>
        <button className="form-close" onClick={onCancel}>✕</button>
      </div>
      <p className="form-coords">{pin.lat.toFixed(5)}, {pin.lon.toFixed(5)}</p>

      {error && <div className="form-error">⚠️ {error}</div>}

      <div className="form-group">
        <label>Typ zgłoszenia</label>
        <div className="type-pills">
          {reportTypes.map(t => (
            <button
              key={t.id}
              className={`type-pill ${form.report_type === t.id ? 'active' : ''}`}
              onClick={() => set('report_type', t.id)}
              title={t.description}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-group">
        <label>Opis <span className="label-optional">(opcjonalny)</span></label>
        <textarea
          className="form-textarea"
          placeholder="Opisz problem, np. głęboka dziura przy przejściu dla pieszych…"
          value={form.description}
          onChange={e => set('description', e.target.value)}
          maxLength={500}
          rows={3}
        />
        <span className="char-count">{form.description.length}/500</span>
      </div>

      <div className="form-group">
        <label>Zdjęcie <span className="label-optional">(opcjonalne)</span></label>
        {photoPreview ? (
          <div className="photo-preview-wrap">
            <img src={photoPreview} alt="Podgląd" className="photo-preview" />
            <button className="photo-remove" onClick={() => { setPhoto(null); setPhotoPreview(null) }}>
              ✕ Usuń
            </button>
          </div>
        ) : (
          <button className="photo-upload-btn" onClick={() => fileInputRef.current?.click()}>
            📷 Dodaj zdjęcie
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handlePhotoChange}
        />
      </div>

      <div className="form-actions">
        <button className="btn-cancel" onClick={onCancel} disabled={submitting}>Anuluj</button>
        <button className="btn-submit" onClick={handleSubmit} disabled={submitting}>
          {submitting ? 'Wysyłanie…' : '✓ Wyślij zgłoszenie'}
        </button>
      </div>
    </div>
  )
}

// ── Vote button ────────────────────────────────────────────────────────────────
function VoteButton({ report, onVoted }) {
  const [loading, setLoading] = useState(false)
  const [votes, setVotes] = useState(report.votes || 0)
  const [voted, setVoted] = useState(() => getVotedSet().has(report.id))
  const resolved = report.status === 'resolved' || report.status === 'rejected'

  const handleVote = async (e) => {
    e.stopPropagation()
    if (voted || resolved || loading) return
    setLoading(true)
    try {
      const res = await voteReport(report.id)
      setVotes(res.votes)
      setVoted(true)
      markVoted(report.id)
      onVoted?.()
    } catch (err) {
      if (err.message === 'already_voted') { setVoted(true); markVoted(report.id) }
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      className={`vote-btn ${voted ? 'voted' : ''} ${resolved ? 'disabled' : ''}`}
      onClick={handleVote}
      disabled={loading || resolved}
      title={voted ? 'Już głosowałeś' : resolved ? 'Zgłoszenie zamknięte' : 'Popierasz to zgłoszenie?'}
    >
      <span className="vote-icon">👍</span>
      <span className="vote-count">{votes}</span>
    </button>
  )
}

// ── Report card ────────────────────────────────────────────────────────────────
function ReportCard({ report, typeMap, onVoted }) {
  const [expanded, setExpanded] = useState(false)
  const typeInfo = typeMap[report.report_type] || {}

  return (
    <div className={`report-item status-${report.status}`}>
      <div className="report-item-top">
        <span className="report-type-icon">{typeInfo.icon || '📍'}</span>
        <div className="report-item-info">
          <span className="report-type-label">{typeInfo.label || report.report_type}</span>
          {report.address_hint && <span className="report-address">{report.address_hint}</span>}
        </div>
        <VoteButton report={report} onVoted={onVoted} />
        <StatusBadge status={report.status} />
      </div>

      {report.description && <p className="report-desc">{report.description}</p>}

      {report.photo_url && (
        <div className="report-photo-wrap">
          <img
            src={report.photo_url}
            alt="Zdjęcie zgłoszenia"
            className={`report-photo ${expanded ? 'expanded' : ''}`}
            onClick={() => setExpanded(e => !e)}
          />
        </div>
      )}

      {report.status_note && <div className="report-note">💬 {report.status_note}</div>}

      <div className="report-meta">
        <span>🕐 {formatDate(report.created_at)}</span>
        {report.votes > 0 && (
          <span className="votes-meta">👍 {report.votes} {report.votes === 1 ? 'głos' : 'głosów'}</span>
        )}
      </div>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function Reports() {
  const [reports, setReports] = useState([])
  const [reportTypes, setReportTypes] = useState([])
  const [loading, setLoading] = useState(true)
  const [pendingPin, setPendingPin] = useState(null)
  const [filterStatus, setFilterStatus] = useState('')
  const [sort, setSort] = useState('votes')
  const [activeTab, setActiveTab] = useState('map')
  const [successMsg, setSuccessMsg] = useState(null)

  const typeMap = Object.fromEntries(reportTypes.map(t => [t.id, t]))

  const fetchReports = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getReports({ status: filterStatus || undefined, sort })
      setReports(data)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [filterStatus, sort])

  useEffect(() => {
    getReportTypes().then(setReportTypes).catch(console.error)
  }, [])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  const handleFormSuccess = () => {
    setPendingPin(null)
    setSuccessMsg('✅ Zgłoszenie zostało wysłane! Dziękujemy za aktywność.')
    setTimeout(() => setSuccessMsg(null), 5000)
    fetchReports()
  }

  return (
    <div className="reports-page">
      <div className="reports-header">
        <div>
          <h1 className="page-title">Zgłoszenia miejskie</h1>
          <p className="page-subtitle">Kliknij na mapie, żeby zgłosić usterkę • Głosuj na ważne problemy</p>
        </div>
        <div className="header-controls">
          <select className="ctrl-select" value={sort} onChange={e => setSort(e.target.value)}>
            <option value="votes">🔥 Najpilniejsze (głosy)</option>
            <option value="date">🕐 Najnowsze</option>
          </select>
          <select className="ctrl-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
            <option value="">Wszystkie statusy</option>
            {Object.entries(STATUS_CONFIG).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
      </div>

      {successMsg && <div className="success-banner">{successMsg}</div>}

      <div className="reports-stats">
        {Object.entries(STATUS_CONFIG).map(([k, v]) => {
          const count = reports.filter(r => r.status === k).length
          return (
            <button
              key={k}
              className={`stat-pill ${filterStatus === k ? 'active' : ''}`}
              style={{ '--accent': v.color, '--accent-bg': v.bg, '--accent-border': v.border }}
              onClick={() => setFilterStatus(filterStatus === k ? '' : k)}
            >
              <span className="stat-pill-count">{count}</span>
              <span className="stat-pill-label">{v.label}</span>
            </button>
          )
        })}
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === 'map' ? 'active' : ''}`}
          onClick={() => setActiveTab('map')}
        >
          🗺️ Mapa
        </button>
        <button
          className={`tab ${activeTab === 'list' ? 'active' : ''}`}
          onClick={() => setActiveTab('list')}
        >
          📋 Lista ({reports.length})
        </button>
      </div>

      {activeTab === 'map' && (
        <div className="map-section">
          <div className="map-hint">
            {pendingPin
              ? '📝 Wypełnij formularz poniżej'
              : '👆 Kliknij na mapie, żeby dodać zgłoszenie'}
          </div>
          <ReportsMap
            reports={reports}
            onMapClick={(lat, lon) => setPendingPin({ lat, lon })}
            pendingPin={pendingPin}
            reportTypes={reportTypes}
          />
          {pendingPin && (
            <ReportForm
              pin={pendingPin}
              reportTypes={reportTypes}
              onSuccess={handleFormSuccess}
              onCancel={() => setPendingPin(null)}
            />
          )}
        </div>
      )}

      {activeTab === 'list' && (
        <div className="report-list">
          {loading && <div className="list-loading">Ładowanie zgłoszeń…</div>}
          {!loading && reports.length === 0 && (
            <div className="list-empty">
              <div className="list-empty-icon">🕳️</div>
              <p>Brak zgłoszeń. Kliknij na mapie, żeby dodać pierwsze!</p>
            </div>
          )}
          {reports.map(r => (
            <ReportCard key={r.id} report={r} typeMap={typeMap} onVoted={fetchReports} />
          ))}
        </div>
      )}
    </div>
  )
}
