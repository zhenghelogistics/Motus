import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { getDashboard, getJobs } from '../api'

const fmt = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtGP = (n) => n == null ? '—' : `${Number(n).toFixed(1)}%`

function CountUp({ value, format, duration = 900 }) {
  const [display, setDisplay] = useState(0)
  const rafRef = useRef(null)
  useEffect(() => {
    if (value == null) return
    const target = Number(value)
    if (isNaN(target)) return
    cancelAnimationFrame(rafRef.current)
    const start = performance.now()
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 4)
      setDisplay(target * eased)
      if (progress < 1) rafRef.current = requestAnimationFrame(tick)
      else setDisplay(target)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])
  if (format) return format(display)
  return Math.round(display)
}

function deadlineClass(date) {
  if (!date) return ''
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(date)
  const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24))
  if (diff < 0) return 'deadline-past'
  if (diff <= 3) return 'deadline-soon'
  return 'deadline-ok'
}

function gpClass(gp) {
  if (gp == null) return ''
  if (gp >= 20) return 'gp-high'
  if (gp >= 10) return 'gp-mid'
  return 'gp-low'
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    getDashboard()
      .then(r => { setData(r.data); setLoading(false) })
      .catch(err => {
        const status = err.response?.status
        const body = err.response?.data
        const msg = (typeof body === 'object' ? body?.error : String(body)) || err.response?.statusText || err.message || 'Unknown error'
        setError(`[${status ?? 'no response'}] ${msg}`)
        setLoading(false)
      })
  }, [])

  if (loading) return <div className="empty-state"><div className="spinner spinner-dark" style={{ width: 32, height: 32, margin: '48px auto' }}></div></div>
  if (!data) return <div className="alert alert-error">Failed to load dashboard: {error}</div>

  const { this_month: m, trend, upcoming_deadlines, flagged_jobs, status_counts, missing_costing_count } = data

  return (
    <div>
      <div className="page-header flex-between">
        <div>
          <h1>Dashboard</h1>
          <p>Current month performance overview</p>
        </div>
        <button className="btn btn-primary" onClick={() => navigate('/intake')}>+ New Job</button>
      </div>

      {/* KPI Cards */}
      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">Jobs This Month</div>
          <div className="metric-value blue"><CountUp value={m.jobs} /></div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Revenue</div>
          <div className="metric-value"><CountUp value={m.revenue} format={fmt} /></div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Cost</div>
          <div className="metric-value"><CountUp value={m.cost} format={fmt} /></div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Profit</div>
          <div className={`metric-value ${m.profit >= 0 ? 'green' : ''}`}><CountUp value={m.profit} format={fmt} /></div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg GP%</div>
          <div className={`metric-value ${gpClass(m.gp_percent)}`}><CountUp value={m.gp_percent} format={fmtGP} /></div>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        {/* Job Status Overview — replaces Jobs by Mode */}
        <JobStatusWidget
          statusCounts={status_counts || {}}
          missingCount={missing_costing_count || 0}
          flaggedJobs={flagged_jobs || []}
          navigate={navigate}
        />

        <div className="card">
          <div className="section-title" style={{ borderBottom: 'none', paddingBottom: 0 }}>GP% Trend (6 months)</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={trend} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8F1FA" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} unit="%" />
              <Tooltip formatter={(v) => `${v}%`} />
              <Line type="monotone" dataKey="gp_percent" name="GP%" stroke="#042C53" strokeWidth={2.5} dot={{ fill: '#042C53', r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* Upcoming deadlines */}
        <div className="card">
          <div className="section-title">Upcoming Deadlines (7 days)</div>
          {upcoming_deadlines.length === 0
            ? <p className="text-muted" style={{ fontSize: 13 }}>No jobs due in the next 7 days.</p>
            : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Job No.', 'Shipper', 'Deadline', 'Status'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: '#6B7E93', fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid #D1DCE8', background: 'none' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {upcoming_deadlines.map(j => (
                  <tr key={j.id} className="tr-link" onClick={() => navigate(`/jobs/${j.id}`)}>
                    <td style={{ padding: '7px 8px', fontWeight: 700, color: '#042C53', fontSize: 13 }}>{j.job_number}</td>
                    <td style={{ padding: '7px 8px', fontSize: 13 }}>{j.shipper || '—'}</td>
                    <td style={{ padding: '7px 8px' }}>
                      <span className={deadlineClass(j.deadline_date)} style={{ fontSize: 13 }}>{j.deadline_date || '—'}</span>
                    </td>
                    <td style={{ padding: '7px 8px' }}>
                      <StatusPill status={j.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        </div>

        {/* Flagged jobs */}
        <div className="card">
          <div className="section-title">Jobs Missing Costing</div>
          {flagged_jobs.length === 0
            ? <p className="text-muted" style={{ fontSize: 13 }}>All jobs have billing lines.</p>
            : <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Job No.', 'Shipper', 'Status'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 8px', fontSize: 11, color: '#6B7E93', fontWeight: 700, textTransform: 'uppercase', borderBottom: '1px solid #D1DCE8', background: 'none' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flagged_jobs.map(j => (
                  <tr key={j.id} className="tr-link" onClick={() => navigate(`/jobs/${j.id}`)}>
                    <td style={{ padding: '7px 8px', fontWeight: 700, color: '#042C53', fontSize: 13 }}>{j.job_number}</td>
                    <td style={{ padding: '7px 8px', fontSize: 13 }}>{j.shipper || '—'}</td>
                    <td style={{ padding: '7px 8px' }}><StatusPill status={j.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        </div>
      </div>
    </div>
  )
}

// ── Job Status Overview widget ────────────────────────────────────────────────
const STATUS_META = [
  { key: 'New',        label: 'New',         color: '#185FA5', bg: '#E8F1FA' },
  { key: 'In Progress',label: 'In Progress',  color: '#92400E', bg: '#FEF3C7' },
  { key: 'On Hold',    label: 'On Hold',      color: '#6B7E93', bg: '#F1F4F7' },
  { key: 'Completed',  label: 'Completed',    color: '#065F46', bg: '#D1FAE5' },
]

function JobStatusWidget({ statusCounts, missingCount, flaggedJobs, navigate }) {
  const [active, setActive] = useState(null)
  const [jobs, setJobs] = useState([])
  const [loadingJobs, setLoadingJobs] = useState(false)

  async function toggle(key) {
    if (active === key) { setActive(null); setJobs([]); return }
    setActive(key)
    setJobs([])
    setLoadingJobs(true)
    try {
      if (key === 'missing') {
        setJobs(flaggedJobs)
      } else {
        const { data } = await getJobs({ status: key })
        setJobs(data)
      }
    } catch { setJobs([]) }
    finally { setLoadingJobs(false) }
  }

  const total = STATUS_META.reduce((s, m) => s + (statusCounts[m.key] || 0), 0)

  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
      <div className="section-title" style={{ borderBottom: 'none', paddingBottom: 0 }}>Job Status Overview</div>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '2px 0 14px' }}>{total} active job{total !== 1 ? 's' : ''} — click a status to see details</p>

      {/* Status pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
        {STATUS_META.map(s => {
          const count = statusCounts[s.key] || 0
          const isActive = active === s.key
          return (
            <button key={s.key} onClick={() => toggle(s.key)}
              style={{
                background: isActive ? s.color : s.bg,
                color: isActive ? 'white' : s.color,
                border: `1.5px solid ${s.color}33`,
                borderRadius: 20,
                padding: '6px 14px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'var(--font)',
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                transition: 'all 0.15s',
                outline: 'none',
              }}>
              {s.label}
              <span style={{
                background: isActive ? 'rgba(255,255,255,0.28)' : s.color,
                color: 'white',
                borderRadius: 12,
                padding: '1px 8px',
                fontSize: 11,
                fontWeight: 800,
              }}>{count}</span>
            </button>
          )
        })}

        {/* Missing costing pill */}
        {missingCount > 0 && (
          <button onClick={() => toggle('missing')}
            style={{
              background: active === 'missing' ? '#991B1B' : '#FEF2F2',
              color: active === 'missing' ? 'white' : '#991B1B',
              border: '1.5px solid #FECACA',
              borderRadius: 20,
              padding: '6px 14px',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 700,
              fontFamily: 'var(--font)',
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              transition: 'all 0.15s',
              outline: 'none',
            }}>
            ⚠ Missing Costing
            <span style={{
              background: active === 'missing' ? 'rgba(255,255,255,0.28)' : '#991B1B',
              color: 'white',
              borderRadius: 12,
              padding: '1px 8px',
              fontSize: 11,
              fontWeight: 800,
            }}>{missingCount}</span>
          </button>
        )}
      </div>

      {/* Expanded job list */}
      {active && (
        <div style={{ flex: 1, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          {loadingJobs
            ? <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner spinner-dark" /></div>
            : jobs.length === 0
              ? <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>No jobs found.</p>
              : (
                <div style={{ maxHeight: 260, overflowY: 'auto' }}>
                  {jobs.map(j => {
                    const dl = j.deadline_date
                    let dlCls = ''
                    if (dl) {
                      const today = new Date(); today.setHours(0, 0, 0, 0)
                      const diff = Math.ceil((new Date(dl) - today) / (1000 * 60 * 60 * 24))
                      dlCls = diff < 0 ? 'deadline-past' : diff <= 3 ? 'deadline-soon' : 'deadline-ok'
                    }
                    return (
                      <div key={j.id} onClick={() => navigate(`/jobs/${j.id}`)}
                        className="tr-link"
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 6px', borderBottom: '1px solid var(--border)', borderRadius: 6 }}>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13, marginRight: 8 }}>{j.job_number}</span>
                          {j.customer_ref && <span style={{ fontSize: 11, color: 'var(--blue)', fontWeight: 600, marginRight: 8 }}>{j.customer_ref}</span>}
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {j.shipper || '—'} → {j.consignee || '—'}
                          </span>
                        </div>
                        <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12, fontSize: 11 }}>
                          {j.mode && <div style={{ color: 'var(--text-muted)' }}>{j.mode}</div>}
                          {dl && <span className={dlCls}>Due {dl}</span>}
                        </div>
                      </div>
                    )
                  })}
                  {active === 'missing' && missingCount > flaggedJobs.length && (
                    <p style={{ fontSize: 11, color: 'var(--text-muted)', padding: '8px 6px', textAlign: 'center' }}>
                      Showing first {flaggedJobs.length} of {missingCount} — <span style={{ color: 'var(--blue)', cursor: 'pointer', fontWeight: 600 }} onClick={() => navigate('/jobs')}>view all in tracker</span>
                    </p>
                  )}
                </div>
              )
          }
        </div>
      )}

      {!active && (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>Select a status above to view jobs</p>
        </div>
      )}
    </div>
  )
}

function StatusPill({ status }) {
  const map = { 'New': 'new', 'In Progress': 'inprogress', 'Completed': 'completed', 'On Hold': 'onhold' }
  return <span className={`pill pill-${map[status] || 'new'}`}>{status || 'New'}</span>
}
