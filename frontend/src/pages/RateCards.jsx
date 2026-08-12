import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Pencil, Trash2, X, ChevronRight, ChevronDown, ReceiptText, Upload, AlertTriangle } from 'lucide-react'
import {
  getRateCards, createRateCard, updateRateCard, deleteRateCard,
  addRateLine, updateRateLine, deleteRateLine, parseRateCard,
} from '../api'
import { SectionHead } from '../components/SectionBox'

const MODES = ['Air Express', 'Air Freight', 'LCL Express', 'LCL', 'Local Delivery', 'Local Clearance & Delivery', 'Sea FCL', 'Sea LCL', 'Warehousing']
const CURRENCIES = ['SGD', 'USD', 'EUR', 'IDR', 'CNY', 'MYR', 'HKD', 'THB', 'VND', 'INR', 'JPY', 'GBP', 'AUD', 'KRW', 'PHP', 'TWD', 'AED']

// Labels mirror how vendors word these on the actual cards, so data entry is a
// recognition task rather than a translation one.
const BASES = [
  { v: 'flat',              label: 'Flat / per job / per trip' },
  { v: 'banded',            label: 'Banded — tiers by weight or count' },
  { v: 'per_kg',            label: 'Per kg (gross)' },
  { v: 'per_chargeable_kg', label: 'Per chargeable kg (gross vs volumetric)' },
  { v: 'per_cbm',           label: 'Per M3 (CBM)' },
  { v: 'per_rt',            label: 'Per revenue tonne (weight vs volume)' },
  { v: 'per_pallet',        label: 'Per pallet' },
  { v: 'per_carton',        label: 'Per carton' },
  { v: 'per_head',          label: 'Per head' },
  { v: 'per_hour',          label: 'Per hour' },
  { v: 'per_unit',          label: 'Per unit' },
]
const BASIS_LABEL = Object.fromEntries(BASES.map(b => [b.v, b.label]))
const QTY_BASES = ['per_pallet', 'per_carton', 'per_head', 'per_hour', 'per_unit']

const CATEGORIES = [
  { v: 'main',      label: 'Main charge',        hint: 'Applied by default on a job' },
  { v: 'surcharge', label: 'Standard surcharge', hint: 'Applied by default (e.g. fuel)' },
  { v: 'optional',  label: 'Conditional extra',  hint: 'Only when it applies (zone, DG, overtime)' },
]

const BAND_METRICS = [
  { v: 'weight_kg', label: 'Gross weight (kg)' },
  { v: 'packages',  label: 'Package / carton count' },
  { v: 'cbm',       label: 'Volume (M3)' },
]

