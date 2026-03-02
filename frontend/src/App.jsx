import { Routes, Route, NavLink, Link } from 'react-router'
import Dashboard from './pages/Dashboard.jsx'
import Buses from './pages/Buses.jsx'
import Trains from './pages/Trains.jsx'
import Events from './pages/Events.jsx'
import './App.css'

export default function App() {
  return (
    <div className="app">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">🏙️ Tczewik</Link>
        <div className="navbar-links">
          <NavLink to="/buses">Autobusy</NavLink>
          <NavLink to="/trains">Pociągi</NavLink>
          <NavLink to="/events">Wydarzenia</NavLink>
        </div>
      </nav>
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/buses" element={<Buses />} />
          <Route path="/trains" element={<Trains />} />
          <Route path="/events" element={<Events />} />
        </Routes>
      </main>
    </div>
  )
}
