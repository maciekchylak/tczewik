import { useEffect, useRef, useState } from 'react'
import { getTrainDepartures } from '../api/schedules'
import './Schedule.css'

// ── Moduł-level cache — przetrwa nawigację między stronami ────────────────────
// Dzięki temu przy powrocie na stronę dane są od razu widoczne,
// a fetch odbywa się w tle i aktualizuje widok gdy skończy.
const _cache = { data: [], time: null }

// ── Helpers ───────────────────────────────────────────────────────────────────

function DelayBadge({ minutes }) {
  if (minutes === null || minutes === undefined) return null
  if (minutes <= 0) return <span className="delay-badge delay-ok">na czas</span>
  if (minutes <= 5)  return <span className="delay-badge delay-low">+{minutes} min</span>
  if (minutes <= 15) return <span className="delay-badge delay-mid">+{minutes} min</span>
  return <span className="delay-badge delay-high">+{minutes} min</span>
}

// ── Komponent ─────────────────────────────────────────────────────────────────

export default function Trains() {
  // Inicjalizacja z cache — przy powrocie na stronę dane są od razu.
  const [departures, setDepartures]   = useState(_cache.data)
  const [lastRefresh, setLastRefresh] = useState(_cache.time)
  const [initialLoading, setInitialLoading] = useState(_cache.data.length === 0)
  const [refreshing, setRefreshing]   = useState(false)
  const [error, setError]             = useState(null)
  const mountedRef = useRef(true)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  useEffect(() => {
    const fetchData = () => {
      // Jeśli mamy dane z cache — oznacz jako odświeżanie w tle (bez blokowania UI).
      // Jeśli nie ma danych — pokaż pełne ładowanie.
      if (_cache.data.length > 0) {
        setRefreshing(true)
      }

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
          // Pokaż błąd tylko gdy nie mamy żadnych danych do wyświetlenia.
          if (_cache.data.length === 0) setError(e.message)
        })
        .finally(() => {
          if (!mountedRef.current) return
          setInitialLoading(false)
          setRefreshing(false)
        })
    }

    fetchData()
    const interval = setInterval(fetchData, 120_000)
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
          {lastRefresh && (
            <span className="refresh-info">
              {lastRefresh.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
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
            <thead>
              <tr>
                <th>Godz.</th>
                <th>Pociąg</th>
                <th>Kierunek / Trasa</th>
                <th>Opóźnienie</th>
              </tr>
            </thead>
            <tbody>
              {departures.map((d, i) => (
                <tr
                  key={i}
                  className={[
                    d.departed ? 'row-departed' : '',
                    i === nextIdx ? 'next' : '',
                  ].filter(Boolean).join(' ')}
                >
                  <td className="t-time">{d.time}</td>
                  <td className="t-number">
                    <span>{d.number}</span>
                    {d.train_name && <span className="train-name-sub">{d.train_name}</span>}
                  </td>
                  <td className="t-route-train">
                    <span className="t-headsign-main">{d.headsign}</span>
                    {d.route && <span className="t-route-sub">{d.route}</span>}
                  </td>
                  <td><DelayBadge minutes={d.delay_minutes} /></td>
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
