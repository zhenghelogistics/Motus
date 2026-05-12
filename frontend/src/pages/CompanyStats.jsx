import { useState, useEffect, useRef } from 'react'
import { getCustomers, getCompanyStats } from '../api'

const fmt = (n) => `$${Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtN = (n, dp = 2) => Number(n || 0).toLocaleString('en-SG', { minimumFractionDigits: dp, maximumFractionDigits: dp })

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const CURRENT_YEAR = new Date().getFullYear()
const YEARS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2, CURRENT_YEAR - 3]

function gpColor(gp) {
  return gp >= 20 ? '#0A7C3E' : gp >= 0 ? '#B05A00' : '#C0392B'
}

export default function CompanyStats() {
  const [companyInput, setCompanyInput] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [selectedCompany, setSelectedCompany] = useState('')
  const [year, setYear] = useState(CURRENT_YEAR)
  const [viewMode, setViewMode] = useState('yearly')
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef(null)

  useEffect(() => {
    if (!companyInput || companyInput === selectedCompany) {
      setSuggestions([])
      return
    }
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(async () => {
      try {
        const { data } = await getCustomers(companyInput)
        setSuggestions(data)
      } catch { setSuggestions([]) }
    }, 250)
  }, [companyInput, selectedCompany])

  useEffect(() => {
    if (!selectedCompany) return
    fetchStats()
  }, [selectedCompany, year, viewMode, month])

  async function fetchStats() {
    setLoading(true)
    setError('')
    try {
      const { data } = await getCompanyStats({
        company: selectedCompany,
        year,
        month: viewMode === 'monthly' ? month : undefined
      })
      setStats(data)
    } catch (err) {
      setError(err?.response?.data?.error || 'Failed to load stats')
    } finally {
      setLoading(false)
    }
  }

  function selectCompany(name) {
    setSelectedCompany(name)
    setCompanyInput(name)
    setSuggestions([])
  }

  function clearCompany() {
    setSelectedCompany('')
    setCompanyInput('')
    setSuggestions([])
    setStats(null)
  }

  const periodLabel = viewMode === 'yearly'
    ? String(year)
    : `${MONTHS[month - 1]} ${year}`

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1140 }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--navy)', marginBottom: 20 }}>Company Statistics</h1>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 28 }}>

        {/* Company search */}
        <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 200 }}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.06em' }}>COMPANY</label>
          <div style={{ position: 'relative' }}>
            <input
              className="form-control"
              placeholder="Search company..."
              value={companyInput}
              onChange={e => {
                setCompanyInput(e.target.value)
                if (!e.target.value) clearCompany()
              }}
              style={{ paddingRight: companyInput ? 28 : undefined }}
            />
            {companyInput && (
              <button onClick={clearCompany} style={{
                position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', fontSize: 14, padding: 0
              }}>✕</button>
            )}
          </div>
          {suggestions.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
              background: '#fff', border: '1px solid var(--border)', borderRadius: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto', marginTop: 2
            }}>
              {suggestions.map(s => (
                <div
                  key={s.display_name}
                  onClick={() => selectCompany(s.display_name)}
                  style={{ padding: '9px 12px', cursor: 'pointer', fontSize: 13 }}
                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                  onMouseLeave={e => e.currentTarget.style.background = ''}
                >
                  <div style={{ fontWeight: 500 }}>{s.display_name}</div>
                  {s.customer_email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.customer_email}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Year */}
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.06em' }}>YEAR</label>
          <select className="form-control" value={year} onChange={e => setYear(parseInt(e.target.value))} style={{ minWidth: 90 }}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* View toggle */}
        <div>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.06em' }}>VIEW</label>
          <div style={{ display: 'flex', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden' }}>
            {['yearly', 'monthly'].map(v => (
              <button key={v} onClick={() => setViewMode(v)} style={{
                padding: '6px 16px', border: 'none', cursor: 'pointer', fontSize: 13,
                background: viewMode === v ? 'var(--navy)' : '#fff',
                color: viewMode === v ? '#fff' : 'var(--text)',
                fontFamily: 'var(--font)', fontWeight: viewMode === v ? 600 : 400,
                transition: 'background 0.15s'
              }}>
                {v === 'yearly' ? 'Yearly' : 'Monthly'}
              </button>
            ))}
          </div>
        </div>

        {/* Month (only in monthly view) */}
        {viewMode === 'monthly' && (
          <div>
            <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 4, letterSpacing: '0.06em' }}>MONTH</label>
            <select className="form-control" value={month} onChange={e => setMonth(parseInt(e.target.value))} style={{ minWidth: 100 }}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Empty state */}
      {!selectedCompany && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
          <div style={{ fontSize: 40, marginBottom: 14, opacity: 0.4 }}>◈</div>
          <p style={{ fontSize: 15, margin: 0 }}>Search for a company to view their statistics</p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)', fontSize: 14 }}>
          Loading...
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: '10px 14px', background: '#FEF2F2', color: '#C0392B', borderRadius: 6, marginBottom: 16, fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Stats content */}
      {stats && !loading && (
        <>
          {/* Period header */}
          <div style={{ marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: 'var(--navy)' }}>{selectedCompany}</span>
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>— {periodLabel}</span>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 28 }}>
            {[
              { label: 'Jobs',       value: stats.summary.jobs,             isNum: true },
              { label: 'Revenue',    value: fmt(stats.summary.revenue) },
              { label: 'Cost',       value: fmt(stats.summary.cost) },
              { label: 'Profit',     value: fmt(stats.summary.profit),       color: stats.summary.profit >= 0 ? '#0A7C3E' : '#C0392B' },
              { label: 'GP Margin',  value: `${stats.summary.gp_percent}%`,  color: gpColor(stats.summary.gp_percent) },
              { label: 'Packages',   value: fmtN(stats.summary.packages, 0), isNum: true },
              { label: 'Weight (kg)',value: fmtN(stats.summary.weight),      isNum: true },
              { label: 'CBM',        value: fmtN(stats.summary.cbm),        isNum: true },
            ].map(c => (
              <div key={c.label} style={{
                background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 16px'
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.07em' }}>
                  {c.label.toUpperCase()}
                </div>
                <div style={{ fontSize: 19, fontWeight: 700, color: c.color || 'var(--navy)', fontVariantNumeric: 'tabular-nums' }}>
                  {c.value}
                </div>
              </div>
            ))}
          </div>

          {/* Mode breakdown table */}
          {stats.by_mode.length > 0 ? (
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Breakdown by Mode of Transport
              </h2>
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
                <table className="data-table" style={{ width: '100%', marginBottom: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Mode</th>
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
                        <td style={{ fontWeight: 500 }}>{r.mode}</td>
                        <td style={{ textAlign: 'right' }}>{r.jobs}</td>
                        <td style={{ textAlign: 'right' }}>{fmtN(r.packages, 0)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtN(r.weight)}</td>
                        <td style={{ textAlign: 'right' }}>{fmtN(r.cbm)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.revenue)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.cost)}</td>
                        <td style={{ textAlign: 'right', color: r.profit >= 0 ? '#0A7C3E' : '#C0392B', fontWeight: 500 }}>{fmt(r.profit)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: gpColor(r.gp_percent) }}>{r.gp_percent}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-muted)', fontSize: 14 }}>
              No jobs found for {selectedCompany} in {periodLabel}.
            </div>
          )}

          {/* Monthly trend (yearly view only) */}
          {viewMode === 'yearly' && stats.monthly_trend.length > 0 && (
            <div>
              <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--navy)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Monthly Trend — {year}
              </h2>
              <div style={{ overflowX: 'auto', borderRadius: 8, border: '1px solid var(--border)' }}>
                <table className="data-table" style={{ width: '100%', marginBottom: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left' }}>Month</th>
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
                        <td style={{ textAlign: 'right' }}>{fmt(r.revenue)}</td>
                        <td style={{ textAlign: 'right' }}>{fmt(r.cost)}</td>
                        <td style={{ textAlign: 'right', color: r.profit >= 0 ? '#0A7C3E' : '#C0392B', fontWeight: 500 }}>{fmt(r.profit)}</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, color: gpColor(r.gp_percent) }}>{r.gp_percent}%</td>
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
