const BASE = '/api/city'

export async function getWeather() {
  const res = await fetch(`${BASE}/weather`)
  if (!res.ok) throw new Error('Błąd pobierania pogody')
  return res.json()
}

export async function getWaterLevel() {
  const res = await fetch(`${BASE}/water`)
  if (!res.ok) throw new Error('Błąd pobierania stanu wody')
  return res.json()
}
