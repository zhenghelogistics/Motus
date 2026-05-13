import { useState, useEffect, useCallback } from 'react'
import { getLeads, createLead, updateLead, getLeadStats, claimLead, generateEmail, getMarketingContacts, deleteMarketingContact } from '../api'
import { supabase } from '../lib/supabase'

// ── helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  return `${d}d ago`
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtDatetime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' })
}

function fmtPrice(v) {
  if (!v) return '—'
  return `S$${Number(v).toLocaleString('en-SG', { maximumFractionDigits: 0 })}`
}

// ── constants ─────────────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  'RFQ Received', 'New Lead', 'Follow-Up', 'Quote Sent', 'Responded', 'Won', 'Lost',
]

const STAGE_COLOR = {
  'RFQ Received': { bg: 'rgba(24,95,165,0.08)',   border: 'rgba(24,95,165,0.25)',  dot: '#185FA5' },
  'New Lead':     { bg: 'rgba(147,51,234,0.08)',  border: 'rgba(147,51,234,0.25)', dot: '#7C3AED' },
  'Follow-Up':    { bg: 'rgba(234,179,8,0.08)',   border: 'rgba(234,179,8,0.30)',  dot: '#B45309' },
  'Quote Sent':   { bg: 'rgba(14,165,233,0.08)',  border: 'rgba(14,165,233,0.25)', dot: '#0369A1' },
  'Responded':    { bg: 'rgba(20,184,166,0.08)',  border: 'rgba(20,184,166,0.25)', dot: '#0F766E' },
  'Won':          { bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)',  dot: '#15803D' },
  'Lost':         { bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)', dot: '#DC2626' },
}

const RISK_COLOR = {
  High:   { bg: 'rgba(239,68,68,0.10)',  color: '#DC2626' },
  Medium: { bg: 'rgba(234,179,8,0.10)',  color: '#B45309' },
  Low:    { bg: 'rgba(34,197,94,0.10)',  color: '#15803D' },
}

const INDUSTRY_COLOR = {
  Tech:            { bg: 'rgba(24,95,165,0.1)',    color: '#185FA5' },
  Pharmaceuticals: { bg: 'rgba(20,128,74,0.1)',    color: '#14804A' },
  Manufacturing:   { bg: 'rgba(180,83,9,0.1)',     color: '#B45309' },
  Commodities:     { bg: 'rgba(107,114,128,0.12)', color: '#4B5563' },
  Retail:          { bg: 'rgba(139,92,246,0.1)',   color: '#7C3AED' },
  General:         { bg: 'rgba(107,114,128,0.1)',  color: '#6B7280' },
}

// ── follow-up templates (no API needed) ──────────────────────────────────────

const FOLLOWUP_TEMPLATES = {
  Polite: (name, note) => ({
    subject: 'Following Up on Your Freight Enquiry',
    body: `Dear ${name || 'there'},\n\nI hope you're doing well. I wanted to follow up on your recent freight enquiry with Zhenghe Logistics.\n\nWould you have a moment to advise on the status of your shipment requirements? We're happy to answer any questions or provide additional clarification on our services.${note ? `\n\n${note}` : ''}\n\nLooking forward to hearing from you.\n\nWarm regards,\nZhenghe Logistics Team`,
  }),
  Firm: (name, note) => ({
    subject: 'Follow-Up: Your Freight Enquiry — Response Required',
    body: `Dear ${name || 'there'},\n\nI'm following up on your freight enquiry submitted to Zhenghe Logistics. We have reviewed your requirements and would appreciate your response so we can move forward.\n\nCould you please advise on the current status of your shipment requirements at your earliest convenience?${note ? `\n\n${note}` : ''}\n\nWe look forward to your prompt reply.\n\nBest regards,\nZhenghe Logistics Team`,
  }),
  Urgent: (name, note) => ({
    subject: 'URGENT: Follow-Up Required — Freight Enquiry Pending',
    body: `Dear ${name || 'there'},\n\nThis is an urgent follow-up regarding your pending freight enquiry with Zhenghe Logistics.\n\nWe have been unable to reach you and need to confirm your requirements to avoid any delays. Please respond as soon as possible — ideally by end of today.${note ? `\n\n${note}` : ''}\n\nPlease do not hesitate to contact us directly if you have any concerns.\n\nUrgently,\nZhenghe Logistics Team`,
  }),
}

// ── small components ──────────────────────────────────────────────────────────

function Pill({ label, style }) {
  return (
    <span style={{
      padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 800,
      textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap', ...style,
    }}>{label}</span>
  )
}

function IndustryPill({ industry }) {
  const s = INDUSTRY_COLOR[industry] || INDUSTRY_COLOR.General
  return <Pill label={industry || 'General'} style={{ background: s.bg, color: s.color }} />
}

function RiskBadge({ risk }) {
  if (!risk) return null
  const s = RISK_COLOR[risk] || {}
  return <Pill label={risk} style={{ background: s.bg, color: s.color }} />
}

function StageDot({ stage }) {
  const s = STAGE_COLOR[stage] || {}
  return <span style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: s.dot || '#6B7280', marginRight: 5 }} />
}

const RFQ_STATUSES = ['New', 'In Progress', 'Quoted']

const STATUS_STAGE_MAP = {
  'New':         'New Lead',
  'In Progress': 'Follow-Up',
  'Quoted':      'Quote Sent',
}

const STAGE_STATUS_MAP = {
  'RFQ Received': 'New',
  'New Lead':     'New',
  'Follow-Up':    'In Progress',
  'Responded':    'In Progress',
  'Quote Sent':   'Quoted',
}

