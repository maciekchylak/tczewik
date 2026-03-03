import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import './Parking.css'

const TCZEW_LAT = 54.0924
const TCZEW_LON = 18.7779
const TCZEW_ZOOM = 14

const ZONE_CONFIG = {
  A:    { label: 'Strefa A – Centrum',    color: '#2563eb', bg: '#eff6ff', hours: 'Pon–Pt 8:00–17:00' },
  B:    { label: 'Strefa B – Zewnętrzna', color: '#7c3aed', bg: '#f5f3ff', hours: 'Pon–Pt 8:00–17:00' },
  C:    { label: 'Strefa C – Pomorska',   color: '#d97706', bg: '#fffbeb', hours: '24/7 (pierwsze 20 min gratis)' },
  FREE: { label: 'Bezpłatny',            color: '#15803d', bg: '#f0fdf4', hours: 'Całą dobę' },
}

const RATES_AB = [
  { period: '30 min',          price: '1,00 zł' },
  { period: '1 godzina',       price: '2,00 zł' },
  { period: '2 godzina',       price: '2,40 zł' },
  { period: '3 godzina',       price: '2,80 zł' },
  { period: 'Kolejne godziny', price: '2,00 zł' },
  { period: 'Bilet dzienny',   price: '14,00 zł' },
]

const RATES_C = [
  { period: '30 min',          price: '2,25 zł' },
  { period: '1 godzina',       price: '4,50 zł' },
  { period: '2 godzina',       price: '5,40 zł' },
  { period: '3 godzina',       price: '6,40 zł' },
  { period: 'Kolejne godziny', price: '4,50 zł' },
  { period: 'Bilet dzienny',   price: '—' },
]

const ZONE_A_POLYGON = [
  [54.0905, 18.7905],
  [54.0905, 18.8025],
  [54.0840, 18.8025],
  [54.0840, 18.7905],
]

const STREETS_A = [
  'pl. Gen. Józefa Hallera', 'pl. Św. Grzegorza', 'ul. Ogrodowa', 'ul. Łazienna',
  'ul. Jarosława Dąbrowskiego', 'ul. Dominikańska', 'ul. Garncarska', 'ul. Kościuszki',
  'ul. Lipowa', 'ul. Okrzei', 'ul. Podgórna', 'ul. Podmurna', 'ul. Skromna',
  'ul. Słowackiego', 'ul. Ściegiennego', 'ul. Wyszyńskiego',
]

const PARKING_LOTS = [
  { id: 'a1', zone: 'A',    name: 'Parking pl. Hallera',                   lat: 54.0871, lon: 18.7993, spots: null },
  { id: 'b1', zone: 'B',    name: 'Parking Obrońców Westerplatte',         lat: 54.0877, lon: 18.7910, spots: null },
  { id: 'b2', zone: 'B',    name: 'Parking Żwirki (Manhattan)',            lat: 54.0960, lon: 18.7651, spots: null },
  { id: 'b3', zone: 'B',    name: 'Parking al. Zwycięstwa',                lat: 54.0934, lon: 18.7861, spots: null },
  { id: 'c1', zone: 'C',    name: 'Parking Pomorska (Galeria Kociewska)', lat: 54.0877, lon: 18.7830, spots: null },
  { id: 'f1', zone: 'FREE', name: 'Parking dolny (centrum komunik.)',      lat: 54.0884, lon: 18.7765, spots: 350 },
  { id: 'f2', zone: 'FREE', name: 'Parking wielopoziomowy',                lat: 54.0880, lon: 18.7780, spots: 102 },
  { id: 'f3', zone: 'FREE', name: 'Parking ul. Ściegiennego',              lat: 54.0862, lon: 18.7873, spots: 50 },
]

const FREE_LOTS = PARKING_LOTS.filter(p => p.zone === 'FREE')

// ── Map component ───────────────────────────────────────────────────────────

