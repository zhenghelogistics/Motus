import { BrowserRouter, Routes, Route, NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Dashboard from './pages/Dashboard'
import MovementTracker from './pages/MovementTracker'
import JobDetail from './pages/JobDetail'
import EmailIntake from './pages/EmailIntake'
import Login from './pages/Login'
import AuthCallback from './pages/AuthCallback'
import { AuthProvider, useAuth } from './lib/AuthContext'
import { CHANGELOG } from './changelog'
import { getFxRates, updateFxRates } from './api'

const NAV = [
  { to: '/',       icon: '▦',  label: 'Dashboard',         exact: true },
  { to: '/jobs',   icon: '≡',  label: 'Movement Tracker',  exact: false },
  { to: '/intake', icon: '+',  label: 'New Job',           exact: false },
]

// Default SGD-based rates (approximate)
const DEFAULT_RATES = {
  USD: 0.745, IDR: 11900, EUR: 0.688, GBP: 0.589, MYR: 3.48,
  AUD: 1.145, CNY: 5.41, JPY: 113.2, HKD: 5.82, INR: 62.1,
}
const FX_ORDER = ['USD', 'IDR', 'EUR', 'GBP', 'MYR', 'AUD', 'CNY', 'JPY', 'HKD', 'INR']
const sortedRateEntries = (rates) => FX_ORDER.filter(c => c in rates).map(c => [c, rates[c]])

const SEEN_KEY = 'changelog_seen_count'

function WhatsNewModal({ onClose }) {
  const navigate = useNavigate()

  useEffect(() => {
    localStorage.setItem(SEEN_KEY, String(CHANGELOG.length))
  }, [])

  function go(route) {
    onClose()
    navigate(route)
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16 }}>What's New</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: '4px 20px 20px', maxHeight: '70vh', overflowY: 'auto' }}>
          {CHANGELOG.map((entry, i) => (
            <div key={entry.id} style={{
              borderLeft: `3px solid ${i === 0 ? '#185FA5' : '#D1DCE8'}`,
              paddingLeft: 16,
              paddingTop: 14,
              paddingBottom: 14,
              borderBottom: i < CHANGELOG.length - 1 ? '1px solid var(--border)' : 'none',
              marginLeft: 4,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--navy)', flex: 1 }}>{entry.title}</span>
                <span style={{
                  fontSize: 10, fontWeight: 700, color: i === 0 ? '#185FA5' : '#6B7E93',
                  background: i === 0 ? '#E8F1FA' : 'var(--bg-hover)',
                  borderRadius: 6, padding: '2px 7px', flexShrink: 0, whiteSpace: 'nowrap',
                }}>{entry.date}</span>
              </div>
              <p style={{ fontSize: 13, color: '#4A5568', lineHeight: 1.6, margin: '0 0 10px' }}>{entry.description}</p>
              {entry.route && (
                <button
                  className="btn btn-sm"
                  style={{ fontSize: 12, padding: '4px 12px', border: '1.5px solid var(--navy)', color: 'var(--navy)', background: 'transparent', borderRadius: 6, cursor: 'pointer', fontFamily: 'var(--font)' }}
                  onClick={() => go(entry.route)}
                >
                  {entry.routeLabel} →
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function nameFromEmail(email) {
  if (!email) return ''
  const prefix = email.split('@')[0]
  return prefix.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ')
}

function CurrencyConverter({ onClose, onRatesSaved }) {
  const [amount, setAmount] = useState('1000')
  const [base, setBase] = useState('SGD')
  const [rates, setRates] = useState(DEFAULT_RATES)
  const [updatedAt, setUpdatedAt] = useState(null)
  const [updatedBy, setUpdatedBy] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tab, setTab] = useState('converter')

  useEffect(() => {
    getFxRates()
      .then(r => {
        setRates(r.data.rates || DEFAULT_RATES)
        setUpdatedAt(r.data.updated_at)
        setUpdatedBy(r.data.updated_by)
      })
      .catch(() => {})
  }, [])

  async function saveRates() {
    setSaving(true)
    try {
      const r = await updateFxRates(rates)
      setUpdatedAt(r.data.updated_at)
      setUpdatedBy(r.data.updated_by)
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
      if (onRatesSaved) onRatesSaved(rates)
    } finally { setSaving(false) }
  }

  const currencies = ['SGD', ...Object.keys(rates)]
  const num = parseFloat(amount) || 0
  const sgdAmount = base === 'SGD' ? num : num / (rates[base] || 1)

  const lastUpdatedLabel = updatedAt
    ? `Last set ${new Date(updatedAt).toLocaleDateString('en-SG')}${updatedBy ? ' by ' + nameFromEmail(updatedBy) : ''}`
    : 'Rates not yet saved'

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16 }}>FX Rates & Converter</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', padding: '0 20px' }}>
          {['converter', 'rates'].map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: 'none', border: 'none', padding: '10px 16px', cursor: 'pointer',
              fontWeight: tab === t ? 700 : 400, fontSize: 13,
              color: tab === t ? 'var(--navy)' : 'var(--text-muted)',
              borderBottom: tab === t ? '2px solid var(--navy)' : '2px solid transparent',
            }}>
              {t === 'converter' ? 'Converter' : 'Manage Rates'}
            </button>
          ))}
        </div>

        <div className="modal-body" style={{ padding: '16px 20px' }}>
          {tab === 'converter' ? (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <input type="number" className="form-control" value={amount}
                  onChange={e => setAmount(e.target.value)}
                  style={{ flex: 1, fontSize: 18, fontWeight: 700 }} placeholder="Amount" />
                <select className="form-control" value={base} onChange={e => setBase(e.target.value)} style={{ width: 100 }}>
                  {currencies.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-solid)' }}>
                {['SGD', ...FX_ORDER].filter(c => c !== base && (c === 'SGD' || c in rates)).map(c => {
                  const val = c === 'SGD' ? sgdAmount : sgdAmount * (rates[c] || 1)
                  return (
                    <div key={c} style={{ display: 'flex', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                      <span style={{ fontWeight: 700, fontSize: 13, width: 48, color: 'var(--navy)' }}>{c}</span>
                      <span style={{ flex: 1, fontSize: 18, fontWeight: 700 }}>
                        {val.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </span>
                      <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>1 SGD = {rates[c]} {c}</span>
                    </div>
                  )
                })}
              </div>
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>{lastUpdatedLabel}</div>
            </>
          ) : (
            <>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
                Set your monthly rates below (1 SGD = X). Click Save when done.
              </p>
              <div style={{ borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-solid)', marginBottom: 14 }}>
                {sortedRateEntries(rates).map(([c, r]) => (
                  <div key={c} style={{ display: 'flex', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg)', gap: 10 }}>
                    <span style={{ fontWeight: 700, fontSize: 13, width: 48, color: 'var(--navy)' }}>{c}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>1 SGD =</span>
                    <input type="number" step="any" min="0"
                      style={{ width: 110, padding: '4px 8px', fontSize: 13, fontWeight: 600, borderRadius: 4, border: '1px solid var(--border-solid)', textAlign: 'right' }}
                      value={r}
                      onChange={e => setRates(prev => ({ ...prev, [c]: parseFloat(e.target.value) || prev[c] }))} />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)', width: 32 }}>{c}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{lastUpdatedLabel}</span>
                <button className="btn btn-primary btn-sm" onClick={saveRates} disabled={saving}>
                  {saving ? 'Saving...' : saved ? '✓ Saved!' : 'Save Rates'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function FxReminderBanner({ updatedAt, onOpenRates }) {
  const today = new Date()
  const day = today.getDate()
  const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate()
  const daysLeft = daysInMonth - day

  const isFirstOfMonth = day === 1
  const isMonthEnd = daysLeft <= 2

  if (!isFirstOfMonth && !isMonthEnd) return null

  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1)
    .toLocaleString('en-SG', { month: 'long', year: 'numeric' })
  const lastSet = updatedAt ? new Date(updatedAt).toLocaleDateString('en-SG') : null
  const msg = isFirstOfMonth
    ? `New month — please update FX rates for ${nextMonth}.`
    : `${daysLeft === 0 ? 'Last day of month' : `${daysLeft} day${daysLeft > 1 ? 's' : ''} left`} — update FX rates for ${nextMonth} before month-end.`

  return (
    <div style={{
      background: '#FEF3C7', borderBottom: '1px solid #F59E0B',
      padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13,
    }}>
      <span>⚠</span>
      <span style={{ flex: 1, color: '#92400E', fontWeight: 500 }}>
        {msg}{lastSet ? ` Last set: ${lastSet}.` : ''}
      </span>
      <button className="btn btn-sm" onClick={onOpenRates}
        style={{ background: '#F59E0B', color: '#fff', border: 'none', fontWeight: 600, fontSize: 12 }}>
        Update Rates
      </button>
    </div>
  )
}

function Sidebar({ onCurrencyClick, onWhatsNewClick, unreadCount }) {
  const { user, signOut } = useAuth()

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div style={{ width: '100%' }}>
          <img
            src="/logo-cropped.png"
            alt="Zhenghe Logistics"
            style={{ width: '100%', height: 'auto', display: 'block', marginBottom: 4 }}
          />
          <div className="sidebar-sub" style={{ paddingLeft: 2 }}>Operations Tool</div>
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
          onClick={onWhatsNewClick}
          style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 4, position: 'relative' }}
        >
          <span className="sidebar-icon">★</span>
          What's New
          {unreadCount > 0 && (
            <span style={{
              position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
              background: '#EF4444', color: 'white', borderRadius: 10,
              fontSize: 10, fontWeight: 800, padding: '1px 6px', minWidth: 18, textAlign: 'center',
            }}>{unreadCount}</span>
          )}
        </button>

        <button
          className="sidebar-link"
          onClick={onCurrencyClick}
          style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 8 }}
        >
          <span className="sidebar-icon">$</span>
          Currency Converter
        </button>

        {/* Logged-in user + sign out */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: 10, marginTop: 4 }}>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginBottom: 6, paddingLeft: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </div>
          <button
            className="sidebar-link"
            onClick={signOut}
            style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.6)', fontSize: 13 }}
          >
            <span className="sidebar-icon" style={{ opacity: 0.6 }}>⏻</span>
            Sign Out
          </button>
        </div>

        <div className="sidebar-version">ZHL Ops v1.0</div>
      </div>
    </aside>
  )
}

function HashErrorBanner() {
  const hash = window.location.hash
  if (!hash.includes('error=')) return null
  const params = new URLSearchParams(hash.replace('#', ''))
  const desc = params.get('error_description')?.replace(/\+/g, ' ') || 'Authentication error'
  const code = params.get('error_code')
  return (
    <div style={{
      minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'linear-gradient(135deg, #042C53 0%, #185FA5 100%)',
    }}>
      <div style={{
        background: '#fff', borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 380,
        boxShadow: '0 20px 60px rgba(0,0,0,0.25)', textAlign: 'center',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 56, height: 56, borderRadius: 14, background: '#042C53',
          fontSize: 20, fontWeight: 900, color: '#fff', letterSpacing: '-1px', marginBottom: 16,
        }}>ZHL</div>
        <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#042C53', marginBottom: 8 }}>
          {code === 'otp_expired' ? 'Link expired' : 'Verification failed'}
        </div>
        <div style={{ fontSize: 13, color: '#6B7E93', marginBottom: 8, lineHeight: 1.6 }}>
          {code === 'otp_expired'
            ? 'This confirmation link has expired. Please sign up again to receive a new one.'
            : desc}
        </div>
        <button
          className="btn btn-primary"
          style={{ width: '100%', justifyContent: 'center', height: 44, marginTop: 12 }}
          onClick={() => { window.location.href = '/' }}
        >
          Back to Sign In
        </button>
      </div>
    </div>
  )
}

function AppShell() {
  const { user, loading } = useAuth()
  const [showCurrency, setShowCurrency] = useState(false)
  const [showWhatsNew, setShowWhatsNew] = useState(false)
  const [fxUpdatedAt, setFxUpdatedAt] = useState(null)
  const seen = parseInt(localStorage.getItem(SEEN_KEY) || '0', 10)
  const unreadCount = Math.max(0, CHANGELOG.length - seen)

  useEffect(() => {
    getFxRates().then(r => setFxUpdatedAt(r.data.updated_at)).catch(() => {})
  }, [])

  // Supabase redirects auth errors to root with #error=... hash fragments
  if (window.location.hash.includes('error=')) return <HashErrorBanner />

  // Auth callback must be accessible without a session
  if (window.location.pathname === '/auth/callback') return <AuthCallback />

  // Show nothing while we check if the user is already logged in
  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#042C53' }}>
      <span className="spinner" style={{ width: 32, height: 32, borderColor: 'rgba(255,255,255,0.3)', borderTopColor: '#fff' }}></span>
    </div>
  )

  // Not logged in → show login page
  if (!user) return <Login />

  // Logged in → show the app
  return (
    <div className="app-layout">
      <Sidebar
        onCurrencyClick={() => setShowCurrency(true)}
        onWhatsNewClick={() => setShowWhatsNew(true)}
        unreadCount={unreadCount}
      />
      <main className="main-content">
        <FxReminderBanner updatedAt={fxUpdatedAt} onOpenRates={() => setShowCurrency(true)} />
        <Routes>
          <Route path="/"         element={<Dashboard />} />
          <Route path="/jobs"     element={<MovementTracker />} />
          <Route path="/jobs/:id" element={<JobDetail />} />
          <Route path="/intake"   element={<EmailIntake />} />
          <Route path="/auth/callback" element={<AuthCallback />} />
        </Routes>
      </main>
      {showCurrency && <CurrencyConverter onClose={() => setShowCurrency(false)} onRatesSaved={rates => { setFxUpdatedAt(new Date().toISOString()) }} />}
      {showWhatsNew && <WhatsNewModal onClose={() => setShowWhatsNew(false)} />}
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </BrowserRouter>
  )
}
