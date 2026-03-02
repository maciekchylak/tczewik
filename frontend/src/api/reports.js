const BASE = '/api/reports'

export async function getReportTypes() {
  const res = await fetch(`${BASE}/types`)
  if (!res.ok) throw new Error('Błąd pobierania typów zgłoszeń')
  return res.json()
}

export async function getReports({ type, status, sort = 'votes' } = {}) {
  const params = new URLSearchParams({ sort })
  if (type) params.set('report_type', type)
  if (status) params.set('status', status)
  const res = await fetch(`${BASE}?${params}`)
  if (!res.ok) throw new Error('Błąd pobierania zgłoszeń')
  return res.json()
}

export async function createReport(data) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Błąd tworzenia zgłoszenia')
  }
  return res.json()
}

export async function voteReport(id) {
  const res = await fetch(`${BASE}/${id}/vote`, { method: 'POST' })
  if (res.status === 409) throw new Error('already_voted')
  if (!res.ok) throw new Error('Błąd głosowania')
  return res.json()
}

export async function uploadPhoto(reportId, file) {
  const urlRes = await fetch(`${BASE}/${reportId}/photo-upload-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filename: file.name, content_type: file.type }),
  })
  if (urlRes.status === 501) {
    console.warn('Photo upload not configured on server, skipping.')
    return null
  }
  if (!urlRes.ok) throw new Error('Błąd uzyskiwania URL do uploadu zdjęcia')
  const { upload_url, photo_url } = await urlRes.json()
  const uploadRes = await fetch(upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  })
  if (!uploadRes.ok) throw new Error('Błąd uploadu zdjęcia')
  return photo_url
}

export async function updateReportStatus(id, status, note = '') {
  const res = await fetch(`${BASE}/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, note }),
  })
  if (!res.ok) throw new Error('Błąd aktualizacji statusu')
  return res.json()
}
