import { useEffect, useState } from 'react'
import { getTrainDepartures } from '../api/schedules'
import './Schedule.css'

function DelayBadge({ minutes }) {
  if (minutes === null || minutes === undefined) return null
  if (minutes <= 0) return <span className="delay-badge delay-ok">na czas</span>
  if (minutes <= 5)  return <span className="delay-badge delay-low">+{minutes} min</span>
  if (minutes <= 15) return <span className="delay-badge delay-mid">+{minutes} min</span>
  return <span className="delay-badge delay-high">+{minutes} min</span>
}

export default function Trains() {
  const [departures, setDepartures] = useState([])
  const [loading, setLoading] = useState(true)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [error, setError] = useState(null)

  const fetchData = (isRefresh = false) => {
    if (!isRefresh) setLoading(true)
    setError(null)
    getTrainDepartures()
      .then(data => { setDepartures(data); setLastRefresh(new Date()) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    fetchData(false)
    const interval = setInterval(() => fetchData(true), 120_000)
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
        {lastRefresh && (
          <span className="refresh-info">
            Odświeżono: {lastRefresh.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      <div className="panel">
        {loading && departures.length === 0 && (
          <div className="panel-loading">Ładowanie danych PKP…</div>
        )}
        {error && departures.length === 0 && (
          <div className="panel-error">⚠️ {error}</div>
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

        {!loading && !error && departures.length === 0 && (
          <div className="panel-empty">Brak danych o pociągach na dziś.</div>
        )}
      </div>
    </div>
  )
}