const STATUS_STYLE = {
  'New':         { bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  'In Progress': { bg: '#FFFBEB', color: '#B45309', border: '#FDE68A' },
  'Quoted':      { bg: '#F0FDF4', color: '#15803D', border: '#BBF7D0' },
}

function StatusDropdown({ lead, onChange }) {
  const [open, setOpen] = useState(false)
  const current = STAGE_STATUS_MAP[lead.stage] || null
  const st = STATUS_STYLE[current] || { bg: '#F3F4F6', color: '#6B7280', border: '#D1D5DB' }

  return (
    <div style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          background: st.bg, color: st.color, border: `1.5px solid ${st.border}`,
          borderRadius: 6, padding: '3px 8px', fontSize: 11, fontWeight: 700,
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          fontFamily: 'var(--font)', whiteSpace: 'nowrap',
        }}
      >
        {current || lead.stage || '—'} ▾
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setOpen(false)} />
          <div style={{
            position: 'absolute', top: '100%', left: 0, zIndex: 200, marginTop: 4,
            backgroundColor: '#ffffff', border: '1px solid #D1DCE8',
            borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.13)', minWidth: 130, overflow: 'hidden',
          }}>
            {RFQ_STATUSES.map(s => (
              <button key={s} onClick={() => { onChange(STATUS_STAGE_MAP[s]); setOpen(false) }}
                style={{
                  display: 'block', width: '100%', padding: '8px 14px', background: s === current ? '#F0F4FB' : '#ffffff',
                  border: 'none', textAlign: 'left', cursor: 'pointer',
                  fontSize: 12, fontWeight: s === current ? 700 : 500, fontFamily: 'var(--font)',
                  color: STATUS_STYLE[s]?.color || 'var(--text)',
                }}
                onMouseEnter={e => e.currentTarget.style.background = '#F0F4FB'}
                onMouseLeave={e => e.currentTarget.style.background = s === current ? '#F0F4FB' : '#ffffff'}
              >
                {s}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <div style={{ background: 'var(--card-bg)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', flex: 1, minWidth: 160 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 900, color: 'var(--heading)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ── section heading helper ────────────────────────────────────────────────────

function SectionHead({ children }) {
  return (
    <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
      {children}
    </div>
  )
}

function SectionBox({ children, style }) {
  return (
    <div style={{
      background: 'var(--sub-box-bg)', border: '1px solid var(--sub-box-border)',
      borderRadius: 10, padding: '14px 16px', marginBottom: 14, ...style,
    }}>
      {children}
    </div>
  )
}

// ── tag toggle helper ─────────────────────────────────────────────────────────

function TagButton({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '4px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 11, fontWeight: 600,
      border: '1.5px solid var(--border)',
      background: active ? 'rgba(24,95,165,0.15)' : 'transparent',
      color: active ? 'var(--blue)' : 'var(--text-muted)',
      transition: 'all 0.12s',
    }}>{label}</button>
  )
}

// ── Lead Modal ────────────────────────────────────────────────────────────────

function LeadModal({ lead, onClose, onSave, onClaim }) {
  const isNew = !lead.id

  // parse existing next_follow_up into date + time
  const existingFU = lead.next_follow_up ? new Date(lead.next_follow_up) : null
  const initDate = existingFU ? existingFU.toISOString().slice(0, 10) : ''
  const initTime = existingFU ? existingFU.toTimeString().slice(0, 5) : '09:00'

  const [tab, setTab] = useState('details')

  // ── form state ──
  const [form, setForm] = useState({
    customer_name:  lead.customer_name  || '',
    customer_email: lead.customer_email || '',
    quoted_price:   lead.quoted_price   || '',
    industry:       lead.industry       || 'General',
    stage:          lead.stage          || 'New Lead',
    risk_level:     lead.risk_level     || 'Medium',
    source:         lead.source         || '',
    notes:          lead.notes          || '',
    is_archived:    lead.is_archived    || false,
    follow_up_date: initDate,
    follow_up_time: initTime,
    follow_up_note: lead.follow_up_note || '',
    lost_reason:    lead.lost_reason    || '',
  })
  const [claimedBy, setClaimedBy] = useState(lead.claimed_by || null)
  const [saving, setSaving]   = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [err, setErr]         = useState('')

  // Auto-claim on open — silently assign this lead to whoever opens it first
  useEffect(() => {
    if (isNew || lead.claimed_by) return
    claimLead(lead.id)
      .then(r => { setClaimedBy(r.data.claimed_by); onClaim?.(lead.id, r.data.claimed_by) })
      .catch(e => { if (e.response?.status === 409) setClaimedBy(e.response.data.claimed_by) })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── action panel ──
  const [showQuoteIn, setShowQuoteIn] = useState(false)
  const [quoteIn, setQuoteIn]         = useState(String(lead.quoted_price || ''))
  const [showLostIn, setShowLostIn]   = useState(false)
  const [lostIn, setLostIn]           = useState(lead.lost_reason || '')

  // ── email generator ──
  const [emailType, setEmailType]         = useState('followup')
  const [emailTone, setEmailTone]         = useState('Polite')
  const [emailNote, setEmailNote]         = useState('')
  const [infoFields, setInfoFields]       = useState([])
  const [infoCustom, setInfoCustom]       = useState('')
  const [quoteIncs, setQuoteIncs]         = useState(['Validity period (14 days)', 'Next steps'])
  const [introSvcs, setIntroSvcs]         = useState([])
  const [introAngle, setIntroAngle]       = useState('')
  const [emailResult, setEmailResult]     = useState(null)
  const [emailLoading, setEmailLoading]   = useState(false)
  const [emailErr, setEmailErr]           = useState('')
  const [copied, setCopied]               = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const inp = { className: 'form-control', style: { width: '100%' } }

  // ── save ──
  async function handleSave() {
    if (!form.customer_name.trim()) { setErr('Company name is required'); return }
    setSaving(true); setErr('')
    try {
      const payload = {
        customer_name:  form.customer_name,
        customer_email: form.customer_email,
        quoted_price:   form.quoted_price ? parseFloat(form.quoted_price) : 0,
        industry:       form.industry,
        stage:          form.stage,
        risk_level:     form.risk_level,
        source:         form.source,
        notes:          form.notes,
        is_archived:    form.is_archived,
        next_follow_up: form.follow_up_date
          ? `${form.follow_up_date}T${form.follow_up_time || '09:00'}:00`
          : null,
        follow_up_note: form.follow_up_note || null,
        lost_reason:    form.lost_reason    || null,
      }
      isNew ? await createLead(payload) : await updateLead(lead.id, payload)
      onSave()
    } catch (e) {
      setErr(e?.response?.data?.error || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  // ── delete ──
  async function handleDelete() {
    if (!window.confirm(`Permanently delete this lead (${lead.customer_name || lead.ref})? This cannot be undone.`)) return
    setDeleting(true)
    try {
      await import('../api').then(m => m.default.delete(`/leads/${lead.id}`))
      onSave()
    } catch (e) {
      setErr(e?.response?.data?.error || 'Delete failed')
      setDeleting(false)
    }
  }

  // ── email generator ──
  async function handleGenerateEmail() {
    setEmailLoading(true); setEmailErr(''); setEmailResult(null)
    try {
      if (emailType === 'followup') {
        setEmailResult(FOLLOWUP_TEMPLATES[emailTone](form.customer_name, emailNote))
      } else {
        const opts = emailType === 'info_request'
          ? { fields: infoFields, custom_questions: infoCustom }
          : emailType === 'quote_confirmation'
          ? { include: quoteIncs }
          : { services: introSvcs, angle: introAngle }
        const { data } = await generateEmail(lead.id, { email_type: emailType, options: opts })
        setEmailResult(data)
      }
    } catch (e) {
      setEmailErr(e?.response?.data?.error || 'Generation failed. Please try again.')
    } finally {
      setEmailLoading(false)
    }
  }

  function copyText(text, key) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      setTimeout(() => setCopied(''), 1800)
    }).catch(() => {})
  }

  // ── follow-up display ──
  const followUpDt = form.follow_up_date
    ? new Date(`${form.follow_up_date}T${form.follow_up_time || '09:00'}`)
    : null
  const followUpOverdue = followUpDt && followUpDt < new Date()

  // ── field row helper ──
  const fieldRow = (label, children) => (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 5 }}>{label}</label>
      {children}
    </div>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 660, width: '95vw' }} onClick={e => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="modal-header">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--heading)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isNew ? 'New Lead' : (lead.customer_name || lead.ref)}
            </div>
            {!isNew && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span>{lead.ref} · received {fmtDate(lead.created_at)}</span>
                {claimedBy
                  ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(21,128,61,0.10)', border: '1px solid rgba(21,128,61,0.25)', borderRadius: 20, padding: '1px 8px', color: '#15803D', fontWeight: 700, fontSize: 10 }}>● {claimedBy.split('@')[0]}</span>
                  : <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'rgba(180,83,9,0.10)', border: '1px solid rgba(180,83,9,0.25)', borderRadius: 20, padding: '1px 8px', color: '#B45309', fontWeight: 700, fontSize: 10 }}>Unclaimed</span>
                }
              </div>
            )}
          </div>
          {!isNew && (
            <div style={{ display: 'flex', gap: 2, background: 'var(--sub-box-bg)', border: '1px solid var(--border)', borderRadius: 7, padding: 3, margin: '0 10px' }}>
              {['details', 'email'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={tab === t ? 'btn btn-primary btn-xs' : 'btn btn-ghost btn-xs'}
                  style={{ textTransform: 'capitalize' }}
                >{t === 'email' ? '✉ Email' : 'Details'}</button>
              ))}
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        {/* ══════════════════ DETAILS TAB ══════════════════ */}
        <div style={{ display: isNew || tab === 'details' ? 'block' : 'none' }}>
          <div className="modal-body" style={{ padding: '16px 24px', maxHeight: '75vh', overflowY: 'auto' }}>
            {err && <div className="alert alert-error" style={{ marginBottom: 14 }}>{err}</div>}

            {/* Core fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 20px' }}>
              {fieldRow('Company Name',
                <input {...inp} value={form.customer_name} onChange={e => set('customer_name', e.target.value)} placeholder="Acme Corp" />
              )}
              {fieldRow('Email',
                <input {...inp} type="email" value={form.customer_email} onChange={e => set('customer_email', e.target.value)} placeholder="contact@acme.com" />
              )}
              {fieldRow('Quoted Price (SGD)',
                <input {...inp} type="number" value={form.quoted_price} onChange={e => set('quoted_price', e.target.value)} placeholder="0" />
              )}
              {fieldRow('Stage',
                <select {...inp} value={form.stage} onChange={e => set('stage', e.target.value)}>
                  {PIPELINE_STAGES.map(s => <option key={s}>{s}</option>)}
                </select>
              )}
              {fieldRow('Risk Level',
                <select {...inp} value={form.risk_level} onChange={e => set('risk_level', e.target.value)}>
                  {['High', 'Medium', 'Low'].map(r => <option key={r}>{r}</option>)}
                </select>
              )}
              {fieldRow('Industry',
                <select {...inp} value={form.industry} onChange={e => set('industry', e.target.value)}>
                  {['Tech','Pharmaceuticals','Manufacturing','Commodities','Retail','General'].map(i => <option key={i}>{i}</option>)}
                </select>
              )}
              {fieldRow('Source',
                <input {...inp} value={form.source} onChange={e => set('source', e.target.value)} placeholder="Website, Referral, Cold Call..." />
              )}
            </div>

            {fieldRow('Notes',
              <textarea {...inp} rows={4} value={form.notes} onChange={e => set('notes', e.target.value)}
                style={{ ...inp.style, resize: 'vertical', fontFamily: 'ui-monospace, "Courier New", monospace', fontSize: 12, lineHeight: 1.65 }}
                placeholder="Cargo details, requirements, context..."
              />
            )}

            {/* ── Action Panel ── */}
            <SectionBox>
              <SectionHead>Quick Actions</SectionHead>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { label: 'Responded',  target: 'Responded',  color: '#0369A1' },
                  { label: 'Send Quote', target: 'Quote Sent', color: '#185FA5', special: 'quote' },
                  { label: 'Won',        target: 'Won',        color: '#15803D' },
                  { label: 'Lost',       target: 'Lost',       color: '#DC2626', special: 'lost' },
                ].map(a => (
                  <button key={a.label}
                    onClick={() => {
                      if (a.special === 'quote') { setShowQuoteIn(v => !v); setShowLostIn(false) }
                      else if (a.special === 'lost') { setShowLostIn(v => !v); setShowQuoteIn(false) }
                      else set('stage', a.target)
                    }}
                    style={{
                      padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      border: `1.5px solid ${a.color}`,
                      background: form.stage === a.target ? a.color : 'transparent',
                      color: form.stage === a.target ? '#fff' : a.color,
                      transition: 'all 0.12s',
                    }}
                  >{a.label}</button>
                ))}
                {form.stage === 'Lost' && (
                  <button onClick={() => { set('stage', 'Follow-Up'); set('lost_reason', '') }}
                    style={{ padding: '5px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700, border: '1.5px solid #B45309', background: 'transparent', color: '#B45309' }}
                  >Recover</button>
                )}
              </div>

              {showQuoteIn && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="number" placeholder="Quoted price (SGD)" value={quoteIn}
                    onChange={e => setQuoteIn(e.target.value)}
                    className="form-control" style={{ maxWidth: 200 }} autoFocus />
                  <button className="btn btn-primary btn-sm" onClick={() => {
                    set('stage', 'Quote Sent')
                    if (quoteIn) set('quoted_price', quoteIn)
                    setShowQuoteIn(false)
                  }}>Confirm</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowQuoteIn(false)}>✕</button>
                </div>
              )}

              {showLostIn && (
                <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input placeholder="Reason for losing (optional)" value={lostIn}
                    onChange={e => setLostIn(e.target.value)}
                    className="form-control" style={{ flex: 1 }} autoFocus />
                  <button className="btn btn-danger btn-sm" onClick={() => {
                    set('stage', 'Lost'); set('lost_reason', lostIn); setShowLostIn(false)
                  }}>Mark Lost</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowLostIn(false)}>✕</button>
                </div>
              )}

              {form.lost_reason && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#DC2626' }}>
                  Lost reason: {form.lost_reason}
                </div>
              )}
            </SectionBox>

            {/* ── Follow-Up Scheduler ── */}
            <SectionBox>
              <SectionHead>Follow-Up Scheduler</SectionHead>

              {followUpDt && (
                <div style={{
                  marginBottom: 10, padding: '8px 12px', borderRadius: 8,
                  background: followUpOverdue ? 'rgba(220,38,38,0.08)' : 'rgba(24,95,165,0.08)',
                  border: `1px solid ${followUpOverdue ? 'rgba(220,38,38,0.25)' : 'rgba(24,95,165,0.20)'}`,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: followUpOverdue ? '#DC2626' : 'var(--blue)' }}>
                    {followUpOverdue ? '⚠ Overdue: ' : '✓ Scheduled: '}{fmtDatetime(`${form.follow_up_date}T${form.follow_up_time}`)}
                  </div>
                  {form.follow_up_note && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{form.follow_up_note}</div>
                  )}
                </div>
              )}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Date</label>
                  <input type="date" className="form-control" value={form.follow_up_date}
                    onChange={e => set('follow_up_date', e.target.value)} style={{ width: '100%' }} />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Time</label>
                  <input type="time" className="form-control" value={form.follow_up_time}
                    onChange={e => set('follow_up_time', e.target.value)} style={{ width: '100%' }} />
                </div>
              </div>
              <input className="form-control" style={{ width: '100%' }}
                placeholder="What to follow up about..."
                value={form.follow_up_note} onChange={e => set('follow_up_note', e.target.value)} />
            </SectionBox>

            {/* Archive */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer', marginBottom: 16 }}>
              <input type="checkbox" checked={form.is_archived} onChange={e => set('is_archived', e.target.checked)} />
              Archive this lead (hide from active pipeline)
            </label>

            {/* Footer */}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', alignItems: 'center' }}>
              {!isNew && (
                <button className="btn btn-ghost btn-sm" onClick={handleDelete} disabled={deleting}
                  style={{ color: '#DC2626', marginRight: 'auto' }}>
                  {deleting ? 'Deleting…' : 'Delete Lead'}
                </button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
              <button className="btn btn-primary btn-sm" onClick={handleSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save Lead'}
              </button>
            </div>
          </div>
        </div>

        {/* ══════════════════ EMAIL TAB ══════════════════ */}
        {!isNew && tab === 'email' && (
          <div className="modal-body" style={{ padding: '16px 24px 24px', maxHeight: '75vh', overflowY: 'auto' }}>

            {/* Type selector */}
            <SectionBox>
              <SectionHead>Email Type</SectionHead>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                {[
                  { value: 'followup',           label: 'Follow-Up',         badge: 'Template' },
                  { value: 'info_request',        label: 'Info Request',      badge: 'AI' },
                  { value: 'quote_confirmation',  label: 'Quote Confirmation',badge: 'AI' },
                  { value: 'introduction',        label: 'Cold Introduction', badge: 'AI' },
                ].map(t => (
                  <button key={t.value}
                    onClick={() => { setEmailType(t.value); setEmailResult(null); setEmailErr('') }}
                    style={{
                      padding: '6px 14px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                      border: '1.5px solid var(--border)',
                      background: emailType === t.value ? 'var(--navy)' : 'transparent',
                      color: emailType === t.value ? '#fff' : 'var(--text)',
                      transition: 'all 0.12s',
                      display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
                    }}
                  >
                    <span>{t.label}</span>
                    <span style={{ fontSize: 9, opacity: 0.65, fontWeight: 600, letterSpacing: '0.4px' }}>{t.badge}</span>
                  </button>
                ))}
              </div>

              {/* ── Follow-Up options ── */}
              {emailType === 'followup' && (
                <>
                  <SectionHead>Tone</SectionHead>
                  <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                    {['Polite', 'Firm', 'Urgent'].map(t => (
                      <button key={t} onClick={() => setEmailTone(t)}
                        style={{
                          padding: '5px 16px', borderRadius: 8, cursor: 'pointer', fontSize: 12, fontWeight: 700,
                          border: '1.5px solid var(--border)',
                          background: emailTone === t ? 'var(--blue)' : 'transparent',
                          color: emailTone === t ? '#fff' : 'var(--text)',
                          transition: 'all 0.12s',
                        }}
                      >{t}</button>
                    ))}
                  </div>
                  <SectionHead>Custom Note (optional)</SectionHead>
                  <input className="form-control" style={{ width: '100%' }}
                    placeholder="Any specific message to include..."
                    value={emailNote} onChange={e => setEmailNote(e.target.value)} />
                </>
              )}

              {/* ── Info Request options ── */}
              {emailType === 'info_request' && (
                <>
                  <SectionHead>Fields to Request</SectionHead>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {['HS Code','Weight','CBM','Dimensions','Pickup Address','Delivery Address','Incoterm','Commodity Details','Packaging Type','Cargo Readiness Date'].map(f => (
                      <TagButton key={f} label={f}
                        active={infoFields.includes(f)}
                        onClick={() => setInfoFields(p => p.includes(f) ? p.filter(x => x !== f) : [...p, f])}
                      />
                    ))}
                  </div>
                  <SectionHead>Additional Questions</SectionHead>
                  <input className="form-control" style={{ width: '100%' }}
                    placeholder="Any other specific questions..."
                    value={infoCustom} onChange={e => setInfoCustom(e.target.value)} />
                </>
              )}

              {/* ── Quote Confirmation options ── */}
              {emailType === 'quote_confirmation' && (
                <>
                  <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                    Quote on file:{' '}
                    <strong style={{ color: lead.quoted_price > 0 ? 'var(--blue)' : 'var(--text-muted)' }}>
                      {lead.quoted_price > 0 ? fmtPrice(lead.quoted_price) : 'None set yet'}
                    </strong>
                  </div>
                  <SectionHead>Include in Email</SectionHead>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {['Validity period (14 days)','Payment terms','Next steps','Subject to space/approval','Cargo readiness date','Bank details for deposit'].map(f => (
                      <TagButton key={f} label={f}
                        active={quoteIncs.includes(f)}
                        onClick={() => setQuoteIncs(p => p.includes(f) ? p.filter(x => x !== f) : [...p, f])}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* ── Cold Introduction options ── */}
              {emailType === 'introduction' && (
                <>
                  <SectionHead>Services to Highlight</SectionHead>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {['FCL (Full Container)','LCL (Less Container)','Air Freight','Air Express','Local Delivery','Customs Clearance','Warehousing','Door-to-Door','Project Cargo'].map(s => (
                      <TagButton key={s} label={s}
                        active={introSvcs.includes(s)}
                        onClick={() => setIntroSvcs(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s])}
                      />
                    ))}
                  </div>
                  <SectionHead>Key Angle / Value Proposition</SectionHead>
                  <input className="form-control" style={{ width: '100%' }}
                    placeholder="e.g. Competitive LCL rates for SG-India, 5-day transit..."
                    value={introAngle} onChange={e => setIntroAngle(e.target.value)} />
                </>
              )}
            </SectionBox>

            {emailErr && <div className="alert alert-error" style={{ marginBottom: 12 }}>{emailErr}</div>}

            <button className="btn btn-primary btn-sm"
              onClick={handleGenerateEmail}
              disabled={emailLoading}
              style={{ width: '100%', marginBottom: emailResult ? 20 : 0, justifyContent: 'center' }}
            >
              {emailLoading
                ? 'Generating…'
                : emailType === 'followup'
                ? 'Generate from Template'
                : '✦ Generate with AI'}
            </button>

            {/* ── Email result ── */}
            {emailResult && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <SectionHead>Subject</SectionHead>
                    <button className="btn btn-ghost btn-xs" onClick={() => copyText(emailResult.subject, 'subject')}>
                      {copied === 'subject' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <input className="form-control" style={{ width: '100%', fontWeight: 600 }}
                    value={emailResult.subject}
                    onChange={e => setEmailResult(r => ({ ...r, subject: e.target.value }))} />
                </div>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                    <SectionHead>Body</SectionHead>
                    <button className="btn btn-ghost btn-xs" onClick={() => copyText(emailResult.body, 'body')}>
                      {copied === 'body' ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <textarea className="form-control"
                    style={{ width: '100%', minHeight: 240, resize: 'vertical', fontFamily: 'ui-monospace, "Courier New", monospace', fontSize: 12, lineHeight: 1.7 }}
                    value={emailResult.body}
                    onChange={e => setEmailResult(r => ({ ...r, body: e.target.value }))} />
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}

// ── Unclaimed Attention Banner ────────────────────────────────────────────────

function AttentionBanner({ leads, onClaimed }) {
  const [claiming, setClaiming] = useState(null)
  const [results, setResults]   = useState({})

  async function handleClaim(lead) {
    setClaiming(lead.id)
    try {
      await claimLead(lead.id)
      setResults(r => ({ ...r, [lead.id]: { ok: true, msg: 'Claimed by you' } }))
      onClaimed()
    } catch (e) {
      const msg = e?.response?.data?.claimed_by
        ? `Already claimed by ${e.response.data.claimed_by}`
        : 'Refresh and try again'
      setResults(r => ({ ...r, [lead.id]: { ok: false, msg } }))
    } finally {
      setClaiming(null)
    }
  }

  const unclaimed = leads.filter(l => !l.claimed_by && !results[l.id]?.ok)
  if (!unclaimed.length) return null

  return (
    <div style={{
      background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.40)',
      borderRadius: 10, padding: '14px 18px', marginBottom: 20,
    }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#92400E', marginBottom: 10 }}>
        {unclaimed.length} lead{unclaimed.length > 1 ? 's' : ''} need{unclaimed.length === 1 ? 's' : ''} attention
        <span style={{ fontSize: 11, opacity: 0.7, fontWeight: 400, marginLeft: 8 }}>— unclaimed for 2+ weeks</span>
      </div>
      {unclaimed.map(lead => (
        <div key={lead.id} style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(255,255,255,0.6)', borderRadius: 8, padding: '8px 12px',
          flexWrap: 'wrap', gap: 8, marginBottom: 6,
        }}>
          <div>
            <span style={{ fontWeight: 700, fontSize: 13 }}>{lead.customer_name || lead.ref}</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>{lead.stage} · {timeAgo(lead.created_at)}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {results[lead.id] && (
              <span style={{ fontSize: 11, color: results[lead.id].ok ? '#15803D' : '#DC2626', fontWeight: 600 }}>
                {results[lead.id].msg}
              </span>
            )}
            <button className="btn btn-sm" disabled={claiming === lead.id}
              style={{ background: '#B45309', color: '#fff', border: 'none' }}
              onClick={() => handleClaim(lead)}
            >{claiming === lead.id ? 'Claiming…' : "I'll handle this"}</button>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Pipeline Card ─────────────────────────────────────────────────────────────

function PipelineCard({ lead, onClick }) {
  const followUpDt = lead.next_follow_up ? new Date(lead.next_follow_up) : null
  const followUpOverdue = followUpDt && followUpDt < new Date()

  return (
    <div onClick={onClick} style={{
      background: 'var(--card-bg)', border: '1px solid var(--border)',
      borderRadius: 10, padding: '12px 14px', cursor: 'pointer', transition: 'box-shadow 0.15s, border-color 0.15s',
    }}
    onMouseEnter={e => { e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.10)'; e.currentTarget.style.borderColor = 'var(--blue)' }}
    onMouseLeave={e => { e.currentTarget.style.boxShadow = ''; e.currentTarget.style.borderColor = 'var(--border)' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
        <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--heading)', lineHeight: 1.3, flex: 1, marginRight: 6 }}>
          {lead.customer_name || <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(no name)</span>}
        </div>
        <RiskBadge risk={lead.risk_level} />
      </div>

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {lead.customer_email || lead.ref}
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        <IndustryPill industry={lead.industry || 'General'} />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: lead.quoted_price ? 'var(--blue)' : 'var(--text-muted)' }}>
          {fmtPrice(lead.quoted_price)}
        </span>
        {followUpDt ? (
          <span style={{ fontSize: 10, color: followUpOverdue ? '#DC2626' : 'var(--text-muted)', fontWeight: followUpOverdue ? 700 : 400 }}>
            {followUpOverdue ? '⚠ ' : ''}{fmtDate(lead.next_follow_up)}
          </span>
        ) : (
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{timeAgo(lead.created_at)}</span>
        )}
      </div>

      {lead.follow_up_note && (
        <div style={{ marginTop: 5, fontSize: 10, color: 'var(--text-muted)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {lead.follow_up_note}
        </div>
      )}

      {lead.claimed_by && (
        <div style={{ marginTop: 5, fontSize: 10, color: '#15803D', fontWeight: 700 }}>
          ✓ {lead.claimed_by.split('@')[0]}
        </div>
      )}
    </div>
  )
}

// ── Pipeline Column ───────────────────────────────────────────────────────────

function PipelineColumn({ stage, leads, onCardClick }) {
  const sc = STAGE_COLOR[stage] || {}
  const total = leads.reduce((s, l) => s + (l.quoted_price || 0), 0)

  return (
    <div style={{ minWidth: 230, maxWidth: 260, flex: '0 0 240px', display: 'flex', flexDirection: 'column' }}>
      <div style={{
        background: sc.bg || 'rgba(107,114,128,0.06)',
        border: `1px solid ${sc.border || 'var(--border)'}`,
        borderRadius: '10px 10px 0 0', padding: '10px 14px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <StageDot stage={stage} />
          <span style={{ fontSize: 11, fontWeight: 800, color: 'var(--heading)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{stage}</span>
        </div>
        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', background: 'var(--sub-box-bg)', borderRadius: 20, padding: '1px 8px' }}>
          {leads.length}
        </span>
      </div>

      {total > 0 && (
        <div style={{ background: sc.bg || 'rgba(107,114,128,0.04)', borderLeft: `1px solid ${sc.border || 'var(--border)'}`, borderRight: `1px solid ${sc.border || 'var(--border)'}`, padding: '4px 14px', fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>
          {fmtPrice(total)}
        </div>
      )}

      <div style={{
        flex: 1, display: 'flex', flexDirection: 'column', gap: 8,
        background: 'var(--sub-box-bg)', border: `1px solid ${sc.border || 'var(--border)'}`,
        borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '10px', minHeight: 80,
      }}>
        {leads.length === 0 && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11, padding: '20px 0' }}>No leads</div>
        )}
        {leads.map(l => <PipelineCard key={l.id} lead={l} onClick={() => onCardClick(l)} />)}
      </div>
    </div>
  )
}

// ── List View ─────────────────────────────────────────────────────────────────

function ListView({ leads, onRowClick, onStatusChange }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Ref</th>
            <th>Company</th>
            <th>Industry</th>
            <th>Status</th>
            <th>Stage</th>
            <th>Risk</th>
            <th>Price</th>
            <th>Follow-Up</th>
            <th>Owner</th>
            <th>Received</th>
          </tr>
        </thead>
        <tbody>
          {leads.map(lead => {
            const fuOverdue = lead.next_follow_up && new Date(lead.next_follow_up) < new Date()
            return (
              <tr key={lead.id} className="tr-link" onClick={() => onRowClick(lead)}>
                <td><span style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11, fontWeight: 700, color: 'var(--link)' }}>{lead.ref}</span></td>
                <td style={{ fontWeight: 600 }}>{lead.customer_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}</td>
                <td><IndustryPill industry={lead.industry || 'General'} /></td>
                <td><StatusDropdown lead={lead} onChange={stage => onStatusChange(lead.id, stage)} /></td>
                <td><div style={{ display: 'flex', alignItems: 'center' }}><StageDot stage={lead.stage} /><span style={{ fontSize: 11 }}>{lead.stage}</span></div></td>
                <td><RiskBadge risk={lead.risk_level} /></td>
                <td style={{ fontWeight: 600, color: 'var(--blue)' }}>{fmtPrice(lead.quoted_price)}</td>
                <td style={{ fontSize: 11, color: fuOverdue ? '#DC2626' : 'var(--text-muted)', fontWeight: fuOverdue ? 700 : 400 }}>
                  {fuOverdue ? '⚠ ' : ''}{fmtDate(lead.next_follow_up)}
                </td>
                <td style={{ fontSize: 11, color: lead.claimed_by ? '#15803D' : 'var(--text-muted)' }}>
                  {lead.claimed_by ? lead.claimed_by.split('@')[0] : '—'}
                </td>
                <td style={{ color: 'var(--text-muted)', fontSize: 12, whiteSpace: 'nowrap' }}>{timeAgo(lead.created_at)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Marketing Contacts View ───────────────────────────────────────────────────

function ContactsView() {
  const [contacts, setContacts] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    setLoading(true)
    getMarketingContacts()
      .then(r => setContacts(r.data))
      .catch(() => setError('Failed to load contacts'))
      .finally(() => setLoading(false))
  }, [])

  async function handleDelete(id) {
    if (!window.confirm('Remove this contact from the mailing list?')) return
    setDeleting(id)
    try {
      await deleteMarketingContact(id)
      setContacts(prev => prev.filter(c => c.id !== id))
    } catch { alert('Failed to delete contact') }
    finally { setDeleting(null) }
  }

  function exportCSV() {
    const rows = [
      ['Email', 'Name', 'Industry', 'Source', 'Lead Ref', 'Archived Date'],
      ...filtered.map(c => [
        c.email, c.customer_name, c.industry, c.source, c.lead_ref,
        c.archived_at ? new Date(c.archived_at).toLocaleDateString('en-SG') : '',
      ])
    ]
    const csv = rows.map(r => r.map(v => `"${(v||'').replace(/"/g,'""')}"`).join(',')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    a.download = `ZHL_Marketing_Contacts_${new Date().toISOString().slice(0,10)}.csv`
    a.click()
  }

  const q = search.toLowerCase()
  const filtered = contacts.filter(c =>
    !q
    || (c.email         || '').toLowerCase().includes(q)
    || (c.customer_name || '').toLowerCase().includes(q)
    || (c.industry      || '').toLowerCase().includes(q)
    || (c.source        || '').toLowerCase().includes(q)
    || (c.lead_ref      || '').toLowerCase().includes(q)
  )

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input className="form-control search-input"
          placeholder="Search email, name, industry..."
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: '1 1 260px', maxWidth: 360 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)', marginLeft: 4 }}>
          {filtered.length} contact{filtered.length !== 1 ? 's' : ''}
        </span>
        <button className="btn btn-ghost btn-sm" onClick={exportCSV} disabled={filtered.length === 0}
          style={{ marginLeft: 'auto' }}>
          Export CSV
        </button>
      </div>

      {loading && <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}
      {error   && <div className="alert alert-error">{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon" style={{ fontSize: 36 }}>📬</div>
          <h3>{search ? 'No contacts match your search' : 'No archived contacts yet'}</h3>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            {search ? 'Try a different search term' : 'Emails are archived here automatically when a lead record is purged after 30 days'}
          </p>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Industry</th>
                <th>Source</th>
                <th>Lead Ref</th>
                <th>Archived</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.id}>
                  <td><a href={`mailto:${c.email}`} style={{ color: 'var(--blue)', textDecoration: 'none' }}>{c.email}</a></td>
                  <td style={{ color: 'var(--text)' }}>{c.customer_name || '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{c.industry || '—'}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: 12 }}>{c.source || '—'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>{c.lead_ref || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.archived_at ? new Date(c.archived_at).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                  <td>
                    <button className="btn btn-ghost btn-xs" style={{ color: '#DC2626' }}
                      disabled={deleting === c.id} onClick={() => handleDelete(c.id)}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(24,95,165,0.05)', borderRadius: 8, border: '1px solid rgba(24,95,165,0.15)', fontSize: 12, color: 'var(--text-muted)' }}>
        Emails are automatically archived here when a lead older than 30 days is purged from the pipeline. Use "Export CSV" to download the list for rate-sharing campaigns.
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Leads() {
  const [leads, setLeads]         = useState([])
  const [stats, setStats]         = useState(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [view, setView]           = useState('pipeline')
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch]       = useState('')
  const [modalLead, setModalLead] = useState(null)

  function handleClaim(id, claimedBy) {
    setLeads(prev => prev.map(l => l.id === id ? { ...l, claimed_by: claimedBy } : l))
  }

  async function handleStatusChange(id, stage) {
    try {
      await updateLead(id, { stage })
      setLeads(prev => prev.map(l => l.id === id ? { ...l, stage } : l))
    } catch { /* silent — the dropdown snaps back on next fetch */ }
  }

  const fetchAll = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [lr, sr] = await Promise.all([
        getLeads({ archived: showArchived ? 'true' : 'false' }),
        getLeadStats(),
      ])
      setLeads(lr.data)
      setStats(sr.data)
    } catch {
      setError('Failed to load leads')
    } finally {
      setLoading(false)
    }
  }, [showArchived])

  useEffect(() => { fetchAll() }, [fetchAll])

  const filtered = leads.filter(l => {
    const q = search.toLowerCase()
    return !q
      || (l.customer_name  || '').toLowerCase().includes(q)
      || (l.customer_email || '').toLowerCase().includes(q)
      || (l.ref            || '').toLowerCase().includes(q)
      || (l.industry       || '').toLowerCase().includes(q)
      || (l.stage          || '').toLowerCase().includes(q)
  })

  const byStage = PIPELINE_STAGES.reduce((acc, s) => {
    acc[s] = filtered.filter(l => l.stage === s)
    return acc
  }, {})

  return (
    <div style={{ padding: '24px 32px', maxWidth: view === 'pipeline' ? 'none' : 1200, margin: view === 'pipeline' ? undefined : '0 auto' }}>

      {/* Header */}
      <div className="flex-between" style={{ marginBottom: 20 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1>Leads Pipeline</h1>
          <p>Manage freight enquiries and track opportunities</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="btn btn-ghost btn-sm" onClick={fetchAll}>Refresh</button>
          <button className="btn btn-primary btn-sm" onClick={() => setModalLead({})}>+ New Lead</button>
        </div>
      </div>

      {/* Stats bar */}
      {stats && view !== 'contacts' && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <StatCard label="Active Leads" value={stats.total_active || 0} sub={`${leads.length} total loaded`} />
          <StatCard label="Pipeline Value"
            value={stats.pipeline_value ? `S$${Number(stats.pipeline_value).toLocaleString('en-SG', { maximumFractionDigits: 0 })}` : '—'}
            sub="quoted in active leads" />
          <StatCard label="Won This Month" value={stats.won_this_month?.count || 0}
            sub={stats.won_this_month?.value ? fmtPrice(stats.won_this_month.value) : 'closed won'} />
          <StatCard label="Top Industry" value={stats.by_industry?.[0]?.industry || '—'}
            sub={stats.by_industry?.[0] ? `${stats.by_industry[0].count} leads` : ''} />
        </div>
      )}

      {/* Unclaimed banner */}
      {view !== 'contacts' && !loading && (() => {
        const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
        const unclaimed = leads.filter(l => !l.claimed_by && !l.is_archived && new Date(l.created_at).getTime() < cutoff)
        return unclaimed.length > 0 ? <AttentionBanner leads={unclaimed} onClaimed={fetchAll} /> : null
      })()}

      {/* Controls */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {view !== 'contacts' && (
          <input className="form-control search-input"
            placeholder="Search company, email, ref, stage..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ flex: '1 1 260px', maxWidth: 360 }} />
        )}
        <div style={{ display: 'flex', gap: 2, background: 'var(--sub-box-bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 3 }}>
          {['pipeline', 'list', 'contacts'].map(v => (
            <button key={v} onClick={() => setView(v)}
              className={view === v ? 'btn btn-primary btn-xs' : 'btn btn-ghost btn-xs'}
              style={{ textTransform: 'capitalize' }}
            >{v}</button>
          ))}
        </div>
        {view !== 'contacts' && (
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>
            <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} />
            Show archived
          </label>
        )}
      </div>

      {view !== 'contacts' && loading && <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>Loading…</div>}
      {view !== 'contacts' && error   && <div className="alert alert-error">{error}</div>}

      {view !== 'contacts' && !loading && !error && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon" style={{ fontSize: 36 }}>📋</div>
          <h3>{search ? 'No leads match your search' : 'No leads yet'}</h3>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            {search ? 'Try a different search term' : 'Add a lead manually or submit an RFQ via your website'}
          </p>
        </div>
      )}

      {view !== 'contacts' && !loading && !error && filtered.length > 0 && view === 'pipeline' && (
        <div style={{ overflowX: 'auto', paddingBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', minWidth: 'max-content' }}>
            {PIPELINE_STAGES.map(stage => (
              <PipelineColumn key={stage} stage={stage} leads={byStage[stage] || []} onCardClick={setModalLead} />
            ))}
          </div>
        </div>
      )}

      {view !== 'contacts' && !loading && !error && filtered.length > 0 && view === 'list' && (
        <ListView leads={filtered} onRowClick={setModalLead} onStatusChange={handleStatusChange} />
      )}

      {view === 'contacts' && <ContactsView />}

      {modalLead !== null && (
        <LeadModal lead={modalLead} onClose={() => setModalLead(null)} onSave={() => { setModalLead(null); fetchAll() }} onClaim={handleClaim} />
      )}
    </div>
  )
}