function ParkingMap() {
  const mapRef      = useRef(null)
  const instanceRef = useRef(null)

  useEffect(() => {
    if (!mapRef.current || instanceRef.current) return
    const map = L.map(mapRef.current)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
      maxZoom: 19,
    }).addTo(map)
    map.setView([TCZEW_LAT, TCZEW_LON], TCZEW_ZOOM)

    // Zone A polygon
    const cfgA = ZONE_CONFIG['A']
    L.polygon(ZONE_A_POLYGON, {
      color: cfgA.color,
      fillColor: cfgA.color,
      fillOpacity: 0.12,
      weight: 2,
    })
      .bindPopup(`
        <div style="font-family:system-ui;line-height:1.6;min-width:190px">
          <div style="font-weight:700;font-size:0.92rem;margin-bottom:4px">Strefa A – Centrum Historyczne</div>
          <div style="font-size:0.82rem;color:#475569">🕐 ${cfgA.hours}</div>
          <div style="font-size:0.82rem;color:#475569">💰 1h: 2,00 zł | Bilet dzienny: 14,00 zł</div>
          <div style="font-size:0.82rem;color:#dc2626;margin-top:4px">⚠️ Kara za brak biletu: 100 zł</div>
        </div>
      `)
      .addTo(map)

    // Parking markers
    PARKING_LOTS.forEach(p => {
      const cfg = ZONE_CONFIG[p.zone]
      const spotsHtml = p.spots != null
        ? `<div style="font-size:0.82rem;color:#475569">🚗 Miejsc: ${p.spots}</div>`
        : ''
      const priceHtml = p.zone !== 'FREE'
        ? `<div style="font-size:0.82rem;color:#475569">💰 1h: ${p.zone === 'C' ? '4,50 zł' : '2,00 zł'}</div>
           <div style="font-size:0.82rem;color:#dc2626">⚠️ Kara: 100 zł</div>`
        : `<div style="font-size:0.82rem;font-weight:700;color:#15803d">Bezpłatny</div>`

      L.circleMarker([p.lat, p.lon], {
        radius:      10,
        fillColor:   cfg.color,
        color:       '#fff',
        weight:      2,
        fillOpacity: 0.9,
      })
        .bindPopup(`
          <div style="min-width:200px;font-family:system-ui;line-height:1.6">
            <div style="font-weight:700;font-size:0.92rem;margin-bottom:5px">🅿️ ${p.name}</div>
            <span style="display:inline-block;padding:1px 9px;border-radius:10px;background:${cfg.bg};color:${cfg.color};font-weight:700;font-size:0.78rem;margin-bottom:6px">${cfg.label}</span>
            <div style="font-size:0.82rem;color:#475569">🕐 ${cfg.hours}</div>
            ${spotsHtml}
            ${priceHtml}
          </div>
        `, { maxWidth: 270 })
        .addTo(map)
    })

    instanceRef.current = map
    return () => { map.remove(); instanceRef.current = null }
  }, [])

  return <div ref={mapRef} className="park-map" />
}

// ── Main page ───────────────────────────────────────────────────────────────