const money = (n, ccy = 'SGD') =>
  n === null || n === undefined || n === '' ? '—'
    : `${ccy} ${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const blankCard = () => ({ vendor_name: '', title: '', mode: '', currency: 'SGD', valid_from: '', valid_to: '', notes: '', is_active: true })
const blankLine = () => ({ charge_name: '', category: 'optional', basis: 'flat', rate: '', min_charge: '', min_qty: '', bands: null, band_metric: 'weight_kg', currency: '', auto_apply: false, condition_note: '', remarks: '' })

// ── Band editor ───────────────────────────────────────────────────────────────
// Vendors publish tiers where each tier is a flat amount, and the top tier often
// switches to a per-unit rate (Quality Transport: 001-50kg = $17 flat ... 1001kg+
// = $0.065/kg). So a band carries its own basis, not just a number.
function BandEditor({ bands, onChange }) {
  const rows = Array.isArray(bands) ? bands : []
  const set = (i, key, val) => onChange(rows.map((b, j) => j === i ? { ...b, [key]: val } : b))
  const add = () => onChange([...rows, { from: '', to: '', amount: '', basis: 'flat' }])
  const remove = (i) => onChange(rows.filter((_, j) => j !== i))

  return (
    <div>
      <SectionHead>Tiers</SectionHead>
      {rows.length === 0 && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 8px' }}>
          No tiers yet. Add one per row of the vendor&apos;s table.
        </p>
      )}
      {rows.map((b, i) => (
        <div key={i} style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
          <input className="form-control form-control-sm" style={{ width: 74 }} placeholder="From"
            type="number" value={b.from ?? ''} onChange={e => set(i, 'from', e.target.value)} />
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>–</span>
          <input className="form-control form-control-sm" style={{ width: 74 }} placeholder="∞"
            type="number" value={b.to ?? ''} onChange={e => set(i, 'to', e.target.value)} />
          <input className="form-control form-control-sm" style={{ width: 96 }} placeholder="Amount"
            type="number" step="0.0001" value={b.amount ?? ''} onChange={e => set(i, 'amount', e.target.value)} />
          <select className="form-control form-control-sm" style={{ width: 108 }}
            value={b.basis || 'flat'} onChange={e => set(i, 'basis', e.target.value)}>
            <option value="flat">flat</option>
            <option value="per_kg">per unit</option>
          </select>
          <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={() => remove(i)}>
            <X size={12} />
          </button>
        </div>
      ))}
      <button className="btn btn-outline btn-xs" onClick={add}><Plus size={12} /> Add tier</button>
      <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8, marginBottom: 0 }}>
        Leave <strong>To</strong> blank on the last tier to make it open-ended. Tiers are inclusive
        at both ends. Use <em>per unit</em> when the vendor prices that tier per kg/carton rather
        than as a flat amount.
      </p>
    </div>
  )
}

// ── Rate line modal ───────────────────────────────────────────────────────────
function LineModal({ line, cardCurrency, onSave, onClose }) {
  const [d, setD] = useState(line)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setD(p => ({ ...p, [k]: v }))
  const isBanded = d.basis === 'banded'
  const needsQty = QTY_BASES.includes(d.basis)

  async function save() {
    if (!d.charge_name.trim()) { setError('Give the charge a name.'); return }
    if (isBanded && !(Array.isArray(d.bands) && d.bands.length)) { setError('A banded charge needs at least one tier.'); return }
    if (!isBanded && (d.rate === '' || d.rate === null)) { setError('Enter a rate, or 0 if it is quoted on request.'); return }
    setSaving(true); setError('')
    try {
      const num = v => (v === '' || v === null || v === undefined ? null : Number(v))
      await onSave({
        ...d,
        rate: isBanded ? null : num(d.rate),
        min_charge: num(d.min_charge),
        min_qty: num(d.min_qty),
        bands: isBanded ? (d.bands || []).map(b => ({
          from: num(b.from), to: num(b.to), amount: num(b.amount), basis: b.basis || 'flat',
        })) : null,
        band_metric: isBanded ? d.band_metric : null,
      })
      onClose()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save this charge.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 560 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16 }}>{line.id ? 'Edit charge' : 'Add charge'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Charge name</label>
            <input className="form-control" value={d.charge_name} autoFocus
              placeholder="e.g. Import Terminal Clearance"
              onChange={e => set('charge_name', e.target.value)} />
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Type</label>
              <select className="form-control" value={d.category} onChange={e => {
                const v = e.target.value
                // Main + standard surcharges are what you always pay; conditional extras
                // must be chosen per job, so they default to unticked in the picker.
                setD(p => ({ ...p, category: v, auto_apply: v !== 'optional' }))
              }}>
                {CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
              </select>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                {CATEGORIES.find(c => c.v === d.category)?.hint}
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Priced by</label>
              <select className="form-control" value={d.basis} onChange={e => set('basis', e.target.value)}>
                {BASES.map(b => <option key={b.v} value={b.v}>{b.label}</option>)}
              </select>
            </div>
          </div>

          {isBanded ? (
            <>
              <div className="form-group">
                <label className="form-label">Tiers measured on</label>
                <select className="form-control" value={d.band_metric || 'weight_kg'}
                  onChange={e => set('band_metric', e.target.value)}>
                  {BAND_METRICS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
                </select>
              </div>
              <BandEditor bands={d.bands} onChange={v => set('bands', v)} />
            </>
          ) : (
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Rate</label>
                <input className="form-control" type="number" step="0.0001" value={d.rate ?? ''}
                  onChange={e => set('rate', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Currency</label>
                <select className="form-control" value={d.currency || ''} onChange={e => set('currency', e.target.value)}>
                  <option value="">Card default ({cardCurrency})</option>
                  {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
          )}

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Minimum charge</label>
              <input className="form-control" type="number" step="0.01" placeholder="none"
                value={d.min_charge ?? ''} onChange={e => set('min_charge', e.target.value)} />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                For &quot;min $10 or $0.05/kg, whichever is greater&quot;.
              </p>
            </div>
            {needsQty && (
              <div className="form-group">
                <label className="form-label">Minimum quantity</label>
                <input className="form-control" type="number" step="0.5" placeholder="none"
                  value={d.min_qty ?? ''} onChange={e => set('min_qty', e.target.value)} />
                <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                  e.g. overtime billed at a 3-hour minimum.
                </p>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">When it applies</label>
            <input className="form-control" value={d.condition_note || ''}
              placeholder="e.g. Jurong Island · cargo over 350cm · DG Class 3"
              onChange={e => set('condition_note', e.target.value)} />
          </div>

          <div className="form-group">
            <label className="form-label">Remarks</label>
            <input className="form-control" value={d.remarks || ''}
              onChange={e => set('remarks', e.target.value)} />
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={!!d.auto_apply} onChange={e => set('auto_apply', e.target.checked)} />
            Pre-tick this charge when building a job&apos;s costs
          </label>

          {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save charge'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Card modal ────────────────────────────────────────────────────────────────
function CardModal({ card, onSave, onClose }) {
  const [d, setD] = useState(card)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const set = (k, v) => setD(p => ({ ...p, [k]: v }))

  async function save() {
    if (!d.vendor_name.trim()) { setError('Enter the vendor name.'); return }
    setSaving(true); setError('')
    try { await onSave(d); onClose() } catch (err) {
      setError(err?.response?.data?.error || 'Could not save this rate card.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16 }}>{card.id ? 'Edit rate card' : 'New rate card'}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Vendor</label>
            <input className="form-control" value={d.vendor_name} autoFocus
              placeholder="e.g. Quality Transport (S) Pte Ltd"
              onChange={e => set('vendor_name', e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Card title</label>
            <input className="form-control" value={d.title || ''}
              placeholder="e.g. Transportation for Airfreight Shipment"
              onChange={e => set('title', e.target.value)} />
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Freight mode</label>
              <select className="form-control" value={d.mode || ''} onChange={e => set('mode', e.target.value)}>
                <option value="">Any mode</option>
                {MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', margin: '4px 0 0' }}>
                Decides which jobs offer this card.
              </p>
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <select className="form-control" value={d.currency || 'SGD'} onChange={e => set('currency', e.target.value)}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Valid from</label>
              <input className="form-control" type="date" value={d.valid_from || ''}
                onChange={e => set('valid_from', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Valid to</label>
              <input className="form-control" type="date" value={d.valid_to || ''}
                onChange={e => set('valid_to', e.target.value)} />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <input className="form-control" value={d.notes || ''}
              placeholder="Conditions worth remembering when using these rates"
              onChange={e => set('notes', e.target.value)} />
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={d.is_active !== false}
              onChange={e => set('is_active', e.target.checked)} />
            Active — offer these rates on jobs
          </label>
          {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save card'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Import review ─────────────────────────────────────────────────────────────
// Never save a parsed card straight to the database. Real rate cards contain
// contradictions (one sampled card states its fuel surcharge twice with two different
// figures) and placeholders ("$0.00 — please request quotation"), so the extraction is
// a first draft that a human confirms.
function ImportReviewModal({ draft, onSave, onClose }) {
  const [card, setCard] = useState({
    vendor_name: draft.vendor_name || '', title: draft.title || '',
    mode: '', currency: draft.currency || 'SGD',
    valid_from: draft.valid_from || '', notes: draft.notes || '', is_active: true,
  })
  const [lines, setLines] = useState((draft.lines || []).map((l, i) => ({ ...l, _key: i, _keep: true })))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const setLine = (k, key, val) => setLines(ls => ls.map(l => l._key === k ? { ...l, [key]: val } : l))
  const kept = lines.filter(l => l._keep)

  async function save() {
    if (!card.vendor_name.trim()) { setError('Enter the vendor name.'); return }
    if (!card.mode) { setError('Pick the freight mode — it decides which jobs offer this card.'); return }
    setSaving(true); setError('')
    try {
      await onSave(card, kept)
      onClose()
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not save the imported card.')
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 860 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2 style={{ fontSize: 16 }}>Review imported rates</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}><X size={14} /></button>
        </div>
        <div className="modal-body">
          <div className="alert alert-warn" style={{ marginBottom: 16, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
            <span style={{ fontSize: 12 }}>
              Read these against the PDF before saving. Rate cards often repeat a charge with
              two different figures, or list a price as &quot;on request&quot; — the extraction
              cannot tell which is correct.
            </span>
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Vendor</label>
              <input className="form-control" value={card.vendor_name}
                onChange={e => setCard(c => ({ ...c, vendor_name: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Freight mode</label>
              <select className="form-control" value={card.mode}
                onChange={e => setCard(c => ({ ...c, mode: e.target.value }))}>
                <option value="">Choose a mode…</option>
                {MODES.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">Card title</label>
              <input className="form-control" value={card.title}
                onChange={e => setCard(c => ({ ...c, title: e.target.value }))} />
            </div>
            <div className="form-group">
              <label className="form-label">Currency</label>
              <select className="form-control" value={card.currency}
                onChange={e => setCard(c => ({ ...c, currency: e.target.value }))}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          <SectionHead>{kept.length} of {lines.length} charges will be saved</SectionHead>
          {lines.map(l => (
            <div key={l._key} style={{
              display: 'flex', gap: 8, alignItems: 'flex-start', padding: '8px 10px',
              border: '1px solid var(--border)', borderRadius: 8, marginBottom: 6,
              opacity: l._keep ? 1 : 0.45,
            }}>
              <input type="checkbox" checked={l._keep} style={{ marginTop: 8 }}
                onChange={e => setLine(l._key, '_keep', e.target.checked)} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <input className="form-control form-control-sm" value={l.charge_name || ''}
                  onChange={e => setLine(l._key, 'charge_name', e.target.value)} />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
                  {l.basis === 'banded'
                    ? `${(l.bands || []).length} tiers on ${l.band_metric || 'weight_kg'}`
                    : BASIS_LABEL[l.basis] || l.basis}
                  {l.min_charge != null && ` · min ${l.min_charge}`}
                  {l.min_qty != null && ` · min qty ${l.min_qty}`}
                  {l.condition_note && ` · ${l.condition_note}`}
                </div>
                {l.remarks && (
                  <div style={{ fontSize: 11, color: 'var(--amber)', marginTop: 2 }}>{l.remarks}</div>
                )}
              </div>
              <select className="form-control form-control-sm" style={{ width: 120 }}
                value={l.category || 'optional'}
                onChange={e => setLine(l._key, 'category', e.target.value)}>
                {CATEGORIES.map(c => <option key={c.v} value={c.v}>{c.label}</option>)}
              </select>
              <input className="form-control form-control-sm" type="number" step="0.0001"
                style={{ width: 90 }} placeholder={l.basis === 'banded' ? 'tiers' : 'rate'}
                disabled={l.basis === 'banded'}
                value={l.rate ?? ''} onChange={e => setLine(l._key, 'rate', e.target.value)} />
            </div>
          ))}
          {lines.length === 0 && (
            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              No charges were found in that PDF. You can still add them by hand.
            </p>
          )}

          {error && <div className="alert alert-error" style={{ marginTop: 12 }}>{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !kept.length}>
            {saving ? 'Saving…' : `Save card + ${kept.length} charge${kept.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function RateCards() {
  const [cards, setCards] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState({})
  const [cardModal, setCardModal] = useState(null)
  const [lineModal, setLineModal] = useState(null) // { cardId, line }
  const [importDraft, setImportDraft] = useState(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await getRateCards()
      setCards(Array.isArray(data) ? data : [])
      setError('')
    } catch (err) {
      setError(err?.response?.data?.error || 'Could not load rate cards.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function saveCard(d) {
    if (d.id) await updateRateCard(d.id, d)
    else {
      const { data } = await createRateCard(d)
      setExpanded(e => ({ ...e, [data.id]: true }))
    }
    await load()
  }

  async function removeCard(card) {
    if (!window.confirm(`Delete the ${card.vendor_name} rate card and all its charges?`)) return
    try { await deleteRateCard(card.id); await load() } catch { alert('Could not delete that rate card.') }
  }

  async function saveLine(cardId, d) {
    if (d.id) await updateRateLine(cardId, d.id, d)
    else await addRateLine(cardId, d)
    await load()
  }

  async function removeLine(cardId, line) {
    if (!window.confirm(`Delete "${line.charge_name}"?`)) return
    try { await deleteRateLine(cardId, line.id); await load() } catch { alert('Could not delete that charge.') }
  }

  async function handleImport(file) {
    if (!file) return
    // Vercel caps a request body at roughly 4.5MB and the PDF is sent whole (extracted
    // text would lose the column alignment a rate table depends on).
    if (file.size > 4 * 1024 * 1024) {
      alert('That PDF is over 4 MB, which is too large to upload. Compress it at ilovepdf.com and try again.')
      return
    }
    setImporting(true)
    try {
      const { data } = await parseRateCard(file)
      setImportDraft(data)
    } catch (err) {
      alert('Could not read that rate card: ' + (err?.response?.data?.error || err.message))
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = '' // let the same file re-trigger onChange
    }
  }

  // Saves the reviewed import as a card plus its charges. The card must exist before its
  // lines can reference it, so the card insert is awaited first; the lines then go in
  // together rather than one round trip at a time.
  async function saveImport(cardData, lines) {
    const { data: created } = await createRateCard(cardData)
    const num = v => (v === '' || v === null || v === undefined ? null : Number(v))
    await Promise.all(lines.map((l, i) => addRateLine(created.id, {
      charge_name: l.charge_name || '',
      category: l.category || 'optional',
      basis: l.basis || 'flat',
      rate: l.basis === 'banded' ? null : num(l.rate),
      min_charge: num(l.min_charge),
      min_qty: num(l.min_qty),
      bands: l.basis === 'banded' ? (l.bands || []) : null,
      band_metric: l.basis === 'banded' ? (l.band_metric || 'weight_kg') : null,
      auto_apply: (l.category || 'optional') !== 'optional',
      condition_note: l.condition_note || '',
      remarks: l.remarks || '',
      sort_order: i,
    })))
    setExpanded(e => ({ ...e, [created.id]: true }))
    await load()
  }

  const q = search.toLowerCase()
  const filtered = cards.filter(c => !q
    || (c.vendor_name || '').toLowerCase().includes(q)
    || (c.title || '').toLowerCase().includes(q)
    || (c.mode || '').toLowerCase().includes(q)
    || (c.lines || []).some(l => (l.charge_name || '').toLowerCase().includes(q))
  )

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200, margin: '0 auto' }}>
      <div className="flex-between" style={{ marginBottom: 20 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1>Rate Cards</h1>
          <p>Negotiated partner rates, used to build job costs without re-keying a PDF</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="btn btn-ghost btn-sm" style={{ cursor: importing ? 'wait' : 'pointer' }}>
            {importing
              ? <><span className="spinner spinner-dark"></span> Reading…</>
              : <><Upload size={14} /> Import PDF</>}
            <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
              disabled={importing} onChange={e => handleImport(e.target.files[0])} />
          </label>
          <button className="btn btn-primary btn-sm" onClick={() => setCardModal(blankCard())}>
            <Plus size={14} /> New Rate Card
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        <input className="form-control search-input" placeholder="Search vendor, mode, or charge…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: '1 1 260px', maxWidth: 360 }} />
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {filtered.length} card{filtered.length === 1 ? '' : 's'}
        </span>
      </div>

      {loading && <div style={{ textAlign: 'center', padding: '60px 0', color: 'var(--text-muted)' }}>Loading…</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {!loading && !error && filtered.length === 0 && (
        <div className="empty-state">
          <div className="empty-state-icon" style={{ display: 'flex', justifyContent: 'center', color: 'var(--text-muted)' }}>
            <ReceiptText size={36} />
          </div>
          <h3>{search ? 'No rate cards match your search' : 'No rate cards yet'}</h3>
          <p style={{ fontSize: 13, marginTop: 4 }}>
            {search ? 'Try a different term' : 'Add a card for each partner that gives you agreed rates.'}
          </p>
        </div>
      )}

      {!loading && !error && filtered.map(card => {
        const open = !!expanded[card.id]
        const ccy = card.currency || 'SGD'
        return (
          <div key={card.id} className="card" style={{ marginBottom: 14, padding: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 18px', cursor: 'pointer' }}
              onClick={() => setExpanded(e => ({ ...e, [card.id]: !open }))}>
              {open ? <ChevronDown size={16} color="var(--text-muted)" /> : <ChevronRight size={16} color="var(--text-muted)" />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontWeight: 700, color: 'var(--heading)', fontSize: 14 }}>{card.vendor_name}</span>
                  {card.mode && <span className="pill" style={{ fontSize: 10 }}>{card.mode}</span>}
                  {card.is_active === false && (
                    <span className="pill pill-voided" style={{ fontSize: 10 }}>Inactive</span>
                  )}
                </div>
                {card.title && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{card.title}</div>}
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                {(card.lines || []).length} charge{(card.lines || []).length === 1 ? '' : 's'} · {ccy}
                {card.valid_from ? ` · from ${card.valid_from}` : ''}
              </span>
              <button className="btn btn-ghost btn-xs" onClick={e => { e.stopPropagation(); setCardModal(card) }}>
                <Pencil size={12} />
              </button>
              <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }}
                onClick={e => { e.stopPropagation(); removeCard(card) }}>
                <Trash2 size={12} />
              </button>
            </div>

            {open && (
              <div style={{ borderTop: '1px solid var(--border)', padding: '14px 18px' }}>
                {card.notes && (
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 0 }}>{card.notes}</p>
                )}
                {(card.lines || []).length === 0 ? (
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                    No charges on this card yet.
                  </p>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Charge</th><th>Type</th><th>Priced by</th>
                          <th style={{ textAlign: 'right' }}>Rate</th>
                          <th style={{ textAlign: 'right' }}>Min</th>
                          <th>When it applies</th><th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {card.lines.map(l => (
                          <tr key={l.id}>
                            <td style={{ fontWeight: 600, color: 'var(--heading)' }}>{l.charge_name}</td>
                            <td><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {CATEGORIES.find(c => c.v === l.category)?.label || l.category}
                            </span></td>
                            <td style={{ fontSize: 12 }}>
                              {l.basis === 'banded'
                                ? `${(l.bands || []).length} tiers · ${BAND_METRICS.find(m => m.v === l.band_metric)?.label || l.band_metric}`
                                : BASIS_LABEL[l.basis] || l.basis}
                            </td>
                            <td style={{ textAlign: 'right' }}>
                              {l.basis === 'banded' ? '—' : money(l.rate, l.currency || ccy)}
                            </td>
                            <td style={{ textAlign: 'right' }}>{money(l.min_charge, l.currency || ccy)}</td>
                            <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.condition_note || '—'}</td>
                            <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                              <button className="btn btn-ghost btn-xs"
                                onClick={() => setLineModal({ cardId: card.id, line: l })}>
                                <Pencil size={12} />
                              </button>
                              <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }}
                                onClick={() => removeLine(card.id, l)}>
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                <button className="btn btn-outline btn-sm" style={{ marginTop: 10 }}
                  onClick={() => setLineModal({ cardId: card.id, line: blankLine() })}>
                  <Plus size={13} /> Add charge
                </button>
              </div>
            )}
          </div>
        )
      })}

      {importDraft && (
        <ImportReviewModal draft={importDraft} onSave={saveImport} onClose={() => setImportDraft(null)} />
      )}
      {cardModal && (
        <CardModal card={cardModal} onSave={saveCard} onClose={() => setCardModal(null)} />
      )}
      {lineModal && (
        <LineModal
          line={lineModal.line}
          cardCurrency={(cards.find(c => c.id === lineModal.cardId)?.currency) || 'SGD'}
          onSave={d => saveLine(lineModal.cardId, d)}
          onClose={() => setLineModal(null)}
        />
      )}
    </div>
  )
}
