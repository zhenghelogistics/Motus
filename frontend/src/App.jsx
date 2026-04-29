import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Dashboard from './pages/Dashboard'
import MovementTracker from './pages/MovementTracker'
import JobDetail from './pages/JobDetail'
import EmailIntake from './pages/EmailIntake'

const NAV = [
  { to: '/',       icon: '▦',  label: 'Dashboard',         exact: true },
  { to: '/jobs',   icon: '≡',  label: 'Movement Tracker',  exact: false },
  { to: '/intake', icon: '+',  label: 'New Job',           exact: false },
]

function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-logo">ZHL</div>
        <div>
          <div className="sidebar-title">Zhenghe Logistics</div>
          <div className="sidebar-sub">Operations Tool</div>
        </div>
      </div>

      <div className="sidebar-section-label">Main Menu</div>

      <nav className="sidebar-nav">
        {NAV.map(({ to, icon, label, exact }) => (
          <NavLink
            key={to}
            to={to}
            end={exact}
            className={({ isActive }) => `sidebar-link${isActive ? ' active' : ''}`}
          >
            <span className="sidebar-icon">{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-bottom">
        <div className="sidebar-version">ZHL Ops v1.0</div>
      </div>
    </aside>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar />
        <main className="main-content">
          <Routes>
            <Route path="/"        element={<Dashboard />} />
            <Route path="/jobs"    element={<MovementTracker />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/intake"  element={<EmailIntake />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
