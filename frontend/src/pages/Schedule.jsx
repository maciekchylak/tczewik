import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getBusDepartures, getBusStops, getTrainDepartures } from '../api/schedules'
import './Schedule.css'

// Fix leaflet default icon
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const OPERATOR_STYLES = {
  'PKP Intercity':            { bg: '#7f1d1d', color: '#fca5a5', label: 'IC' },
  'PolRegio':                 { bg: '#1e3a5f', color: '#93c5fd', label: 'PR' },
  'PKP Szybka Kolej Miejska': { bg: '#14532d', color: '#86efac', label: 'SKM' },
  'Koleje Mazowieckie':       { bg: '#4a1d96', color: '#c4b5fd', label: 'KM' },
  'Koleje Dolnośląskie':      { bg: '#7c2d12', color: '#fdba74', label: 'KD' },
}

function getOperatorStyle(name) {
  for (const key of Object.keys(OPERATOR_STYLES)) {
    if (name?.includes(key)) return OPERATOR_STYLES[key]
  }
  return { bg: '#1e293b', color: '#94a3b8', label: name?.slice(0, 3) || '?' }
}

function OperatorBadge({ name }) {
  const style = getOperatorStyle(name)
  return (
    <span
      className="operator-badge"
      style={{ background: style.bg, color: style.color }}
      title={name}
    >
      {style.label}
    </span>
  )
}

function BusMap({ stops, selectedId, onSelect }) {
  const mapRef = useRef(null)
  const instanceRef = useRef(null)
  const markersRef = useRef({})

  useEffect(() => {
    if (!mapRef.current || instanceRef.current || stops.length === 0) return

    const stopsWithCoords = stops.filter(s => s.lat && s.lon)
    if (stopsWithCoords.length === 0) return

    const map = L.map(mapRef.current, { zoomControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    stopsWithCoords.forEach(stop => {
      const marker = L.circleMarker([stop.lat, stop.lon], {
        radius: 7,
        fillColor: '#38bdf8',
        color: '#0c4a6e',
        weight: 2,
        fillOpacity: 0.85,
        className: 'bus-stop-marker',
      })
      marker.bindTooltip(`<b>${stop.name}</b><br><span style="color:#94a3b8">Nr ${stop.code}</span>`, {
        direction: 'top',
        offset: [0, -5],
      })
      marker.on('click', () => onSelect(stop))
      marker.addTo(map)
      markersRef.current[stop.id] = marker
    })

    const bounds = L.latLngBounds(stopsWithCoords.map(s => [s.lat, s.lon]))
    map.fitBounds(bounds, { padding: [20, 20] })

    instanceRef.current = map
    return () => { map.remove(); instanceRef.current = null }
  }, [stops])

  // Highlight selected marker
  useEffect(() => {
    Object.entries(markersRef.current).forEach(([id, marker]) => {
      marker.setStyle({
        fillColor: id === selectedId ? '#f59e0b' : '#38bdf8',
        radius: id === selectedId ? 10 : 7,
        weight: id === selectedId ? 3 : 2,
      })
    })
  }, [selectedId])

  const hasCoords = stops.some(s => s.lat && s.lon)
  if (!hasCoords) return null

  return <div ref={mapRef} className="bus-map" />
}

function BusPanel() {
  const [stops, setStops] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [departures, setDepartures] = useState([])
  const [loading, setLoading] = useState(true)
  const [depsLoading, setDepsLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    getBusStops()
      .then(setStops)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSelect = useCallback(async (stop) => {
    setSelected(stop)
    setDepsLoading(true)
    setDepartures([])
    try {
      setDepartures(await getBusDepartures(stop.id))
    } catch (e) {
      setError(e.message)
    } finally {
      setDepsLoading(false)
    }
  }, [])

  const filtered = stops.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.code.includes(search)
  )

  return (
    <div className="panel">
      <div className="panel-header bus-header">
        <span className="panel-icon">🚌</span>
        <div>
          <h2>Autobusy MZK</h2>
          <p>Wybierz przystanek z mapy lub listy</p>
        </div>
      </div>

      {error && <div className="panel-error">⚠️ {error}</div>}

      {loading ? (
        <div className="panel-loading">Ładowanie przystanków…</div>
      ) : (
        <>
          <BusMap stops={stops} selectedId={selected?.id} onSelect={handleSelect} />

          <div className="stop-search-wrap">
            <input
              className="stop-search"
              placeholder="🔍 Szukaj przystanku lub nr…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="stop-list">
            {filtered.slice(0, 60).map(s => (
              <button
                key={s.id}
                className={`stop-item ${selected?.id === s.id ? 'active' : ''}`}
                onClick={() => handleSelect(s)}
              >
                <span className="stop-code">Nr {s.code}</span>
                <span className="stop-name">{s.name}</span>
              </button>
            ))}
          </div>

          {selected && (
            <div className="departures-section">
              <div className="deps-title">
                Odjazdy z: <strong>{selected.name}</strong>
                <span className="deps-code"> (nr {selected.code})</span>
              </div>
              {depsLoading ? (
                <div className="panel-loading">Ładowanie odjazdów…</div>
              ) : departures.length > 0 ? (
                <table className="deps-table">
                  <thead>
                    <tr><th>Godz.</th><th>Linia</th><th>Kierunek</th></tr>
                  </thead>
                  <tbody>
                    {departures.map((d, i) => (
                      <tr key={i} className={i === 0 ? 'next' : ''}>
                        <td className="t-time">{d.time}</td>
                        <td className="t-route">{d.route}</td>
                        <td className="t-headsign">{d.headsign}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <div className="panel-empty">Brak odjazdów na dziś.</div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function TrainPanel() {
  const [departures, setDepartures] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    getTrainDepartures()
      .then(setDepartures)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="panel">
      <div className="panel-header train-header">
        <span className="panel-icon">🚂</span>
        <div>
          <h2>Pociągi</h2>
          <p>Odjazdy ze stacji Tczew — dzisiaj</p>
        </div>
      </div>

      {error && <div className="panel-error">⚠️ {error}</div>}
      {loading && <div className="panel-loading">Ładowanie danych PKP…</div>}

      {!loading && !error && departures.length > 0 && (
        <table className="deps-table trains-table">
          <thead>
            <tr>
              <th>Godz.</th>
              <th>Pociąg</th>
              <th>Trasa / Kierunek</th>
              <th>Operator</th>
            </tr>
          </thead>
          <tbody>
            {departures.map((d, i) => (
              <tr key={i} className={i === 0 ? 'next' : ''}>
                <td className="t-time">{d.time}</td>
                <td className="t-number">{d.number}</td>
                <td className="t-route-train">
                  <span className="t-headsign-main">{d.headsign}</span>
                  {d.route && <span className="t-route-sub">{d.route}</span>}
                </td>
                <td><OperatorBadge name={d.operator} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {!loading && !error && departures.length === 0 && (
        <div className="panel-empty">Brak danych o pociągach na dziś.</div>
      )}
    </div>
  )
}

export default function Schedule() {
  return (
    <div className="schedule-page">
      <div className="schedule-page-header">
        <h1>Rozkład jazdy</h1>
        <p>Autobusy i pociągi przez Tczew w jednym miejscu</p>
      </div>
      <div className="panels-grid">
        <BusPanel />
        <TrainPanel />
      </div>
    </div>
  )
}
