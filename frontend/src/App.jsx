import { Routes, Route, NavLink, Link, useLocation } from 'react-router'
import Dashboard from './pages/Dashboard.jsx'
import Buses from './pages/Buses.jsx'
import Trains from './pages/Trains.jsx'
import Events from './pages/Events.jsx'
import Reports from './pages/Reports.jsx'
import Admin from './pages/Admin.jsx'
import './App.css'

export default function App() {
  const location = useLocation()
  const isAdmin = location.pathname.startsWith('/admin')

  // Panel admina ma własny pełnoekranowy layout
  if (isAdmin) {
    return (
      <Routes>
        <Route path="/admin" element={<Admin />} />
      </Routes>
    )
  }

  return (
    <div className="app">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">🏙️ Tczewik</Link>
        <div className="navbar-links">
          <NavLink to="/buses">Autobusy</NavLink>
          <NavLink to="/trains">Pociągi</NavLink>
          <NavLink to="/events">Wydarzenia</NavLink>
          <NavLink to="/reports">Zgłoszenia</NavLink>
        </div>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/buses" element={<Buses />} />
          <Route path="/trains" element={<Trains />} />
          <Route path="/events" element={<Events />} />
          <Route path="/reports" element={<Reports />} />
        </Routes>
      </main>
    </div>
  )
}