export default function Parking() {
  const [activeTab, setActiveTab] = useState('map')

  const TABS = [
    { id: 'map',   label: '🗺️ Mapa' },
    { id: 'rates', label: '💰 Opłaty' },
    { id: 'info',  label: 'ℹ️ Informacje' },
  ]

  return (
    <div className="park-page">
      <div className="park-header">
        <h1 className="page-title">Parkingi w Tczewie</h1>
        <p className="page-subtitle">
          Płatne strefy parkowania · Operator: <strong>City Parking Group</strong> · Uchwała Nr XLII/470/2022
        </p>
      </div>

      <div className="park-legend-row">
        {Object.entries(ZONE_CONFIG).map(([key, cfg]) => (
          <span key={key} className="park-legend-chip" style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.color }}>
            <span className="park-legend-dot" style={{ background: cfg.color }} />
            {cfg.label}
          </span>
        ))}
      </div>

      <div className="park-tabs">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`park-tab ${activeTab === t.id ? 'active' : ''}`}
            onClick={() => setActiveTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'map' && (
        <div className="park-map-section">
          <div className="park-map-legend">
            {Object.entries(ZONE_CONFIG).map(([key, cfg]) => (
              <span key={key} className="park-map-legend-item">
                <span className="park-map-legend-dot" style={{ background: cfg.color }} />
                {cfg.label}
              </span>
            ))}
          </div>
          <ParkingMap />
          <p className="park-map-note">Kliknij marker lub niebieski obszar Strefy A, aby zobaczyć szczegóły i opłaty.</p>
        </div>
      )}

      {activeTab === 'rates' && (
        <div className="park-rates">
          <div className="park-rates-grid">
            <div className="park-rates-card">
              <h3 className="park-rates-title" style={{ color: '#2563eb' }}>Strefa A + B</h3>
              <p className="park-rates-hours">Pon–Pt 8:00–17:00</p>
              <table className="park-table">
                <thead>
                  <tr><th>Czas parkowania</th><th>Opłata</th></tr>
                </thead>
                <tbody>
                  {RATES_AB.map(r => (
                    <tr key={r.period}>
                      <td>{r.period}</td>
                      <td className="park-price">{r.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="park-rates-card">
              <h3 className="park-rates-title" style={{ color: '#d97706' }}>Strefa C – Pomorska</h3>
              <p className="park-rates-hours">Całą dobę · pierwsze 20 min bezpłatnie</p>
              <table className="park-table">
                <thead>
                  <tr><th>Czas parkowania</th><th>Opłata</th></tr>
                </thead>
                <tbody>
                  {RATES_C.map(r => (
                    <tr key={r.period}>
                      <td>{r.period}</td>
                      <td className="park-price">{r.price}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="park-info-boxes">
            <div className="park-info-box park-info-discount">
              <h4>Ulgi</h4>
              <ul>
                <li><strong>Karta Mieszkańca Tczewa:</strong> 50% zniżki (1 pojazd)</li>
                <li><strong>Abonament miesięczny:</strong> 50 zł/mies. (mieszkańcy ulic Strefy A)</li>
              </ul>
            </div>
            <div className="park-info-box park-info-free">
              <h4>Zwolnienia z opłat</h4>
              <ul>
                <li>Osoby z kartą parkingową (niepełnosprawni)</li>
                <li>Pojazdy uprzywilejowane</li>
                <li>Taksówki</li>
              </ul>
            </div>
            <div className="park-info-box park-info-penalty">
              <h4>⚠️ Kara za brak biletu</h4>
              <div className="park-penalty-amount">100 zł</div>
              <p>Opłata dodatkowa pobierana przez kontrolerów City Parking Group.</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'info' && (
        <div className="park-info-tab">
          <div className="park-info-section">
            <h3>Ulice w Strefie A – Centrum Historyczne</h3>
            <div className="park-streets-grid">
              {STREETS_A.map(s => (
                <span key={s} className="park-street-chip">{s}</span>
              ))}
            </div>
          </div>

          <div className="park-info-section">
            <h3>Bezpłatne parkingi</h3>
            <div className="park-free-list">
              {FREE_LOTS.map(p => (
                <div key={p.id} className="park-free-card">
                  <span className="park-free-icon">🅿️</span>
                  <div>
                    <div className="park-free-name">{p.name}</div>
                    {p.spots && <div className="park-free-spots">{p.spots} miejsc</div>}
                  </div>
                  <span className="park-free-badge">Bezpłatny</span>
                </div>
              ))}
              <div className="park-free-card">
                <span className="park-free-icon">🅿️</span>
                <div>
                  <div className="park-free-name">Bulwar Nadwiślański</div>
                  <div className="park-free-spots">Bezpłatny</div>
                </div>
                <span className="park-free-badge">Bezpłatny</span>
              </div>
            </div>
          </div>

          <div className="park-info-section">
            <h3>Kontakt i informacje</h3>
            <div className="park-contact-grid">
              <div className="park-contact-card">
                <div className="park-contact-label">Operator</div>
                <div className="park-contact-value">City Parking Group sp. z o.o.</div>
              </div>
              <div className="park-contact-card">
                <div className="park-contact-label">Podstawa prawna</div>
                <div className="park-contact-value">Uchwała Nr XLII/470/2022 Rady Miejskiej w Tczewie</div>
              </div>
              <div className="park-contact-card">
                <div className="park-contact-label">Reklamacje / info</div>
                <div className="park-contact-value">Biuro Obsługi Mieszkańca, ul. 30 Stycznia 1, Tczew</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
