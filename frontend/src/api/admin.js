const BASE = '/api/admin'

// ── Token storage ──────────────────────────────────────
export function getToken() {
  return sessionStorage.getItem('admin_token')
}
function setToken(t) {
  sessionStorage.setItem('admin_token', t)
}
export function clearToken() {
  sessionStorage.removeItem('admin_token')
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${getToken()}`,
  }
}

async function handleResponse(res) {
  if (res.status === 401 || res.status === 403) {
    clearToken()
    throw new Error('AUTH_ERROR')
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Błąd ${res.status}`)
  }
  if (res.status === 204) return null
  return res.json()
}

// ── Auth ───────────────────────────────────────────────
export async function adminLogin(username, password) {
  const res = await fetch(`${BASE}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Nieprawidłowy login lub hasło')
  }
  const data = await res.json()
  setToken(data.access_token)
  return data
}

// ── Reports ────────────────────────────────────────────
export async function adminGetReports({ status, report_type, sort, search, offset = 0, limit = 500 } = {}) {
  const params = new URLSearchParams()
  if (status) params.set('status', status)
  if (report_type) params.set('report_type', report_type)
  if (sort) params.set('sort', sort)
  if (search) params.set('search', search)
  params.set('offset', offset)
  params.set('limit', limit)

  const res = await fetch(`${BASE}/reports?${params}`, { headers: authHeaders() })
  return handleResponse(res)
}

export async function adminUpdateStatus(id, status, note = '') {
  const res = await fetch(`${BASE}/reports/${id}/status`, {
    method: 'PATCH',
    headers: authHeaders(),
    body: JSON.stringify({ status, note }),
  })
  return handleResponse(res)
}

export async function adminDeleteReport(id) {
  const res = await fetch(`${BASE}/reports/${id}`, {
    method: 'DELETE',
    headers: authHeaders(),
  })
  return handleResponse(res)
}

export async function adminGetStats() {
  const res = await fetch(`${BASE}/stats`, { headers: authHeaders() })
  return handleResponse(res)
}
