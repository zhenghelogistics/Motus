import { useState, useEffect, useMemo } from 'react'
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from 'recharts'
import { getCompanyStats, getCompanyList } from '../api'

// ── helpers ───────────────────────────────────────────────────────────────────

const fmt   = (n) => `S$${Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const fmtFull = (n) => `S$${Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtN  = (n, dp = 2) => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: dp, maximumFractionDigits: dp })

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3]

const MODE_COLORS = ['#185FA5','#0F766E','#B45309','#7C3AED','#DC2626','#0369A1','#15803D']

function gpColor(gp) {
  return gp >= 20 ? '#15803D' : gp >= 0 ? '#B45309' : '#DC2626'
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: 'var(--surface)', border: '1px solid var(--border-solid)', borderRadius: 8,
      padding: '10px 14px', fontSize: 12,
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--heading)' }}>{label}</div>
      {payload.map(p => (
        <div key={p.name} style={{ color: p.color, display: 'flex', gap: 8, justifyContent: 'space-between' }}>
          <span>{p.name}</span>
          <span style={{ fontWeight: 600 }}>{typeof p.value === 'number' && p.value > 100 ? fmt(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── Filter Label ──────────────────────────────────────────────────────────────

function FilterLabel({ children }) {
  return (
    <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
      {children}
    </label>
  )
}

// ── Summary Card ──────────────────────────────────────────────────────────────

function SummaryCard({ label, value, color, sub }) {
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border-solid)', borderRadius: 10, padding: '12px 14px', flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 9, fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '0.06em', marginBottom: 5, textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 900, color: color || 'var(--heading)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</div>
      {sub != null && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function CompanyStats() {
  // filter state
  const [company, setCompany]   = useState('__all__')
  const [companySearch, setCompanySearch] = useState('')
  const [mode, setMode]         = useState('__all__')
  const [year, setYear]         = useState(CURRENT_YEAR)
  const [viewMode, setViewMode] = useState('yearly')
  const [month, setMonth]       = useState(new Date().getMonth() + 1)
  const [showDropdown, setShowDropdown] = useState(false)

  // data state
  const [companies, setCompanies] = useState([])
  const [modes, setModes]         = useState([])
  const [stats, setStats]         = useState(null)
  const [loading, setLoading]     = useState(false)
  const [listLoading, setListLoading] = useState(true)
  const [error, setError]         = useState('')

  // Load company + mode lists on mount
  useEffect(() => {
    setListLoading(true)
    getCompanyList()
      .then(({ data }) => {
        setCompanies(data.companies || [])
        setModes(data.modes || [])
      })
      .catch(() => {})
      .finally(() => setListLoading(false))
  }, [])

  // Fetch stats whenever filters change
  useEffect(() => {
    fetchStats()
  }, [company, mode, year, viewMode, month])

  async function fetchStats() {
    setLoading(true); setError('')
    try {
      const params = {
        year,
        month: viewMode === 'monthly' ? month : undefined,
        mode: mode !== '__all__' ? mode : undefined,
      }
      if (company !== '__all__') params.company = company
      const { data } = await getCompanyStats(params)
      setStats(data)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  const filteredCompanies = useMemo(() => {
    const q = companySearch.toLowerCase()
    return q ? companies.filter(c => c.name.toLowerCase().includes(q)) : companies
  }, [companies, companySearch])

  const periodLabel = viewMode === 'yearly'
    ? String(year)
    : `${MONTHS[month - 1]} ${year}`

  const selectedLabel = company === '__all__' ? 'All Companies' : company

  // prep chart data
  const trendChartData = (stats?.monthly_trend || []).map(r => ({
    name: MONTHS[parseInt(r.month.slice(5, 7)) - 1],
    Revenue: r.revenue,
    Cost: r.cost,
    Profit: r.profit,
    'GP%': r.gp_percent,
  }))

  const modeChartData = (stats?.by_mode || []).map(r => ({
    name: r.mode,
    Revenue: r.revenue,
    Cost: r.cost,
    Profit: r.profit,
    Jobs: r.jobs,
  }))

  const modePieData = (stats?.by_mode || []).map(r => ({
    name: r.mode,
    value: r.revenue,
  }))

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1280 }}>

      {/* Header */}
      <div className="page-header" style={{ marginBottom: 22 }}>
        <h1>Company Statistics</h1>
        <p>Revenue, cost, and volume breakdown — filter by company, mode, and period</p>
      </div>

      {/* ── Filter Bar ── */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 24 }}>

        {/* Company dropdown */}
        <div style={{ position: 'relative', flex: '1 1 220px', minWidth: 200 }}>
          <FilterLabel>Company</FilterLabel>
          <div
            onClick={() => setShowDropdown(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '7px 12px', borderRadius: 8, border: '1px solid var(--border-solid)',
              background: 'var(--surface)', cursor: 'pointer', fontSize: 13,
              color: 'var(--heading)', fontWeight: company !== '__all__' ? 600 : 400,
              minHeight: 36,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {selectedLabel}
            </span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: 11 }}>▼</span>
          </div>

          {showDropdown && (
            <>
              <div
                style={{ position: 'fixed', inset: 0, zIndex: 199 }}
                onClick={() => { setShowDropdown(false); setCompanySearch('') }}
              />
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, marginTop: 2,
              backgroundColor: '#ffffff', border: '1px solid var(--border-solid)', borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.18)', maxHeight: 300, overflowY: 'auto',
            }}
            >
              <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--border-solid)', backgroundColor: '#ffffff' }}>
                <input
                  className="form-control"
                  placeholder="Search company..."
                  value={companySearch}
                  onChange={e => setCompanySearch(e.target.value)}
                  onClick={e => e.stopPropagation()}
                  style={{ width: '100%', fontSize: 12 }}
                  autoFocus
                />
              </div>
              {[{ name: '__all__', jobs: companies.reduce((s, c) => s + c.jobs, 0) }, ...filteredCompanies].map(c => (
                <div
                  key={c.name}
                  onClick={() => { setCompany(c.name); setShowDropdown(false); setCompanySearch('') }}
                  style={{
                    padding: '8px 12px', cursor: 'pointer', fontSize: 13,
                    backgroundColor: company === c.name ? 'rgba(24,95,165,0.08)' : '#ffffff',
                    fontWeight: company === c.name ? 700 : 400,
                    color: 'var(--text)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = '#F0F4FB'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = company === c.name ? 'rgba(24,95,165,0.08)' : '#ffffff'}
                >
                  <span>{c.name === '__all__' ? 'All Companies' : c.name}</span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>{c.jobs} jobs</span>
                </div>
              ))}
              {filteredCompanies.length === 0 && companySearch && (
                <div style={{ padding: '12px', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center' }}>No match</div>
              )}
            </div>
            </>
          )}
        </div>

        {/* Mode filter */}
        <div>
          <FilterLabel>Mode</FilterLabel>
          <select
            className="form-control"
            value={mode}
            onChange={e => setMode(e.target.value)}
            style={{ minWidth: 110 }}
          >
            <option value="__all__">All Modes</option>
            {modes.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        {/* Year */}
        <div>
          <FilterLabel>Year</FilterLabel>
          <select className="form-control" value={year} onChange={e => setYear(parseInt(e.target.value))} style={{ minWidth: 90 }}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* View toggle */}
        <div>
          <FilterLabel>View</FilterLabel>
          <div style={{ display: 'flex', gap: 2, background: 'var(--sub-box-bg)', border: '1px solid var(--border-solid)', borderRadius: 8, padding: 3 }}>
            {['yearly', 'monthly'].map(v => (
              <button key={v} onClick={() => setViewMode(v)}
                className={viewMode === v ? 'btn btn-primary btn-xs' : 'btn btn-ghost btn-xs'}
                style={{ textTransform: 'capitalize' }}
              >{v}</button>
            ))}
          </div>
        </div>

        {/* Month (monthly view only) */}
        {viewMode === 'monthly' && (
          <div>
            <FilterLabel>Month</FilterLabel>
            <select className="form-control" value={month} onChange={e => setMonth(parseInt(e.target.value))} style={{ minWidth: 100 }}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
        )}

        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-end' }} onClick={fetchStats}>
          Refresh
        </button>
      </div>

      {/* State messages */}
      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>Loading…</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {stats && !loading && (
        <>
          {/* Period label */}
          <div style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18, fontWeight: 900, color: 'var(--heading)' }}>{selectedLabel}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>— {periodLabel}</span>
            {mode !== '__all__' && (
              <span style={{
                fontSize: 10, fontWeight: 800, color: '#185FA5', background: 'rgba(24,95,165,0.1)',
                borderRadius: 20, padding: '2px 10px', textTransform: 'uppercase',
              }}>{mode}</span>
            )}
          </div>

          {/* Summary cards */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>
            <SummaryCard label="Jobs"       value={stats.summary.jobs} />
            <SummaryCard label="Revenue"    value={fmtFull(stats.summary.revenue)} />
            <SummaryCard label="Cost"       value={fmtFull(stats.summary.cost)} />
            <SummaryCard label="Profit"     value={fmtFull(stats.summary.profit)}
              color={stats.summary.profit >= 0 ? '#15803D' : '#DC2626'} />
            <SummaryCard label="GP Margin"  value={`${stats.summary.gp_percent}%`}
              color={gpColor(stats.summary.gp_percent)} />
            <SummaryCard label="Packages"   value={fmtN(stats.summary.packages, 0)} />
            <SummaryCard label="Weight (kg)"value={fmtN(stats.summary.weight)} />
            <SummaryCard label="CBM"        value={fmtN(stats.summary.cbm)} />
          </div>

          {/* ── Charts row ── */}
          {stats.summary.jobs > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16, marginBottom: 28 }}>

              {/* Monthly trend — revenue vs profit (yearly view) */}
              {viewMode === 'yearly' && trendChartData.length > 0 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border-solid)', borderRadius: 12, padding: '16px 16px 8px' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                    Monthly Revenue & Profit — {year}
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={trendChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-solid)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Revenue" fill="#185FA5" radius={[3,3,0,0]} />
                      <Bar dataKey="Profit"  fill="#15803D" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Monthly GP% trend line */}
              {viewMode === 'yearly' && trendChartData.length > 0 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border-solid)', borderRadius: 12, padding: '16px 16px 8px' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                    GP% Trend — {year}
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={trendChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-solid)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 10 }} unit="%" />
                      <Tooltip content={<ChartTooltip />} />
                      <Line dataKey="GP%" stroke="#B45309" strokeWidth={2} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Revenue by mode bar chart */}
              {modeChartData.length > 1 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border-solid)', borderRadius: 12, padding: '16px 16px 8px' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                    Revenue by Mode
                  </div>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={modeChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border-solid)" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 10 }} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Revenue" fill="#185FA5" radius={[3,3,0,0]} />
                      <Bar dataKey="Cost"    fill="#DC2626" radius={[3,3,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Mode share pie */}
              {modePieData.length > 1 && (
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border-solid)', borderRadius: 12, padding: '16px 16px 16px' }}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
                    Revenue Share by Mode
                  </div>
                  <ResponsiveContainer width="100%" height={230}>
                    <PieChart>
                      <Pie data={modePieData} dataKey="value" nameKey="name" cx="35%" cy="50%" outerRadius={75}>
                        {modePieData.map((_, i) => <Cell key={i} fill={MODE_COLORS[i % MODE_COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v) => fmt(v)} />
                      <Legend
                        layout="vertical"
                        align="right"
                        verticalAlign="middle"
                        wrapperStyle={{ fontSize: 11, lineHeight: '18px' }}
                        formatter={(value, entry) => `${value} ${(entry.payload.percent * 100).toFixed(0)}%`}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}

            </div>
          )}

          {/* ── Mode Breakdown Table ── */}
          {stats.by_mode.length > 0 ? (
            <div style={{ marginBottom: 28 }}>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Breakdown by Mode of Transport
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Mode</th>
                      <th style={{ textAlign: 'right' }}>Jobs</th>
                      <th style={{ textAlign: 'right' }}>Packages</th>
                      <th style={{ textAlign: 'right' }}>Weight (kg)</th>
                      <th style={{ textAlign: 'right' }}>CBM</th>
                      <th style={{ textAlign: 'right' }}>Revenue</th>
                      <th style={{ textAlign: 'right' }}>Cost</th>
                      <th style={{ textAlign: 'right' }}>Profit</th>
                      <th style={{ textAlign: 'right' }}>GP%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.by_mode.map(r => (
                      <tr key={r.mode}>
                        <td style={{ fontWeight: 600 }}>{r.mode}</td>
                        <td style={{ textAlign: 'right' }}>{r.jobs}</td>
                        <td style={{ textAlign: 'right' }}>{fmtN(r.packages, 0)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtN(r.weight)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtN(r.cbm)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtFull(r.revenue)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtFull(r.cost)}</td>
                        <td style={{ textAlign: 'right', color: r.profit >= 0 ? '#15803D' : '#DC2626', fontWeight: 600 }}>{fmtFull(r.profit)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 800, color: gpColor(r.gp_percent) }}>{r.gp_percent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>
              No jobs found for {selectedLabel} in {periodLabel}.
            </div>
          )}

          {/* ── Monthly Trend Table (yearly view) ── */}
          {viewMode === 'yearly' && stats.monthly_trend.length > 0 && (
            <div>
              <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
                Monthly Trend — {year}
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Month</th>
                      <th style={{ textAlign: 'right' }}>Jobs</th>
                      <th style={{ textAlign: 'right' }}>Revenue</th>
                      <th style={{ textAlign: 'right' }}>Cost</th>
                      <th style={{ textAlign: 'right' }}>Profit</th>
                      <th style={{ textAlign: 'right' }}>GP%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.monthly_trend.map(r => (
                      <tr key={r.month}>
                        <td>{new Date(r.month + 'T00:00:00').toLocaleString('en-SG', { month: 'long', year: 'numeric' })}</td>
                        <td style={{ textAlign: 'right' }}>{r.jobs}</td>
                        <td style={{ textAlign: 'right' }}>{fmtFull(r.revenue)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtFull(r.cost)}</td>
                        <td style={{ textAlign: 'right', color: r.profit >= 0 ? '#15803D' : '#DC2626', fontWeight: 600 }}>{fmtFull(r.profit)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 800, color: gpColor(r.gp_percent) }}>{r.gp_percent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
