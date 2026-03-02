import { useCallback, useEffect, useState } from 'react'
import {
  adminDeleteReport, adminGetReports, adminGetStats,
  adminLogin, adminUpdateStatus, clearToken, getToken,
} from '../api/admin'
import './Admin.css'

const STATUS_CONFIG = {
  new:         { label: 'Nowe',         color: '#2563eb', bg: '#eff6ff' },
  in_progress: { label: 'W realizacji', color: '#d97706', bg: '#fffbeb' },
  resolved:    { label: 'Naprawione',   color: '#16a34a', bg: '#f0fdf4' },
  rejected:    { label: 'Odrzucone',    color: '#dc2626', bg: '#fef2f2' },
}

const REPORT_TYPE_LABELS = {
  pothole:        { label: 'Dziura w drodze', icon: '🕳️' },
  broken_light:   { label: 'Zepsuta latarnia', icon: '💡' },
  illegal_dumping:{ label: 'Dzikie wysypisko', icon: '🗑️' },
}

function typeInfo(t) {
  return REPORT_TYPE_LABELS[t] || { label: t, icon: '📍' }
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: '#64748b', bg: '#f1f5f9' }
  return <span className="a-status-badge" style={{ color: cfg.color, background: cfg.bg }}>{cfg.label}</span>
}

