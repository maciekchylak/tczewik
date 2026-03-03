import { useEffect, useRef, useState } from 'react'
import { getTrainDepartures } from '../api/schedules'
import './Schedule.css'

// ── Moduł-level cache — przetrwa nawigację między stronami ────────────────────
const _cache = { data: [], time: null }

// ── Helpers ───────────────────────────────────────────────────────────────────

function DelayBadge({ minutes, cancelled }) {
  if (cancelled) return <span className="delay-badge delay-high">Odwołany</span>
  if (minutes === null || minutes === undefined) return null
  if (minutes <= 0) return <span className="delay-badge delay-ok">na czas</span>
  if (minutes <= 5)  return <span className="delay-badge delay-low">+{minutes} min</span>
  if (minutes <= 15) return <span className="delay-badge delay-mid">+{minutes} min</span>
  return <span className="delay-badge delay-high">+{minutes} min</span>
}

function CategoryBadge({ category, label }) {
  if (!category) return null
  const colorMap = {
    IC: '#c0392b', EIC: '#922b21', EIP: '#6e1f18',
    TLK: '#1a5276', EC: '#1a5276', EN: '#154360',
    RE: '#1d6a4a', R: '#196f3d',
  }
  const bg = colorMap[category] || '#475569'
  return (
    <span className="train-category-badge" style={{ background: bg }}>
      {category}
    </span>
  )
}

function useTimeAgo(timestamp) {
  const [label, setLabel] = useState('')

  useEffect(() => {
    if (!timestamp) { setLabel(''); return }

    const update = () => {
      const sec = Math.floor((Date.now() - timestamp.getTime()) / 1000)
      if (sec < 60)       setLabel(`${sec} sek temu`)
      else if (sec < 3600) setLabel(`${Math.floor(sec / 60)} min temu`)
      else                setLabel(`${Math.floor(sec / 3600)} h temu`)
    }

    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [timestamp])

  return label
}

// ── Komponent ─────────────────────────────────────────────────────────────────

export default function Trains() {
  const [departures, setDepartures]   = useState(_cache.data)
  const [lastRefresh, setLastRefresh] = useState(_cache.time)
  const [initialLoading, setInitialLoading] = useState(_cache.data.length === 0)
  const [refreshing, setRefreshing]   = useState(false)
  const [error, setError]             = useState(null)
  const mountedRef = useRef(true)
  const timeAgo = useTimeAgo(lastRefresh)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const fetchData = () => {
      if (_cache.data.length > 0) setRefreshing(true)

      getTrainDepartures()
        .then(data => {
          if (!mountedRef.current) return
          _cache.data = data
          _cache.time = new Date()
          setDepartures(data)
          setLastRefresh(_cache.time)
          setError(null)
        })
        .catch(e => {
          if (!mountedRef.current) return
          if (_cache.data.length === 0) setError(e.message)
        })
        .finally(() => {
          if (!mountedRef.current) return
          setInitialLoading(false)
          setRefreshing(false)
        })
    }

    fetchData()
    const interval = setInterval(fetchData, 30_000)
    return () => clearInterval(interval)
  }, [])

  const nextIdx = departures.findIndex(d => !d.departed)

  return (
    <div>
      <div className="trains-page-header">
        <div>
          <h1 className="page-title">Odjazdy pociągów</h1>
          <p className="page-subtitle">Ze stacji Tczew — dzisiaj</p>
        </div>
        <div className="refresh-status">
          {refreshing && <span className="refreshing-dot" title="Aktualizowanie…" />}
          {timeAgo && <span className="refresh-info">{timeAgo}</span>}
        </div>
      </div>

      <div className="panel">
        {initialLoading && (
          <div className="panel-loading">Ładowanie danych PKP…</div>
        )}
        {error && departures.length === 0 && (
          <div className="panel-error">
            ⚠️ {error}
            <div className="panel-error-hint">Backend ponawia próbę automatycznie co 5 minut.</div>
          </div>
        )}

        {departures.length > 0 && (
          <table className="deps-table trains-full-table">
            <colgroup>
              <col className="col-time" />
              <col className="col-train" />
              <col className="col-direction" />
              <col className="col-platform" />
              <col className="col-delay" />
            </colgroup>
            <thead>
              <tr>
                <th>Godz.</th>
                <th>Pociąg</th>
                <th>Kierunek</th>
                <th>Peron / Tor</th>
                <th>Opóźnienie</th>
              </tr>
            </thead>
            <tbody>
              {departures.map((d, i) => (
                <tr
                  key={i}
                  className={[
                    d.departed  ? 'row-departed'  : '',
                    d.cancelled ? 'row-cancelled' : '',
                    i === nextIdx ? 'next' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <td className="t-time">{d.departure_time}</td>
                  <td>
                    <div className="t-number">
                      <div className="train-number-wrap">
                        <CategoryBadge category={d.category} label={d.category_label} />
                        <span>{d.number}</span>
                      </div>
                      {d.name && <span className="train-name-sub">{d.name}</span>}
                    </div>
                  </td>
                  <td>
                    <div className="t-route-train">
                      <span className="t-headsign-main">{d.destination || '—'}</span>
                      {d.origin && <span className="t-route-sub">z: {d.origin}</span>}
                    </div>
                  </td>
                  <td>
                    {d.platform
                      ? <span className="platform-badge">peron {d.platform}{d.track ? `, tor ${d.track}` : ''}</span>
                      : <span className="t-muted">—</span>
                    }
                  </td>
                  <td>
                    <DelayBadge minutes={d.delay_minutes} cancelled={d.cancelled} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {!initialLoading && !error && departures.length === 0 && (
          <div className="panel-empty">Brak danych o pociągach na dziś.</div>
        )}
      </div>
    </div>
  )
}
