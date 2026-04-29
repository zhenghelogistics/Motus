import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Dashboard from './pages/Dashboard'
import MovementTracker from './pages/MovementTracker'
import JobDetail from './pages/JobDetail'
import EmailIntake from './pages/EmailIntake'

const NAV = [
  { to: '/',       icon: '▦',  label: 'Dashboard',         exact: true },
  { to: '/jobs',   icon: '≡',  label: 'Movement Tracker',  exact: false },
  { to: '/intake', icon: '+',  label: 'New Job',           exact: false },
]

// Default SGD-based rates (approximate)
const DEFAULT_RATES = {
  USD: 0.745, EUR: 0.688, GBP: 0.589, CNY: 5.41,
  MYR: 3.48, JPY: 113.2, AUD: 1.145, HKD: 5.82, INR: 62.1,
}

function CurrencyConverter({ onClose }) {
  const [amount, setAmount] = useState('1000')
  const [base, setBase] = useState('SGD')
  const [rates, setRates] = useState(DEFAULT_RATES)
  const [fetching, setFetching] = useState(false)
  const [rateDate, setRateDate] = useState('')
  const [editingRate, setEditingRate] = useState(null)

  useEffect(() => {
    setFetching(true)
    fetch('https://open.er-api.com/v6/latest/SGD')
      .then(r => r.json())
      .then(d => {
        if (d.rates) {
          const r = {}
          Object.keys(DEFAULT_RATES).forEach(k => { if (d.rates[k]) r[k] = parseFloat(d.rates[k].toFixed(6)) })
          setRates(r)
          setRateDate(d.time_last_update_utc ? new Date(d.time_last_update_utc).toLocaleDateString('en-SG') : '')
        }
      })
      .catch(() => {})
      .finally(() => setFetching(false))
  }, [])

  const currencies = ['SGD', ...Object.keys(rates)]
  const num = parseFloat(amount) || 0

  function convertToSGD(amt, currency) {
    if (currency === 'SGD') return amt
    return amt / rates[currency]
  }

  function convertFromSGD(sgdAmt, currency) {
    if (currency === 'SGD') return sgdAmt
    return sgdAmt * rates[currency]
  }

  const sgdAmount = convertToSGD(num, base)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16 }}>Currency Converter</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: '16px 20px' }}>
          {/* Input */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              type="number"
              className="form-control"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              style={{ flex: 1, fontSize: 18, fontWeight: 700 }}
              placeholder="Amount"
            />
            <select className="form-control" value={base} onChange={e => setBase(e.target.value)} style={{ width: 100 }}>
              {currencies.map(c => <option key={c}>{c}</option>)}
            </select>
          </div>

          {/* Converted amounts */}
          <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-solid)' }}>
            {currencies.filter(c => c !== base).map(c => {
              const val = convertFromSGD(sgdAmount, c)
              return (
                <div key={c} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                  <span style={{ fontWeight: 700, fontSize: 13, width: 48, color: 'var(--navy)' }}>{c}</span>
                  <span style={{ flex: 1, fontSize: 18, fontWeight: 700 }}>
                    {val.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  {editingRate === c ? (
                    <input
                      type="number"
                      style={{ width: 80, padding: '2px 6px', fontSize: 11, borderRadius: 4, border: '1px solid var(--border-solid)' }}
                      value={rates[c]}
                      onChange={e => setRates(r => ({ ...r, [c]: parseFloat(e.target.value)||r[c] }))}
                      onBlur={() => setEditingRate(null)}
                      autoFocus
                    />
                  ) : (
                    <span
                      onClick={() => setEditingRate(c)}
                      title="Click to edit rate"
                      style={{ fontSize: 10, color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 6px', borderRadius: 4, background: 'var(--bg-hover)' }}
                    >
                      1 SGD = {rates[c]} {c}
                    </span>
                  )}
                </div>
              )
            })}
          </div>

          <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
            {fetching ? 'Fetching live rates...' : rateDate ? `Rates as of ${rateDate} — click rate to edit` : 'Using fallback rates — click rate to edit'}
          </div>
        </div>
      </div>
    </div>
  )
}

function Sidebar({ onCurrencyClick }) {
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
        <button
          className="sidebar-link"
          onClick={onCurrencyClick}
          style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8 }}
        >
          <span className="sidebar-icon">$</span>
          Currency Converter
        </button>
        <div className="sidebar-version">ZHL Ops v1.0</div>
      </div>
    </aside>
  )
}

export default function App() {
  const [showCurrency, setShowCurrency] = useState(false)

  return (
    <BrowserRouter>
      <div className="app-layout">
        <Sidebar onCurrencyClick={() => setShowCurrency(true)} />
        <main className="main-content">
          <Routes>
            <Route path="/"        element={<Dashboard />} />
            <Route path="/jobs"    element={<MovementTracker />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/intake"  element={<EmailIntake />} />
          </Routes>
        </main>
      </div>
      {showCurrency && <CurrencyConverter onClose={() => setShowCurrency(false)} />}
    </BrowserRouter>
  )
}
