import { useCallback, useEffect, useState } from 'react'
import { getEvents, voteEvent } from '../api/events'
import './Events.css'

const CATEGORY_STYLES = {
  'Kultura':     { color: '#7c3aed', bg: '#f5f3ff' },
  'Sport':       { color: '#16a34a', bg: '#f0fdf4' },
  'Dla Dzieci':  { color: '#ea580c', bg: '#fff7ed' },
  'Inwestycje':  { color: '#2563eb', bg: '#eff6ff' },
  'Komunikaty':  { color: '#64748b', bg: '#f8fafc' },
  'Ogłoszenia':  { color: '#64748b', bg: '#f8fafc' },
  'Transmisje':  { color: '#0891b2', bg: '#ecfeff' },
  'Aktualności': { color: '#0f172a', bg: '#f1f5f9' },
  'CKiS':        { color: '#d97706', bg: '#fffbeb' },
  'Imprezy':     { color: '#be185d', bg: '#fdf2f8' },
}

const DEFAULT_STYLE = { color: '#475569', bg: '#f1f5f9' }

const SOURCE_LABELS = {
  'all':      'Wszystkie',
  'tczew.pl': 'tczew.pl',
  'tcz.pl':   'tcz.pl',
  'ckis':     'CKiS',
}

const MONTHS_GEN = [
  'stycznia','lutego','marca','kwietnia','maja','czerwca',
  'lipca','sierpnia','września','października','listopada','grudnia',
]

function formatDate(iso) {
  if (!iso) return null
  const parts = iso.split('-').map(Number)
  if (parts.length === 3 && parts[0] > 2000 && parts[1] >= 1 && parts[1] <= 12) {
    const [y, m, d] = parts
    return `${d} ${MONTHS_GEN[m - 1]} ${y}`
  }
  return iso
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

function EventCard({ item, onVote }) {
  const dateStr = formatDate(item.date)
  const isHot = item.votes >= 5

  return (
    <article className="event-card">
      <div className="event-card-top">
        <div className="event-badges">
          {item.categories?.slice(0, 3).map(c => (
            <CategoryBadge key={c} category={c} />
          ))}
          <span className={`event-source-tag source-${(item.source || '').replace('.', '-')}`}>
            {item.source}
          </span>
        </div>
      </div>

      <h3 className="event-title">
        {isHot && <span className="hot-badge">🔥 Gorące</span>}
        {item.title}
      </h3>

      <p className="event-pubdate">
        📅 {dateStr ?? 'Brak daty'}
      </p>

      {item.description && (
        <p className="event-desc">{item.description}</p>
      )}

      <div className="event-card-footer">
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
        <button
          className={`vote-btn${item.user_voted ? ' voted' : ''}`}
          onClick={() => item.id && onVote(item.id)}
          aria-label={item.user_voted ? 'Cofnij głos' : 'Zagłosuj'}
        >
          👍 {item.votes}
        </button>
      </div>
    </article>
  )
}

export default function Events() {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sort, setSort] = useState('latest')
  const [sourceFilter, setSourceFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')

  useEffect(() => {
    setLoading(true)
    setError(null)
    setCategoryFilter('all')
    getEvents({ sort, source: sourceFilter })
      .then(setEvents)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [sort, sourceFilter])

  const handleVote = useCallback(async (eventId) => {
    try {
      const result = await voteEvent(eventId)
      setEvents(prev => prev.map(ev =>
        ev.id === eventId
          ? { ...ev, votes: result.votes, user_voted: result.voted }
          : ev
      ))
    } catch (e) {
      console.error('Vote error:', e)
    }
  }, [])

  const availableCategories = [...new Set(events.flatMap(e => e.categories ?? []))].sort()

  const visibleEvents = categoryFilter === 'all'
    ? events
    : events.filter(e => e.categories?.includes(categoryFilter))

  return (
    <div className="events-page">
      <h1 className="page-title">Wydarzenia w Tczewie</h1>
      <p className="page-subtitle">Aktualności i wydarzenia z tczew.pl, tcz.pl oraz CKiS Tczew</p>

      <div className="events-controls">
        <div className="events-sort-bar">
          <button
            className={sort === 'latest' ? 'active' : ''}
            onClick={() => setSort('latest')}
          >
            Najnowsze
          </button>
          <button
            className={sort === 'popular' ? 'active' : ''}
            onClick={() => setSort('popular')}
          >
            Najpopularniejsze
          </button>
        </div>

        <div className="events-source-filter">
          {Object.entries(SOURCE_LABELS).map(([val, label]) => (
            <button
              key={val}
              className={sourceFilter === val ? 'active' : ''}
              onClick={() => setSourceFilter(val)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!loading && availableCategories.length > 0 && (
        <div className="events-category-filter">
          <button
            className={categoryFilter === 'all' ? 'active' : ''}
            onClick={() => setCategoryFilter('all')}
          >
            Wszystkie kategorie
          </button>
          {availableCategories.map(cat => (
            <button
              key={cat}
              className={categoryFilter === cat ? 'active' : ''}
              onClick={() => setCategoryFilter(cat)}
              style={categoryFilter === cat ? {
                background: CATEGORY_STYLES[cat]?.bg ?? '#f1f5f9',
                color: CATEGORY_STYLES[cat]?.color ?? '#475569',
              } : {}}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {loading && <div className="events-loading">Ładowanie wydarzeń…</div>}
      {error && <div className="events-error">⚠️ {error}</div>}

      {!loading && !error && visibleEvents.length === 0 && (
        <div className="events-empty">Brak wydarzeń w tej kategorii.</div>
      )}

      <div className="events-list">
        {visibleEvents.map(item => (
          <EventCard key={item.id || item.link} item={item} onVote={handleVote} />
        ))}
      </div>
    </div>
  )
}
