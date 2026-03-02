const BASE = '/api/schedules'

export async function getBusStops() {
  const res = await fetch(`${BASE}/buses/stops`)
  if (!res.ok) throw new Error('Błąd pobierania przystanków')
  return res.json()
}

export async function getBusDepartures(ids) {
  const param = Array.isArray(ids) ? ids.join(',') : ids
  const res = await fetch(`${BASE}/buses/departures?ids=${encodeURIComponent(param)}`)
  if (!res.ok) throw new Error('Błąd pobierania odjazdów')
  return res.json()
}

export async function getTrainDepartures() {
  const res = await fetch(`${BASE}/trains/departures`)
  if (!res.ok) throw new Error('Błąd pobierania rozkładu pociągów')
  return res.json()
}

export async function getScheduleStatus() {
  const res = await fetch(`${BASE}/status`)
  if (!res.ok) throw new Error('Błąd')
  return res.json()
}
