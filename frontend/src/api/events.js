const BASE = '/api/events'

export async function getEvents({ sort = 'latest', source = 'all' } = {}) {
  const res = await fetch(`${BASE}?sort=${sort}&source=${source}`)
  if (!res.ok) throw new Error('Błąd ładowania wydarzeń')
  return res.json()
}

export async function voteEvent(eventHash) {
  const res = await fetch(`${BASE}/${eventHash}/vote`, { method: 'POST' })
  if (!res.ok) throw new Error('Błąd głosowania')
  return res.json()
}
