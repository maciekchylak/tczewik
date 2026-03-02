export async function getEvents() {
  const res = await fetch('/api/events')
  if (!res.ok) throw new Error('Błąd pobierania wydarzeń')
  return res.json()
}
