import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line, CartesianGrid, Legend } from 'recharts'
import { getDashboard } from '../api'

const fmt = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtGP = (n) => n == null ? '—' : `${Number(n).toFixed(1)}%`

function deadlineClass(date) {
  if (!date) return ''
  const today = new Date()
  today.setHours(0,0,0,0)
  const d = new Date(date)
  const diff = Math.ceil((d - today) / (1000*60*60*24))
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
  const navigate = useNavigate()

  useEffect(() => {
    getDashboard().then(r => { setData(r.data); setLoading(false) }).catch(() => setLoading(false))
  }, [])

  if (loading) return <div className="empty-state"><div className="spinner spinner-dark" style={{width:32,height:32,margin:'48px auto'}}></div></div>
  if (!data) return <div className="alert alert-error">Failed to load dashboard.</div>

  const { this_month: m, by_mode, trend, upcoming_deadlines, flagged_jobs } = data

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
          <div className="metric-value blue">{m.jobs}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Revenue</div>
          <div className="metric-value">{fmt(m.revenue)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Cost</div>
          <div className="metric-value">{fmt(m.cost)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Profit</div>
          <div className={`metric-value ${m.profit >= 0 ? 'green' : ''}`}>{fmt(m.profit)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg GP%</div>
          <div className={`metric-value ${gpClass(m.gp_percent)}`}>{fmtGP(m.gp_percent)}</div>
        </div>
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 20 }}>
        <div className="card">
          <div className="section-title" style={{ borderBottom: 'none', paddingBottom: 0 }}>Jobs by Mode</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={by_mode} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E8F1FA" />
              <XAxis dataKey="mode" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v, n) => n === 'revenue' ? fmt(v) : v} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="count" name="Jobs" fill="#185FA5" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

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

function StatusPill({ status }) {
  const map = { 'New': 'new', 'In Progress': 'inprogress', 'Completed': 'completed', 'On Hold': 'onhold' }
  return <span className={`pill pill-${map[status] || 'new'}`}>{status || 'New'}</span>
}
