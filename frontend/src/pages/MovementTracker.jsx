import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { getJobs } from '../api'

const MODES = ['', 'Air Express', 'Air Freight', 'LCL Express', 'LCL', 'Local Delivery', 'Local Clearance & Delivery', 'Sea FCL', 'Sea LCL']
const STATUSES = ['', 'New', 'In Progress', 'Completed', 'On Hold', 'Voided']

const fmt = (n) => n == null ? '—' : `$${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtGP = (n) => n == null || isNaN(n) ? '—' : `${Number(n).toFixed(1)}%`

function deadlineInfo(date) {
  if (!date) return { label: '—', cls: '' }
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(date)
  const diff = Math.ceil((d - today) / (1000*60*60*24))
  if (diff < 0) return { label: date, cls: 'deadline-past' }
  if (diff <= 3) return { label: date, cls: 'deadline-soon' }
  return { label: date, cls: 'deadline-ok' }
}

function gpClass(gp) {
  if (gp == null || isNaN(gp)) return 'text-muted'
  if (gp >= 20) return 'gp-high'
  if (gp >= 10) return 'gp-mid'
  return 'gp-low'
}

function StatusPill({ status }) {
  const map = { 'New': 'new', 'In Progress': 'inprogress', 'Completed': 'completed', 'On Hold': 'onhold', 'Voided': 'voided' }
  return <span className={`pill pill-${map[status] || 'new'}`}>{status || 'New'}</span>
}

const COLS = [
  { key: 'job_number', label: 'Job No.' },
  { key: 'customer_ref', label: 'Ref' },
  { key: 'shipper', label: 'Shipper' },
  { key: 'consignee', label: 'Consignee' },
  { key: 'mode', label: 'Mode' },
  { key: 'agent', label: 'Agent' },
  { key: 'status', label: 'Status' },
  { key: 'deadline_date', label: 'Deadline' },
  { key: 'date_out', label: 'Date Out' },
  { key: 'date_delivered', label: 'Delivered' },
  { key: 'packages', label: 'Pkgs' },
  { key: 'weight', label: 'Wt (kg)' },
  { key: 'cost_sgd', label: 'Cost SGD' },
  { key: 'sale_sgd', label: 'Sale SGD' },
  { key: 'profit_sgd', label: 'Profit SGD' },
  { key: 'gp_percent', label: 'GP%' },
]

export default function MovementTracker() {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterMode, setFilterMode] = useState('')
  const [showVoided, setShowVoided] = useState(false)
  const [sortKey, setSortKey] = useState('id')
  const [sortDir, setSortDir] = useState('desc')
  const navigate = useNavigate()

  function load() {
    setLoading(true)
    getJobs({ search: search || undefined, status: filterStatus || undefined, mode: filterMode || undefined })
      .then(r => { setJobs(r.data); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { load() }, [search, filterStatus, filterMode])

  function handleSort(key) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    return [...jobs]
      .filter(j => showVoided ? true : j.status !== 'Voided')
      .sort((a, b) => {
        const av = a[sortKey], bv = b[sortKey]
        if (av == null && bv == null) return 0
        if (av == null) return 1
        if (bv == null) return -1
        const cmp = typeof av === 'number' ? av - bv : String(av).localeCompare(String(bv))
        return sortDir === 'asc' ? cmp : -cmp
      })
  }, [jobs, sortKey, sortDir, showVoided])

  const voidedCount = jobs.filter(j => j.status === 'Voided').length

  // Summary from currently visible jobs
  const mRevenue = sorted.reduce((s, j) => s + (j.sale_sgd||0), 0)
  const mCost = sorted.reduce((s, j) => s + (j.cost_sgd||0), 0)
  const mProfit = mRevenue - mCost
  const mGP = mRevenue > 0 ? (mProfit/mRevenue)*100 : 0

  function exportExcel() {
    const rows = sorted.map(j => ({
      'Job No.': j.job_number,
      'Customer Ref': j.customer_ref,
      'Shipper': j.shipper,
      'Consignee': j.consignee,
      'Mode': j.mode,
      'Agent': j.agent,
      'Status': j.status,
      'Deadline': j.deadline_date,
      'Date Out': j.date_out,
      'Date Delivered': j.date_delivered,
      'Packages': j.packages,
      'Weight (kg)': j.weight,
      'Cost SGD': j.cost_sgd,
      'Sale SGD': j.sale_sgd,
      'Profit SGD': j.profit_sgd,
      'GP%': j.gp_percent,
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Movement Tracker')
    XLSX.writeFile(wb, `ZHL_Movement_Tracker_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const sortIcon = (key) => sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''

  return (
    <div>
      <div className="page-header flex-between">
        <div>
          <h1>Movement Tracker</h1>
          <p>{jobs.length} job{jobs.length !== 1 ? 's' : ''} found</p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" onClick={exportExcel}>↓ Export Excel</button>
          <button className="btn btn-primary" onClick={() => navigate('/intake')}>+ New Job</button>
        </div>
      </div>

      {/* Metric cards */}
      <div className="metric-grid" style={{ gridTemplateColumns: 'repeat(5,1fr)' }}>
        <div className="metric-card">
          <div className="metric-label">Jobs Shown</div>
          <div className="metric-value blue">{sorted.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Revenue</div>
          <div className="metric-value">{fmt(mRevenue)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total Cost</div>
          <div className="metric-value">{fmt(mCost)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Profit</div>
          <div className={`metric-value ${mProfit >= 0 ? 'green' : ''}`}>{fmt(mProfit)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg GP%</div>
          <div className={`metric-value ${gpClass(mGP)}`}>{fmtGP(mGP)}</div>
        </div>
      </div>

      {/* Filters */}
      <div className="filters-bar">
        <input
          className="form-control search-input"
          placeholder="Search job no., shipper, consignee, ref..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select className="form-control" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          {STATUSES.map(s => <option key={s} value={s}>{s || 'All Statuses'}</option>)}
        </select>
        <select className="form-control" value={filterMode} onChange={e => setFilterMode(e.target.value)}>
          {MODES.map(m => <option key={m} value={m}>{m || 'All Modes'}</option>)}
        </select>
        {(search || filterStatus || filterMode) &&
          <button className="btn btn-ghost btn-sm" onClick={() => { setSearch(''); setFilterStatus(''); setFilterMode('') }}>Clear</button>
        }
        {voidedCount > 0 && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', whiteSpace: 'nowrap', userSelect: 'none' }}>
            <input type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} />
            Show voided ({voidedCount})
          </label>
        )}
      </div>

      {/* Desktop table */}
      <div className="table-wrap">
        {loading
          ? <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner spinner-dark" style={{width:28,height:28}}></span></div>
          : jobs.length === 0
            ? <div className="empty-state"><div className="empty-state-icon">📋</div><h3>No jobs found</h3><p>Create a new job to get started.</p></div>
            : <table className="spreadsheet">
                <thead>
                  <tr>
                    {COLS.map(c => (
                      <th key={c.key} onClick={() => handleSort(c.key)}>
                        {c.label}{sortIcon(c.key)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map(job => {
                    const dl = deadlineInfo(job.deadline_date)
                    const isVoided = job.status === 'Voided'
                    return (
                      <tr key={job.id} className="tr-link" onClick={() => navigate(`/jobs/${job.id}`)}
                        style={isVoided ? { opacity: 0.45, background: '#fafafa' } : {}}>
                        <td style={{ fontWeight: 700, color: 'var(--navy)', whiteSpace: 'nowrap', textDecoration: isVoided ? 'line-through' : 'none' }}>{job.job_number}</td>
                        <td style={{ color: 'var(--blue)', fontWeight: 600 }}>{job.customer_ref || '—'}</td>
                        <td>{job.shipper || '—'}</td>
                        <td>{job.consignee || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}><ModeTag mode={job.mode} /></td>
                        <td>{job.agent || '—'}</td>
                        <td><StatusPill status={job.status} /></td>
                        <td><span className={dl.cls} style={{ whiteSpace: 'nowrap', fontSize: 13 }}>{dl.label}</span></td>
                        <td style={{ whiteSpace: 'nowrap' }}>{job.date_out || '—'}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{job.date_delivered || '—'}</td>
                        <td className="text-right">{job.packages ?? '—'}</td>
                        <td className="text-right">{job.weight != null ? job.weight : '—'}</td>
                        <td className="text-right">{fmt(job.cost_sgd)}</td>
                        <td className="text-right">{fmt(job.sale_sgd)}</td>
                        <td className={`text-right ${job.profit_sgd >= 0 ? 'text-green' : 'text-red'}`} style={{ fontWeight: 600 }}>{fmt(job.profit_sgd)}</td>
                        <td className={`text-right ${gpClass(job.gp_percent)}`}>{fmtGP(job.gp_percent)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
        }
      </div>

      {/* Mobile cards */}
      <div className="job-cards">
        {sorted.map(job => {
          const dl = deadlineInfo(job.deadline_date)
          return (
            <div key={job.id} className="job-card" onClick={() => navigate(`/jobs/${job.id}`)}>
              <div className="job-card-header">
                <div>
                  <div className="job-card-number">{job.job_number}</div>
                  {job.customer_ref && <div className="job-card-ref">Ref: {job.customer_ref}</div>}
                </div>
                <StatusPill status={job.status} />
              </div>
              <div className="job-card-names">
                <strong>{job.shipper || '—'}</strong> → {job.consignee || '—'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{job.mode}</div>
              <div className="job-card-footer">
                <span className={dl.cls} style={{ fontSize: 12 }}>{dl.label !== '—' ? `Due: ${dl.label}` : ''}</span>
                <span className={gpClass(job.gp_percent)} style={{ fontSize: 13 }}>{fmtGP(job.gp_percent)}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ModeTag({ mode }) {
  const colors = {
    'Air Express': { bg: '#EDE9FE', color: '#5B21B6' },
    'Air Freight': { bg: '#F3E8FF', color: '#7C3AED' },
    'LCL Express': { bg: '#FEF3C7', color: '#92400E' },
    'LCL':         { bg: '#FEF9C3', color: '#854D0E' },
    'Sea FCL': { bg: '#DBEAFE', color: '#1D4ED8' },
    'Sea LCL': { bg: '#BFDBFE', color: '#1E40AF' },
    'Local Delivery': { bg: '#D1FAE5', color: '#065F46' },
    'Local Clearance & Delivery': { bg: '#D1FAE5', color: '#065F46' },
  }
  const style = colors[mode] || { bg: '#F1F4F7', color: '#6B7E93' }
  return (
    <span style={{ background: style.bg, color: style.color, padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
      {mode}
    </span>
  )
}
