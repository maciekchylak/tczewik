import { useCallback, useEffect, useState } from 'react'
import { getAlerts } from '../api/alerts'
import './Alerts.css'

// ── Config ─────────────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: 'all',    label: 'Wszystkie', icon: '🔔' },
  { id: 'road',   label: 'Drogi',     icon: '🚧' },
  { id: 'crisis', label: 'Kryzysowe', icon: '🚨' },
  { id: 'city',   label: 'Miasto',    icon: '🏙️' },
]

const SEVERITY = {
  critical: { label: 'Krytyczne', color: '#dc2626', bg: '#fef2f2', bar: '#dc2626' },
  warning:  { label: 'Ostrzeżenie', color: '#d97706', bg: '#fffbeb', bar: '#f59e0b' },
  info:     { label: 'Informacja', color: '#2563eb', bg: '#eff6ff', bar: '#3b82f6' },
}

const SOURCE_STATUS = {
  road:   { label: 'GDDKiA',   icon: '🚧' },
  crisis: { label: 'RSO',      icon: '🚨' },
  city:   { label: 'tczew.pl', icon: '🏙️' },
}

const SEVERITY_ORDER = { critical: 0, warning: 1, info: 2 }

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(raw) {
  if (!raw) return null
  const d = new Date(raw)
  if (isNaN(d)) return raw
  return d.toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function SourceStatusRow({ sources }) {
  return (
    <div className="source-status-row">
      {Object.entries(sources).map(([key, meta]) => {
        const cfg = SOURCE_STATUS[key] || { label: key, icon: '📡' }
        return (
          <div
            key={key}
            className={`source-chip ${meta.ok ? 'source-ok' : 'source-err'}`}
            title={meta.error || `${meta.count} alertów`}
          >
            <span>{cfg.icon}</span>
            <span>{cfg.label}</span>
            {meta.ok
              ? <span className="source-count">{meta.count}</span>
              : <span className="source-err-dot">!</span>
            }
          </div>
        )
      })}
    </div>
  )
}

function CategoryTabs({ active, onChange, alerts }) {
  const counts = alerts.reduce((acc, a) => {
    acc[a.category] = (acc[a.category] || 0) + 1
    return acc
  }, {})

  return (
    <div className="category-tabs">
      {CATEGORIES.map(cat => {
        const count = cat.id === 'all' ? alerts.length : (counts[cat.id] || 0)
        return (
          <button
            key={cat.id}
            className={`cat-tab ${active === cat.id ? 'active' : ''}`}
            onClick={() => onChange(cat.id)}
          >
            <span className="cat-icon">{cat.icon}</span>
            <span className="cat-label">{cat.label}</span>
            {count > 0 && <span className="cat-badge">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}

function AlertCard({ alert }) {
  const [expanded, setExpanded] = useState(false)
  const sev = SEVERITY[alert.severity] ?? SEVERITY.info
  const catCfg = CATEGORIES.find(c => c.id === alert.category) || { icon: '📌' }
  const date = formatDate(alert.published_at)
  const hasMore = alert.description && alert.description.length > 120

  return (
    <div className={`alert-card severity-${alert.severity}`} style={{ '--sev-bar': sev.bar }}>
      <div className="alert-card-bar" />
      <div className="alert-card-body">
        <div className="alert-card-top">
          <span className="alert-cat-icon">{catCfg.icon}</span>
          <div className="alert-card-main">
            <div className="alert-card-title">{alert.title}</div>
            {alert.description && (
              <div className={`alert-card-desc ${expanded ? 'expanded' : ''}`}>
                {alert.description}
              </div>
            )}
            {hasMore && (
              <button className="alert-expand-btn" onClick={() => setExpanded(e => !e)}>
                {expanded ? '▲ zwiń' : '▼ rozwiń'}
              </button>
            )}
          </div>
          <div className="alert-card-meta">
            <span
              className="alert-sev-badge"
              style={{ color: sev.color, background: sev.bg }}
            >
              {sev.label}
            </span>
            <span className="alert-source">{alert.source}</span>
            {date && <span className="alert-date">{date}</span>}
            {alert.url && (
              <a
                href={alert.url}
                target="_blank"
                rel="noopener noreferrer"
                className="alert-link"
              >
                źródło ↗
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState({ category }) {
  const cat = CATEGORIES.find(c => c.id === category)
  return (
    <div className="alerts-empty">
      <div className="alerts-empty-icon">
        {category === 'all' ? '✅' : cat?.icon || '🔔'}
      </div>
      <p>
        {category === 'all'
          ? 'Brak aktywnych alertów — wszystko spokojnie!'
          : `Brak alertów w kategorii "${cat?.label}"`}
      </p>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Alerts() {
  const [data, setData]           = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [activeCategory, setActive] = useState('all')
  const [lastFetched, setLastFetched] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    setError(null)
    getAlerts()
      .then(d => { setData(d); setLastFetched(new Date()) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const allAlerts = data?.alerts ?? []

  const filtered = allAlerts.filter(
    a => activeCategory === 'all' || a.category === activeCategory
  )

  const sorted = [...filtered].sort((a, b) => {
    const so = (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
    if (so !== 0) return so
    if (a.published_at && b.published_at) {
      return new Date(b.published_at) - new Date(a.published_at)
    }
    return 0
  })

  const criticalCount = allAlerts.filter(a => a.severity === 'critical').length

  return (
    <div className="alerts-page">
      <div className="alerts-header">
        <div>
          <h1 className="page-title">
            Alerty i powiadomienia
            {criticalCount > 0 && (
              <span className="critical-badge">{criticalCount} krytyczne</span>
            )}
          </h1>
          <p className="page-subtitle">
            Utrudnienia drogowe · Alerty kryzysowe · Komunikaty miejskie
          </p>
        </div>
        <button className="refresh-btn" onClick={load} disabled={loading}>
          {loading ? '⟳ Pobieranie…' : '⟳ Odśwież'}
        </button>
      </div>

      {lastFetched && !loading && (
        <div className="alerts-updated">
          Zaktualizowano: {lastFetched.toLocaleTimeString('pl-PL')}
          {data?.meta?.fetched_at && (
            <span className="alerts-server-time">
              {' · '}dane z serwera: {formatDate(data.meta.fetched_at)}
            </span>
          )}
        </div>
      )}

      {data?.meta?.sources && (
        <SourceStatusRow sources={data.meta.sources} />
      )}

      <CategoryTabs
        active={activeCategory}
        onChange={setActive}
        alerts={allAlerts}
      />

      {error && (
        <div className="alerts-error">
          ⚠️ Błąd pobierania danych: {error}
        </div>
      )}

      {loading && (
        <div className="alerts-loading">
          <div className="alerts-spinner" />
          Pobieranie alertów ze wszystkich źródeł…
        </div>
      )}

      {!loading && !error && sorted.length === 0 && (
        <EmptyState category={activeCategory} />
      )}

      {!loading && sorted.length > 0 && (
        <div className="alerts-list">
          {sorted.map(alert => (
            <AlertCard key={alert.id} alert={alert} />
          ))}
        </div>
      )}

      <div className="alerts-footer">
        <p>Źródła danych: GDDKiA (archiwum.gddkia.gov.pl), RSO/TVP, tczew.pl</p>
        <p>Dane aktualizowane automatycznie co 10–30 minut</p>
      </div>
    </div>
  )
}
