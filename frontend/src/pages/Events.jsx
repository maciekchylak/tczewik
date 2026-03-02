import { useEffect, useState } from 'react'
import { getEvents } from '../api/events'
import './Events.css'

const CATEGORY_STYLES = {
  'Kultura':        { color: '#7c3aed', bg: '#f5f3ff' },
  'Sport':          { color: '#16a34a', bg: '#f0fdf4' },
  'Dla Dzieci':     { color: '#ea580c', bg: '#fff7ed' },
  'Inwestycje':     { color: '#2563eb', bg: '#eff6ff' },
  'Komunikaty':     { color: '#64748b', bg: '#f8fafc' },
  'Ogłoszenia':     { color: '#64748b', bg: '#f8fafc' },
  'Transmisje':     { color: '#0891b2', bg: '#ecfeff' },
  'Aktualności':    { color: '#0f172a', bg: '#f1f5f9' },
}

const DEFAULT_STYLE = { color: '#475569', bg: '#f1f5f9' }

const MONTHS_GEN = [
  'stycznia','lutego','marca','kwietnia','maja','czerwca',
  'lipca','sierpnia','września','października','listopada','grudnia',
]

function formatDate(iso) {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  return `${d} ${MONTHS_GEN[m - 1]} ${y}`
}

function CategoryBadge({ category }) {
  const style = CATEGORY_STYLES[category] || DEFAULT_STYLE
  return (
    <span
      className="event-badge"
      style={{ color: style.color, background: style.bg }}
    >
      {category}
    </span>
  )
}

function EventCard({ item }) {
  const dateStr = formatDate(item.date)

  return (
    <article className="event-card">
      <div className="event-card-top">
        <div className="event-badges">
          {item.categories.slice(0, 3).map(c => (
            <CategoryBadge key={c} category={c} />
          ))}
        </div>
        {dateStr && <span className="event-date">{dateStr}</span>}
      </div>

      <h3 className="event-title">{item.title}</h3>

      {item.description && (
        <p className="event-desc">{item.description}</p>
      )}

      {item.link && (
        <a
          className="event-link"
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
        >
          Czytaj więcej →
        </a>
      )}
    </article>
  )
}

export default function Events() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getEvents()
      .then(setEvents)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="events-page">
      <h1 className="page-title">Wydarzenia w Tczewie</h1>
      <p className="page-subtitle">Aktualności i wydarzenia z oficjalnego portalu tczew.pl</p>

      {loading && <div className="events-loading">Ładowanie wydarzeń…</div>}
      {error && <div className="events-error">⚠️ {error}</div>}

      {!loading && !error && events.length === 0 && (
        <div className="events-empty">Brak wydarzeń.</div>
      )}

      <div className="events-list">
        {events.map((item, i) => (
          <EventCard key={i} item={item} />
        ))}
      </div>

      {events.length > 0 && (
        <p className="events-source">Źródło: tczew.pl</p>
      )}
    </div>
  )
}
