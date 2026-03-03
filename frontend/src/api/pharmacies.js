const BASE = '/api/pharmacies'

export async function getPharmacies() {
  const res = await fetch(`${BASE}/list`)
  if (!res.ok) throw new Error('Błąd pobierania listy aptek')
  return res.json()
}
