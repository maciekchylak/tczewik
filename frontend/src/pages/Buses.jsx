import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { getBusDepartures, getBusStops } from '../api/schedules'
import './Schedule.css'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

// Strip leading bus number from headsign: "12 Centrum" → "Centrum"
function cleanHeadsign(h) {
  return h?.replace(/^\d+[A-Za-z]?\s+/, '').trim() || h || ''
}

function BusMap({ stops, selectedName, onSelect }) {
  const mapRef = useRef(null)
  const instanceRef = useRef(null)
  const markersRef = useRef({})

  useEffect(() => {
    if (!mapRef.current || instanceRef.current) return
    const withCoords = stops.filter(s => s.lat && s.lon)
    if (withCoords.length === 0) return

    const map = L.map(mapRef.current)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)

    withCoords.forEach(stop => {
      const marker = L.circleMarker([stop.lat, stop.lon], {
        radius: 7,
        fillColor: '#38bdf8',
        color: '#0c4a6e',
        weight: 2,
        fillOpacity: 0.85,
      })
      marker.bindTooltip(`<b>${stop.name}</b>`, { direction: 'top', offset: [0, -5] })
      marker.on('click', () => onSelect(stop))
      marker.addTo(map)
      markersRef.current[stop.name] = marker
    })

    map.fitBounds(L.latLngBounds(withCoords.map(s => [s.lat, s.lon])), { padding: [20, 20], animate: false })
    map.setZoom(map.getZoom() + 1)
    instanceRef.current = map
    return () => { map.remove(); instanceRef.current = null }
  }, [stops])

  useEffect(() => {
    Object.entries(markersRef.current).forEach(([name, marker]) => {
      const active = name === selectedName
      marker.setStyle({
        fillColor: active ? '#f59e0b' : '#38bdf8',
        radius: active ? 10 : 7,
        weight: active ? 3 : 2,
      })
    })
  }, [selectedName])

  if (!stops.some(s => s.lat && s.lon)) return null
  return <div ref={mapRef} className="bus-map" />
}

export default function Buses() {
  const [stops, setStops] = useState([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [departures, setDepartures] = useState([])
  const [loading, setLoading] = useState(true)
  const [depsLoading, setDepsLoading] = useState(false)
  const [error, setError] = useState(null)
  const depsRef = useRef(null)

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
      setDepartures(await getBusDepartures(stop.ids))
    } catch (e) {
      setError(e.message)
    } finally {
      setDepsLoading(false)
      setTimeout(() => depsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
    }
  }, [])

  const filtered = stops.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <h1 className="page-title">Autobusy MZK Tczew</h1>
      <p className="page-subtitle">Wybierz przystanek z mapy lub listy</p>

      <div className="panel">
        {error && <div className="panel-error">⚠️ {error}</div>}

        {loading ? (
          <div className="panel-loading">Ładowanie przystanków…</div>
        ) : (
          <>
            <BusMap stops={stops} selectedName={selected?.name} onSelect={handleSelect} />

            <div className="stop-search-wrap">
              <input
                className="stop-search"
                placeholder="🔍 Szukaj przystanku…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>

            <div className="stop-list">
              {filtered.map(s => (
                <button
                  key={s.name}
                  className={`stop-item ${selected?.name === s.name ? 'active' : ''}`}
                  onClick={() => handleSelect(s)}
                >
                  <span className="stop-name">{s.name}</span>
                </button>
              ))}
            </div>

            {selected && (
              <div className="departures-section" ref={depsRef}>
                <div className="deps-title">
                  Odjazdy z: <strong>{selected.name}</strong>
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
                          <td className="t-headsign">{cleanHeadsign(d.headsign)}</td>
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
    </div>
  )
}
