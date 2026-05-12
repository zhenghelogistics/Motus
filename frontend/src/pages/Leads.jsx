import { useState, useEffect } from 'react'
import { getLeads } from '../api'

function timeAgo(iso) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

const INDUSTRY_COLOR = {
  Tech:            { bg: 'rgba(24,95,165,0.1)',   color: '#185FA5' },
  Pharmaceuticals: { bg: 'rgba(20,128,74,0.1)',   color: '#14804A' },
  Manufacturing:   { bg: 'rgba(180,83,9,0.1)',    color: '#B45309' },
  Commodities:     { bg: 'rgba(107,114,128,0.12)',color: '#4B5563' },
  Retail:          { bg: 'rgba(139,92,246,0.1)',  color: '#7C3AED' },
  General:         { bg: 'rgba(107,114,128,0.1)', color: '#6B7280' },
}

function IndustryPill({ industry }) {
  const s = INDUSTRY_COLOR[industry] || INDUSTRY_COLOR.General
  return (
    <span style={{
      padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap',
      background: s.bg, color: s.color,
    }}>{industry}</span>
  )
}

function ScoreDots({ score }) {
  return (
    <div style={{ display: 'flex', gap: 3 }}>
      {[1,2,3,4,5,6,7,8,9,10].map(n => (
        <div key={n} style={{
          width: 6, height: 6, borderRadius: '50%',
          background: n <= score ? '#185FA5' : 'rgba(24,95,165,0.15)',
        }} />
      ))}
    </div>
  )
}

function NotesModal({ lead, onClose }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--heading)' }}>{lead.customer_name || '(No name)'}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{lead.ref} · {lead.customer_email}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: '16px 24px 24px' }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
            <IndustryPill industry={lead.industry} />
            <span className="pill pill-inprogress">{lead.stage}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center' }}>
              {new Date(lead.created_at).toLocaleString('en-SG')}
            </span>
          </div>
          <pre style={{
            fontFamily: 'ui-monospace, "Courier New", monospace',
            fontSize: 12, lineHeight: 1.75,
            background: 'var(--sub-box-bg)',
            border: '1px solid var(--sub-box-border)',
            borderRadius: 8, padding: '14px 16px',
            whiteSpace: 'pre-wrap', color: 'var(--text)', margin: 0,
            overflowX: 'auto',
          }}>
            {lead.notes || '(no notes)'}
          </pre>
        </div>
      </div>
    </div>
  )
}

export default function Leads() {
  const [leads, setLeads] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    getLeads()
      .then(r => setLeads(r.data))
      .catch(() => setError('Failed to load leads'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = leads.filter(l => {
    const q = search.toLowerCase()
    return !q
      || (l.customer_name || '').toLowerCase().includes(q)
      || (l.customer_email || '').toLowerCase().includes(q)
      || (l.ref || '').toLowerCase().includes(q)
      || (l.industry || '').toLowerCase().includes(q)
  })

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>
      <div className="flex-between" style={{ marginBottom: 20 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1>RFQ Leads</h1>
          <p>Freight enquiries submitted via the website estimator</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>
            {leads.length} total
          </span>
          <button className="btn btn-ghost btn-sm" onClick={() => {
            setLoading(true)
            getLeads().then(r => setLeads(r.data)).finally(() => setLoading(false))
          }}>Refresh</button>
        </div>
      </div>

      {/* Search */}
      <div className="filters-bar" style={{ marginBottom: 16 }}>
        <input
          className="form-control search-input"
          placeholder="Search by company, email, ref, industry..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>Loading...</div>
      )}

      {error && (
        <div className="alert alert-error">{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon" style={{ fontSize: 36 }}>📥</div>
          <h3>{search ? 'No leads match your search' : 'No leads yet'}</h3>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            {search ? 'Try a different search term' : 'Submissions from your website estimator will appear here'}
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Ref</th>
                <th>Company</th>
                <th>Email</th>
                <th>Industry</th>
                <th>Score</th>
                <th>Stage</th>
                <th>Received</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(lead => (
                <tr key={lead.id} className="tr-link" onClick={() => setSelected(lead)}>
                  <td>
                    <span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, fontWeight: 700, color: 'var(--link)' }}>
                      {lead.ref}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{lead.customer_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{lead.customer_email || '—'}</td>
                  <td><IndustryPill industry={lead.industry || 'General'} /></td>
                  <td><ScoreDots score={lead.lead_score || 0} /></td>
                  <td>
                    <span className="pill pill-inprogress" style={{ fontSize: 10 }}>{lead.stage}</span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {timeAgo(lead.created_at)}
                  </td>
                  <td>
                    <button
                      className="btn btn-ghost btn-xs"
                      onClick={e => { e.stopPropagation(); setSelected(lead) }}
                    >View</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {selected && <NotesModal lead={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