// ── Login screen ───────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      await adminLogin(username, password)
      onLogin()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo">🏙️</div>
        <h1 className="login-title">Panel administratora</h1>
        <p className="login-sub">Tczewik — Zgłoszenia miejskie</p>

        {error && <div className="login-error">⚠️ {error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="login-group">
            <label>Login</label>
            <input
              className="login-input"
              value={username}
              onChange={e => setUsername(e.target.value)}
              placeholder="admin"
              autoFocus
              required
            />
          </div>
          <div className="login-group">
            <label>Hasło</label>
            <input
              className="login-input"
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button className="login-btn" type="submit" disabled={loading}>
            {loading ? 'Logowanie…' : 'Zaloguj się →'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Stats bar ──────────────────────────────────────────────────────────────────
function StatsBar({ stats }) {
  if (!stats) return null
  return (
    <div className="stats-bar">
      <div className="stats-item total">
        <span className="stats-num">{stats.total}</span>
        <span className="stats-lbl">Wszystkich</span>
      </div>
      {Object.entries(STATUS_CONFIG).map(([k, v]) => (
        <div key={k} className="stats-item" style={{ '--c': v.color, '--bg': v.bg }}>
          <span className="stats-num">{stats[k] ?? 0}</span>
          <span className="stats-lbl">{v.label}</span>
        </div>
      ))}
    </div>
  )
}

// ── Status change modal ────────────────────────────────────────────────────────
function StatusModal({ report, onSave, onClose }) {
  const [status, setStatus] = useState(report.status)
  const [note, setNote] = useState(report.status_note || '')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(report.id, status, note)
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Zmień status zgłoszenia</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="modal-body">
          <div className="modal-report-info">
            <span>{typeInfo(report.report_type).icon}</span>
            <div>
              <div className="modal-report-type">{typeInfo(report.report_type).label}</div>
              {report.address_hint && <div className="modal-report-addr">{report.address_hint}</div>}
            </div>
          </div>

          <div className="modal-group">
            <label>Nowy status</label>
            <div className="modal-status-pills">
              {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                <button
                  key={k}
                  className={`modal-status-pill ${status === k ? 'active' : ''}`}
                  style={{ '--c': v.color, '--bg': v.bg }}
                  onClick={() => setStatus(k)}
                >
                  {v.label}
                </button>
              ))}
            </div>
          </div>

          <div className="modal-group">
            <label>Notatka dla mieszkańca <span className="label-opt">(opcjonalna)</span></label>
            <textarea
              className="modal-textarea"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="np. Przekazano do Wydziału Dróg, planowana naprawa w ciągu 14 dni…"
              rows={3}
              maxLength={400}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="modal-btn-cancel" onClick={onClose} disabled={saving}>Anuluj</button>
          <button className="modal-btn-save" onClick={handleSave} disabled={saving}>
            {saving ? 'Zapisywanie…' : '✓ Zapisz zmiany'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Photo modal ────────────────────────────────────────────────────────────────
function PhotoModal({ url, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="photo-modal-card" onClick={e => e.stopPropagation()}>
        <button className="modal-close photo-modal-close" onClick={onClose}>✕</button>
        <img src={url} alt="Zdjęcie zgłoszenia" className="photo-modal-img" />
      </div>
    </div>
  )
}

// ── Report row ─────────────────────────────────────────────────────────────────
function ReportRow({ report, onStatusClick, onDeleteClick, onPhotoClick }) {
  const ti = typeInfo(report.report_type)
  return (
    <tr className={`report-row status-${report.status}`}>
      <td className="col-type">
        <span className="type-icon">{ti.icon}</span>
        <span className="type-label">{ti.label}</span>
      </td>
      <td className="col-addr">
        <div className="addr-main">{report.address_hint || '—'}</div>
        {report.description && <div className="addr-desc">{report.description}</div>}
      </td>
      <td className="col-votes">
        <span className="votes-pill">👍 {report.votes}</span>
      </td>
      <td className="col-date">{formatDate(report.created_at)}</td>
      <td className="col-status">
        <StatusBadge status={report.status} />
        {report.status_note && <div className="status-note">💬 {report.status_note}</div>}
      </td>
      <td className="col-actions">
        {report.photo_url && (
          <button className="action-btn photo-btn" onClick={() => onPhotoClick(report.photo_url)} title="Podgląd zdjęcia">
            🖼️
          </button>
        )}
        <button className="action-btn status-btn" onClick={() => onStatusClick(report)} title="Zmień status">
          ✏️
        </button>
        <button className="action-btn delete-btn" onClick={() => onDeleteClick(report)} title="Usuń">
          🗑️
        </button>
      </td>
    </tr>
  )
}

// ── Main admin panel ───────────────────────────────────────────────────────────
export default function Admin() {
  const [authed, setAuthed] = useState(!!getToken())
  const [reports, setReports] = useState([])
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // Filters
  const [filterStatus, setFilterStatus] = useState('')
  const [filterType, setFilterType] = useState('')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('date')

  // Modals
  const [statusModal, setStatusModal] = useState(null)
  const [photoModal, setPhotoModal] = useState(null)
  const [deleteConfirm, setDeleteConfirm] = useState(null)

  const fetchAll = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const [data, s] = await Promise.all([
        adminGetReports({ status: filterStatus || undefined, report_type: filterType || undefined, sort, search: search || undefined }),
        adminGetStats(),
      ])
      setReports(data.items)
      setStats(s)
    } catch (e) {
      if (e.message === 'AUTH_ERROR') { setAuthed(false); return }
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filterStatus, filterType, sort, search])

  useEffect(() => {
    if (authed) fetchAll()
  }, [authed, fetchAll])

  const handleStatusSave = async (id, status, note) => {
    await adminUpdateStatus(id, status, note)
    fetchAll()
  }

  const handleDelete = async (report) => {
    await adminDeleteReport(report.id)
    setDeleteConfirm(null)
    fetchAll()
  }

  const handleLogout = () => {
    clearToken()
    setAuthed(false)
  }

  if (!authed) return <LoginScreen onLogin={() => setAuthed(true)} />

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-topbar">
        <div className="admin-topbar-left">
          <span className="admin-logo">🏙️</span>
          <div>
            <h1 className="admin-title">Panel administratora</h1>
            <p className="admin-sub">Zarządzanie zgłoszeniami miejskimi</p>
          </div>
        </div>
        <button className="logout-btn" onClick={handleLogout}>Wyloguj →</button>
      </div>

      <StatsBar stats={stats} />

      {/* Filters */}
      <div className="filters-bar">
        <input
          className="filter-search"
          placeholder="🔍 Szukaj w opisie lub adresie…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="filter-select" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="">Wszystkie statusy</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select className="filter-select" value={filterType} onChange={e => setFilterType(e.target.value)}>
          <option value="">Wszystkie typy</option>
          {Object.entries(REPORT_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.icon} {v.label}</option>
          ))}
        </select>
        <select className="filter-select" value={sort} onChange={e => setSort(e.target.value)}>
          <option value="date">🕐 Najnowsze</option>
          <option value="votes">🔥 Najpilniejsze</option>
          <option value="status">📋 Wg statusu</option>
        </select>
        <button className="filter-refresh" onClick={fetchAll} title="Odśwież">↻</button>
      </div>

      {error && <div className="admin-error">⚠️ {error}</div>}

      {/* Table */}
      <div className="table-wrap">
        {loading ? (
          <div className="table-loading">Ładowanie zgłoszeń…</div>
        ) : reports.length === 0 ? (
          <div className="table-empty">
            <div className="table-empty-icon">🕳️</div>
            <p>Brak zgłoszeń spełniających kryteria</p>
          </div>
        ) : (
          <table className="admin-table">
            <thead>
              <tr>
                <th>Typ</th>
                <th>Adres / Opis</th>
                <th>Głosy</th>
                <th>Data</th>
                <th>Status</th>
                <th>Akcje</th>
              </tr>
            </thead>
            <tbody>
              {reports.map(r => (
                <ReportRow
                  key={r.id}
                  report={r}
                  onStatusClick={setStatusModal}
                  onDeleteClick={setDeleteConfirm}
                  onPhotoClick={setPhotoModal}
                />
              ))}
            </tbody>
          </table>
        )}
        {!loading && reports.length > 0 && (
          <div className="table-footer">Pokazano {reports.length} zgłoszeń</div>
        )}
      </div>

      {/* Modals */}
      {statusModal && (
        <StatusModal
          report={statusModal}
          onSave={handleStatusSave}
          onClose={() => setStatusModal(null)}
        />
      )}
      {photoModal && (
        <PhotoModal url={photoModal} onClose={() => setPhotoModal(null)} />
      )}
      {deleteConfirm && (
        <div className="modal-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-card confirm-card" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Usuń zgłoszenie</h3>
              <button className="modal-close" onClick={() => setDeleteConfirm(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="confirm-text">
                Czy na pewno chcesz usunąć zgłoszenie <strong>{typeInfo(deleteConfirm.report_type).icon} {typeInfo(deleteConfirm.report_type).label}</strong>?
                {deleteConfirm.address_hint && <><br /><span className="confirm-addr">{deleteConfirm.address_hint}</span></>}
              </p>
              <p className="confirm-warn">⚠️ Tej operacji nie można cofnąć.</p>
            </div>
            <div className="modal-footer">
              <button className="modal-btn-cancel" onClick={() => setDeleteConfirm(null)}>Anuluj</button>
              <button className="modal-btn-delete" onClick={() => handleDelete(deleteConfirm)}>🗑️ Usuń</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
