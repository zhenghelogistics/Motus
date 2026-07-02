import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseEmail, parseEmailFile, parseDO, parsePackingList, createJob, getJobs, getCustomers } from '../api'
import { useAuth } from '../lib/AuthContext'
import DimensionBoxes from '../components/DimensionBoxes'

const MODES = ['Air Express', 'Air Freight', 'LCL Express', 'LCL', 'Local Delivery', 'Local Clearance & Delivery', 'Sea FCL', 'Sea LCL', 'Warehousing']
const STATUSES = ['New', 'In Progress', 'Completed', 'On Hold']

const emptyJob = {
  shipper: '', consignee: '',
  customer_name: '', customer_contact_name: '', customer_contact_number: '', customer_email: '',
  pickup_address: '', pickup_contact_name: '', pickup_contact_number: '',
  delivery_address: '', delivery_contact_name: '', delivery_contact_number: '',
  packages: '', dimensions: '', weight: '', cbm: '', commodity: '',
  mode: 'Air Express', agent: '', status: 'New',
  customer_ref: '', deadline_date: '', notes: '',
  billing_lines: []
}

function nameFromEmail(email) {
  if (!email) return ''
  const prefix = email.split('@')[0]
  return prefix.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}

export default function EmailIntake() {
  const { user } = useAuth()
  const [emailText, setEmailText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [dimResetKey, setDimResetKey] = useState(0)

  // Copy from previous job modal
  const [copyModal, setCopyModal] = useState(false)
  const [recentJobs, setRecentJobs] = useState([])
  const [copySearch, setCopySearch] = useState('')
  const [copyLoading, setCopyLoading] = useState(false)

  // Customer autocomplete
  const [customerSuggestions, setCustomerSuggestions] = useState([])
  const [showCustomerDrop, setShowCustomerDrop] = useState(false)

  const fileInputRef = useRef(null)
  const doFileRef = useRef(null)
  const [doParsing, setDoParsing] = useState(false)
  const [doDragOver, setDoDragOver] = useState(false)
  const [plItems, setPlItems] = useState([])
  const [plParsing, setPlParsing] = useState(false)
  const navigate = useNavigate()

  function applyParsedData(data) {
    const merged = { ...emptyJob }
    Object.keys(merged).forEach(k => {
      if (data[k] != null && data[k] !== '') merged[k] = data[k]
    })
    if (data.billing_lines) merged.billing_lines = data.billing_lines
    setForm(merged)
    setDimResetKey(k => k + 1)
  }

  async function handleParse() {
    if (!emailText.trim()) return
    setParsing(true)
    setParseError('')
    try {
      const { data } = await parseEmail(emailText)
      applyParsedData(data)
    } catch (err) {
      setParseError(err.response?.data?.error || 'Parsing failed. Please try again.')
    } finally {
      setParsing(false)
    }
  }

  async function handleFileParse(file) {
    if (!file) return
    const allowed = ['.pdf', '.eml', '.msg', '.txt']
    const ext = '.' + file.name.split('.').pop().toLowerCase()
    if (!allowed.includes(ext)) {
      setParseError('Please upload a PDF, .eml, or .msg file.')
      return
    }
    setParsing(true)
    setParseError('')
    try {
      const { data } = await parseEmailFile(file)
      applyParsedData(data)
    } catch (err) {
      setParseError(err.response?.data?.error || 'File parsing failed. Please try again.')
    } finally {
      setParsing(false)
    }
  }

  async function extractPDFText(file) {
    try {
      const pdfjsLib = await import('pdfjs-dist')
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).href
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      let text = ''
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const content = await page.getTextContent()
        text += content.items.map(item => item.str).join(' ') + '\n'
      }
      return text.trim()
    } catch (_) {
      return ''
    }
  }

  async function handleDOParse(file) {
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setParseError('Please upload a PDF file for DO / Packing List parsing.')
      return
    }
    setDoParsing(true)
    setParseError('')
    try {
      const text = await extractPDFText(file)
      const useText = text.length > 100
      if (!useText && file.size > 4 * 1024 * 1024) {
        setParseError('This appears to be a scanned PDF and is too large to upload (max 4 MB). Please compress it at ilovepdf.com first.')
        return
      }
      const [doRes, plRes] = await Promise.allSettled([
        useText ? parseDO(null, text) : parseDO(file, null),
        useText ? parsePackingList(null, text) : parsePackingList(file, null)
      ])
      if (doRes.status === 'fulfilled') applyParsedData(doRes.value.data)
      if (plRes.status === 'fulfilled') setPlItems(Array.isArray(plRes.value.data) ? plRes.value.data : [])

      // Promise.allSettled never rejects, so failures here would otherwise pass silently —
      // surface them instead of leaving the user staring at an empty packing list.
      const errors = []
      if (doRes.status === 'rejected') {
        errors.push(`job details (${doRes.reason?.response?.data?.error || doRes.reason?.message || 'failed'})`)
      }
      if (plRes.status === 'rejected') {
        errors.push(`packing list items (${plRes.reason?.response?.data?.error || plRes.reason?.message || 'failed'})`)
      } else if (Array.isArray(plRes.value?.data) && plRes.value.data.length === 0) {
        errors.push('packing list items (none found in this document)')
      }
      if (errors.length) setParseError(`Could not extract: ${errors.join('; ')}.`)
    } catch (err) {
      setParseError(err.response?.data?.error || 'DO / Packing List parsing failed. Please try again.')
    } finally {
      setDoParsing(false)
      if (doFileRef.current) doFileRef.current.value = ''
    }
  }

  async function handlePLParse(file) {
    if (!file) return
    setPlParsing(true)
    try {
      const text = await extractPDFText(file)
      const { data } = text.length > 50
        ? await parsePackingList(null, text)
        : await parsePackingList(file, null)
      setPlItems(Array.isArray(data) ? data : [])
    } catch (e) {
      setParseError(e?.response?.data?.error || 'Packing list parsing failed.')
    } finally {
      setPlParsing(false)
    }
  }

  function updatePLItem(i, key, val) {
    const items = [...plItems]
    items[i] = { ...items[i], [key]: val }
    setPlItems(items)
  }

  function removePLItem(i) {
    setPlItems(plItems.filter((_, idx) => idx !== i))
  }

  function addPLRow() {
    setPlItems([...plItems, { sku: '', description: '', qty_actual: '', unit: 'pcs', num_packages: '', length_cm: '', breadth_cm: '', height_cm: '' }])
  }

  function setField(k, v) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function setBillingLine(idx, key, val) {
    setForm(f => {
      const lines = [...(f.billing_lines || [])]
      lines[idx] = { ...lines[idx], [key]: val }
      return { ...f, billing_lines: lines }
    })
  }

  function addBillingLine() {
    setForm(f => ({ ...f, billing_lines: [...(f.billing_lines || []), { service: '', unit: '', rate: '', qty: '1', remarks: '' }] }))
  }

  function removeBillingLine(idx) {
    setForm(f => ({ ...f, billing_lines: f.billing_lines.filter((_, i) => i !== idx) }))
  }

  async function handleCreate() {
    setSaving(true)
    try {
      const payload = {
        ...form,
        weight: form.weight ? parseFloat(form.weight) : null,
        packages: form.packages ? parseInt(form.packages) : null,
        cbm: form.cbm ? parseFloat(form.cbm) : null,
        packing_list_items: plItems,
        billing_lines: (form.billing_lines || []).map(bl => ({
          ...bl,
          rate: parseFloat(bl.rate) || 0,
          qty: parseFloat(bl.qty) || 1
        }))
      }
      const { data } = await createJob(payload)
      navigate(`/jobs/${data.id}`)
    } catch (err) {
      alert('Failed to create job: ' + (err.response?.data?.error || err.message))
    } finally {
      setSaving(false)
    }
  }

  function handleManual() {
    setForm({ ...emptyJob })
    setDimResetKey(k => k + 1)
  }

  // ── Copy from previous job ────────────────────────────────────────────────
  async function openCopyModal() {
    setCopyModal(true)
    setCopySearch('')
    setCopyLoading(true)
    try {
      const { data } = await getJobs({ limit: 50 })
      setRecentJobs(data)
    } catch {
      setRecentJobs([])
    } finally {
      setCopyLoading(false)
    }
  }

  function copyFromJob(j) {
    const copied = {
      shipper: j.shipper || '',
      consignee: j.consignee || '',
      customer_name: j.customer_name || '',
      customer_email: j.customer_email || '',
      customer_contact_name: j.customer_contact_name || '',
      customer_contact_number: j.customer_contact_number || '',
      pickup_address: j.pickup_address || '',
      pickup_contact_name: j.pickup_contact_name || '',
      pickup_contact_number: j.pickup_contact_number || '',
      delivery_address: j.delivery_address || '',
      delivery_contact_name: j.delivery_contact_name || '',
      delivery_contact_number: j.delivery_contact_number || '',
      mode: j.mode || 'Air Express',
      agent: j.agent || '',
      commodity: j.commodity || '',
      notes: j.notes || '',
      // reset shipment-specific fields
      packages: '', dimensions: '', weight: '', cbm: '',
      customer_ref: '', deadline_date: '',
      status: 'New',
      billing_lines: [],
    }
    setForm({ ...emptyJob, ...copied })
    setDimResetKey(k => k + 1)
    setCopyModal(false)
  }

  const filteredRecentJobs = recentJobs.filter(j => {
    if (!copySearch) return true
    const q = copySearch.toLowerCase()
    return [j.job_number, j.shipper, j.consignee, j.customer_ref, j.customer_name]
      .some(v => v?.toLowerCase().includes(q))
  })

  // ── Customer autocomplete ─────────────────────────────────────────────────
  async function searchCustomers(q) {
    try {
      const { data } = await getCustomers(q)
      setCustomerSuggestions(data)
      setShowCustomerDrop(data.length > 0)
    } catch {
      setShowCustomerDrop(false)
    }
  }

  function selectCustomer(c) {
    setField('customer_name', c.customer_name || c.display_name || '')
    setField('customer_email', c.customer_email || '')
    setField('customer_contact_name', c.customer_contact_name || '')
    setField('customer_contact_number', c.customer_contact_number || '')
    setShowCustomerDrop(false)
  }

  return (
    <div>
      {/* Copy from previous job modal */}
      {copyModal && (
        <div className="modal-overlay" onClick={() => setCopyModal(false)}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Copy from Previous Job</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setCopyModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>
              <input className="form-control mb-3" placeholder="Search by job no., shipper, consignee, ref..."
                value={copySearch} onChange={e => setCopySearch(e.target.value)} autoFocus />
              {copyLoading
                ? <div style={{ textAlign: 'center', padding: 32 }}><span className="spinner spinner-dark" /></div>
                : (
                  <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                    {filteredRecentJobs.length === 0
                      ? <p className="text-muted" style={{ fontSize: 13, padding: '12px 0' }}>No jobs found.</p>
                      : filteredRecentJobs.map(j => (
                        <div key={j.id} onClick={() => copyFromJob(j)}
                          style={{ padding: '10px 12px', borderRadius: 8, cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background 0.1s' }}
                          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                          onMouseLeave={e => e.currentTarget.style.background = ''}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 700, color: 'var(--navy)', fontSize: 13 }}>{j.job_number}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{j.mode}</span>
                          </div>
                          <div style={{ fontSize: 12, marginTop: 3, color: 'var(--text)' }}>
                            {j.shipper || '—'} → {j.consignee || '—'}
                          </div>
                          {j.customer_ref && <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 2 }}>Ref: {j.customer_ref}</div>}
                        </div>
                      ))
                    }
                  </div>
                )
              }
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <h1>New Job</h1>
        <p>Paste a customer email to auto-extract job details, or create manually.</p>
      </div>

      {/* AI Intake */}
      <div className="card mb-6">
        <div className="section-title" style={{ borderBottom: 'none' }}>Extract with AI</div>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Upload a PDF or .eml file, or paste email text — Claude will extract all job details automatically.
        </p>

        {/* File drop zones — Email/Quote + DO/Packing List */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
          <div
            onClick={() => !parsing && fileInputRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={e => { e.preventDefault(); setDragOver(false); handleFileParse(e.dataTransfer.files[0]) }}
            style={{
              border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border)'}`,
              borderRadius: 10,
              padding: '20px 12px',
              textAlign: 'center',
              cursor: parsing ? 'not-allowed' : 'pointer',
              background: dragOver ? 'rgba(24,95,165,0.04)' : 'var(--bg)',
              transition: 'all 0.15s'
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 4 }}>📎</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              {parsing ? 'Extracting...' : 'Email / Quote'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              PDF, .eml, .msg — extracts order details
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.eml,.msg,.txt"
              style={{ display: 'none' }}
              onChange={e => handleFileParse(e.target.files[0])}
            />
          </div>

          <div
            onClick={() => !doParsing && doFileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDoDragOver(true) }}
            onDragLeave={() => setDoDragOver(false)}
            onDrop={e => { e.preventDefault(); setDoDragOver(false); handleDOParse(e.dataTransfer.files[0]) }}
            style={{
              border: `2px dashed ${doDragOver ? '#0369A1' : '#93C5FD'}`,
              borderRadius: 10,
              padding: '20px 12px',
              textAlign: 'center',
              cursor: doParsing ? 'not-allowed' : 'pointer',
              background: doDragOver ? 'rgba(3,105,161,0.04)' : 'var(--bg)',
              transition: 'all 0.15s'
            }}
          >
            <div style={{ fontSize: 24, marginBottom: 4 }}>📦</div>
            <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)' }}>
              {doParsing ? 'Parsing DO...' : 'Delivery Order / Packing List'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>
              DO PDF — sets Warehousing mode + extracts items
            </div>
            <input
              ref={doFileRef}
              type="file"
              accept=".pdf"
              style={{ display: 'none' }}
              onChange={e => handleDOParse(e.target.files[0])}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
          <span style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>OR PASTE TEXT</span>
          <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
        </div>

        <textarea
          className="form-control"
          style={{ minHeight: 140, fontFamily: 'monospace', fontSize: 12 }}
          placeholder="Paste email text here..."
          value={emailText}
          onChange={e => setEmailText(e.target.value)}
        />
        {parseError && <div className="alert alert-error mt-4">{parseError}</div>}
        <div className="flex gap-2 mt-4">
          <button className="btn btn-primary" onClick={handleParse} disabled={parsing || !emailText.trim()}>
            {parsing ? <><span className="spinner"></span> Extracting...</> : '⚡ Extract with AI'}
          </button>
          <button className="btn btn-ghost" onClick={handleManual}>Create Manually</button>
          <button className="btn btn-ghost" onClick={openCopyModal}>⎘ Copy from Previous Job</button>
        </div>
      </div>

      {/* Review form */}
      {form && (
        <div className="card">
          <div className="section-title">
            Review & Edit Job Details
            <div style={{ display:'flex', alignItems:'center', gap:10 }}>
              {user?.email && (
                <span style={{ fontSize:12, color:'var(--text-muted)', fontWeight:400 }}>
                  Submitting as <strong>{nameFromEmail(user.email)}</strong>
                </span>
              )}
              <button className="btn btn-primary" onClick={handleCreate}
                disabled={saving || (form.mode === 'Warehousing' && !plItems.length)}
                title={form.mode === 'Warehousing' && !plItems.length ? 'Add a packing list before creating a Warehousing job' : ''}>
                {saving ? <><span className="spinner"></span> Saving...</> : '✓ Create Job'}
              </button>
            </div>
          </div>

          {/* Core info */}
          <div className="form-grid-2 mb-4">
            <div className="form-group">
              <label className="form-label">Shipper</label>
              <input className="form-control" value={form.shipper} onChange={e => setField('shipper', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Consignee</label>
              <input className="form-control" value={form.consignee} onChange={e => setField('consignee', e.target.value)} />
            </div>
          </div>

          {/* Customer (billing party) */}
          <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 10 }}>Customer (Billing Party)</div>
            <div className="form-grid-2 mb-2">
              <div className="form-group" style={{ position: 'relative' }}>
                <label className="form-label">Customer Name</label>
                <input className="form-control" value={form.customer_name}
                  placeholder="Type to search past customers..."
                  onChange={e => { setField('customer_name', e.target.value); searchCustomers(e.target.value) }}
                  onFocus={() => searchCustomers(form.customer_name)}
                  onBlur={() => setTimeout(() => setShowCustomerDrop(false), 180)}
                />
                {showCustomerDrop && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                    background: 'white', border: '1px solid var(--border-solid)', borderRadius: 8,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.12)', maxHeight: 220, overflowY: 'auto'
                  }}>
                    {customerSuggestions.map((c, i) => (
                      <div key={i}
                        onMouseDown={() => selectCustomer(c)}
                        style={{ padding: '9px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', fontSize: 13 }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg)'}
                        onMouseLeave={e => e.currentTarget.style.background = ''}>
                        <div style={{ fontWeight: 700, color: 'var(--navy)' }}>{c.display_name}</div>
                        {c.customer_email && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.customer_email}</div>}
                        {c.customer_contact_name && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{c.customer_contact_name} {c.customer_contact_number}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="form-group">
                <label className="form-label">Customer Email</label>
                <input type="email" className="form-control" value={form.customer_email} onChange={e => setField('customer_email', e.target.value)} />
              </div>
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Contact Name</label>
                <input className="form-control" value={form.customer_contact_name} onChange={e => setField('customer_contact_name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Contact Number</label>
                <input className="form-control" value={form.customer_contact_number} onChange={e => setField('customer_contact_number', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="form-grid-3 mb-4">
            <div className="form-group">
              <label className="form-label">Customer Ref</label>
              <input className="form-control" value={form.customer_ref} onChange={e => setField('customer_ref', e.target.value)} placeholder="e.g. KPS1137" />
            </div>
            <div className="form-group">
              <label className="form-label">Mode</label>
              <select className="form-control" value={form.mode} onChange={e => setField('mode', e.target.value)}>
                {MODES.map(m => <option key={m}>{m}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Deadline Date</label>
              <input type="date" className="form-control" value={form.deadline_date} onChange={e => setField('deadline_date', e.target.value)} />
            </div>
          </div>

          {/* Pickup */}
          <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 10 }}>Pickup</div>
            <div className="form-group">
              <label className="form-label">Address</label>
              <input className="form-control" value={form.pickup_address} onChange={e => setField('pickup_address', e.target.value)} />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Contact Name</label>
                <input className="form-control" value={form.pickup_contact_name} onChange={e => setField('pickup_contact_name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Contact Number</label>
                <input className="form-control" value={form.pickup_contact_number} onChange={e => setField('pickup_contact_number', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Delivery */}
          <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 10 }}>Delivery</div>
            <div className="form-group">
              <label className="form-label">Address</label>
              <input className="form-control" value={form.delivery_address} onChange={e => setField('delivery_address', e.target.value)} />
            </div>
            <div className="form-grid-2">
              <div className="form-group">
                <label className="form-label">Contact Name</label>
                <input className="form-control" value={form.delivery_contact_name} onChange={e => setField('delivery_contact_name', e.target.value)} />
              </div>
              <div className="form-group">
                <label className="form-label">Contact Number</label>
                <input className="form-control" value={form.delivery_contact_number} onChange={e => setField('delivery_contact_number', e.target.value)} />
              </div>
            </div>
          </div>

          {/* Shipment details: weight + dimensions (with per-box CBM) */}
          <div className="form-grid-2 mb-3" style={{ maxWidth: 360 }}>
            <div className="form-group">
              <label className="form-label">Weight (kg)</label>
              <input type="number" className="form-control" value={form.weight} onChange={e => setField('weight', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">CBM <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 400 }}>(auto-calc)</span></label>
              <input type="number" className="form-control" value={form.cbm} onChange={e => setField('cbm', e.target.value)} placeholder="Auto from dims" />
            </div>
          </div>

          <div style={{ background: 'var(--bg)', borderRadius: 8, padding: 14, marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--navy)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 12 }}>
              Dimensions <span style={{ fontWeight: 400, fontSize: 11, textTransform: 'none', color: 'var(--text-muted)' }}>— L × W × H (cm) per box</span>
            </div>
            <DimensionBoxes
              packages={form.packages}
              dimensions={form.dimensions}
              syncKey={dimResetKey}
              onChange={({ packages, dimensions, cbm }) => {
                if (packages !== undefined) setField('packages', packages)
                if (dimensions !== undefined) setField('dimensions', dimensions)
                if (cbm !== undefined) setField('cbm', cbm != null ? cbm : form.cbm)
              }}
            />
          </div>

          <div className="form-grid-2 mb-4">
            <div className="form-group">
              <label className="form-label">Commodity</label>
              <input className="form-control" value={form.commodity} onChange={e => setField('commodity', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Agent</label>
              <input className="form-control" value={form.agent} onChange={e => setField('agent', e.target.value)} />
            </div>
          </div>

          <div className="form-grid-2 mb-4">
            <div className="form-group">
              <label className="form-label">Status</label>
              <select className="form-control" value={form.status} onChange={e => setField('status', e.target.value)}>
                {STATUSES.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className="form-group mb-4">
            <label className="form-label">Notes</label>
            <textarea className="form-control" value={form.notes} onChange={e => setField('notes', e.target.value)} rows={2} />
          </div>

          {/* Packing list — required for Warehousing jobs */}
          {form.mode === 'Warehousing' && (
            <div style={{ background: plItems.length ? '#F0FDF4' : '#FFF7ED', border: `1px solid ${plItems.length ? '#BBF7D0' : '#FED7AA'}`, borderRadius: 8, padding: 14, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: plItems.length ? '#166534' : '#92400E', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                  {plItems.length ? `Packing List — ${plItems.length} item(s)` : 'Packing List Required'}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                    {plParsing ? <><span className="spinner spinner-dark"></span> Parsing...</> : '⬆ Upload PDF'}
                    <input type="file" accept=".pdf" style={{ display: 'none' }}
                      onChange={e => { handlePLParse(e.target.files[0]); e.target.value = '' }} />
                  </label>
                  <button className="btn btn-ghost btn-sm" onClick={addPLRow}>+ Row</button>
                </div>
              </div>
              {!plItems.length ? (
                <p style={{ fontSize: 13, color: '#78350F', margin: 0 }}>
                  Warehousing jobs require a packing list before creation. Upload a packing list PDF or add rows manually.
                </p>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid #BBF7D0', color: '#166534', textAlign: 'left' }}>
                        {['SKU', 'Description', 'Qty', 'Unit', 'Pkgs', 'L cm', 'B cm', 'H cm', ''].map(h => (
                          <th key={h} style={{ padding: '4px 6px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {plItems.map((item, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #DCFCE7' }}>
                          {[
                            ['sku', 80, false],
                            ['description', 160, false],
                            ['qty_actual', 60, true],
                            ['unit', 65, false],
                            ['num_packages', 55, true],
                            ['length_cm', 55, true],
                            ['breadth_cm', 55, true],
                            ['height_cm', 55, true],
                          ].map(([key, w, isNum]) => (
                            <td key={key} style={{ padding: '3px 4px' }}>
                              <input
                                className="form-control"
                                type={isNum ? 'number' : 'text'}
                                value={item[key] ?? ''}
                                onChange={e => updatePLItem(i, key, e.target.value)}
                                style={{ padding: '2px 6px', fontSize: 12, width: w }}
                              />
                            </td>
                          ))}
                          <td style={{ padding: '3px 4px' }}>
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--red)', padding: '2px 6px' }} onClick={() => removePLItem(i)}>✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Billing lines pre-fill */}
          <div className="section-title">
            Pre-filled Billing Lines
            <button className="btn btn-outline btn-sm" onClick={addBillingLine}>+ Add Line</button>
          </div>
          {form.billing_lines && form.billing_lines.length > 0
            ? <table className="inline-table" style={{ marginBottom: 12 }}>
              <thead>
                <tr>
                  <th>Service</th><th>Unit</th><th style={{ width: 90 }}>Rate (SGD)</th>
                  <th style={{ width: 80 }}>Qty</th><th style={{ width: 100 }}>Total</th>
                  <th>Remarks</th><th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {form.billing_lines.map((bl, i) => {
                  const total = (parseFloat(bl.rate) || 0) * (parseFloat(bl.qty) || 1)
                  return (
                    <tr key={i}>
                      <td><input className="form-control form-control-sm" value={bl.service || ''} onChange={e => setBillingLine(i, 'service', e.target.value)} /></td>
                      <td><input className="form-control form-control-sm" value={bl.unit || ''} onChange={e => setBillingLine(i, 'unit', e.target.value)} /></td>
                      <td><input type="number" className="form-control form-control-sm" value={bl.rate || ''} onChange={e => setBillingLine(i, 'rate', e.target.value)} /></td>
                      <td><input type="number" className="form-control form-control-sm" value={bl.qty || ''} onChange={e => setBillingLine(i, 'qty', e.target.value)} /></td>
                      <td className="text-right font-bold">${total.toFixed(2)}</td>
                      <td><input className="form-control form-control-sm" value={bl.remarks || ''} onChange={e => setBillingLine(i, 'remarks', e.target.value)} /></td>
                      <td><button className="btn btn-ghost btn-xs" onClick={() => removeBillingLine(i)} style={{ color: 'var(--red)' }}>✕</button></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            : <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>No billing lines extracted. Add them after creating the job or add manually above.</p>
          }

          <div className="flex-between mt-4" style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              {user?.email && (
                <span style={{ fontSize:12, color:'var(--text-muted)' }}>
                  Submitting as <strong>{nameFromEmail(user.email)}</strong>
                </span>
              )}
              <button className="btn btn-navy" onClick={handleCreate}
                disabled={saving || (form.mode === 'Warehousing' && !plItems.length)}>
                {saving
                  ? <><span className="spinner"></span> Creating...</>
                  : form.mode === 'Warehousing' && !plItems.length
                    ? 'Add Packing List First'
                    : '✓ Create Job'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
