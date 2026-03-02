const BASE = '/api/alerts'

export async function getAlerts() {
  const res = await fetch(`${BASE}/feed`)
  if (!res.ok) throw new Error('Błąd pobierania alertów')
  return res.json()
}

export async function clearAlertsCache() {
  const res = await fetch(`${BASE}/cache/clear`, { method: 'POST' })
  if (!res.ok) throw new Error('Błąd czyszczenia cache')
  return res.json()
}
