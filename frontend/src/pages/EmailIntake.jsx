import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { parseEmail, parseEmailFile, createJob } from '../api'

const MODES = ['Air Express', 'Local Delivery', 'Local Clearance & Delivery', 'Sea FCL', 'Sea LCL']
const STATUSES = ['New', 'In Progress', 'Completed', 'On Hold']

const emptyJob = {
  shipper: '', consignee: '',
  pickup_address: '', pickup_contact_name: '', pickup_contact_number: '',
  delivery_address: '', delivery_contact_name: '', delivery_contact_number: '',
  packages: '', dimensions: '', weight: '', cbm: '', commodity: '',
  mode: 'Air Express', agent: '', status: 'New',
  customer_ref: '', deadline_date: '', notes: '',
  billing_lines: []
}

export default function EmailIntake() {
  const [emailText, setEmailText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const navigate = useNavigate()

  function applyParsedData(data) {
    const merged = { ...emptyJob }
    Object.keys(merged).forEach(k => {
      if (data[k] != null && data[k] !== '') merged[k] = data[k]
    })
    if (data.billing_lines) merged.billing_lines = data.billing_lines
    setForm(merged)
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
    setForm(f => ({ ...f, billing_lines: [...(f.billing_lines||[]), { service:'', unit:'', rate:'', qty:'1', remarks:'' }] }))
  }

  function removeBillingLine(idx) {
    setForm(f => ({ ...f, billing_lines: f.billing_lines.filter((_,i) => i !== idx) }))
  }

  async function handleCreate() {
    setSaving(true)
    try {
      const payload = {
        ...form,
        weight: form.weight ? parseFloat(form.weight) : null,
        packages: form.packages ? parseInt(form.packages) : null,
        cbm: form.cbm ? parseFloat(form.cbm) : null,
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
  }

  return (
    <div>
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

        {/* File drop zone */}
        <div
          onClick={() => !parsing && fileInputRef.current.click()}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={e => { e.preventDefault(); setDragOver(false); handleFileParse(e.dataTransfer.files[0]) }}
          style={{
            border: `2px dashed ${dragOver ? 'var(--blue)' : 'var(--border)'}`,
            borderRadius: 10,
            padding: '24px 16px',
            textAlign: 'center',
            cursor: parsing ? 'not-allowed' : 'pointer',
            background: dragOver ? 'rgba(24,95,165,0.04)' : 'var(--bg)',
            marginBottom: 16,
            transition: 'all 0.15s'
          }}
        >
          <div style={{ fontSize: 28, marginBottom: 6 }}>📎</div>
          <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
            {parsing ? 'Extracting...' : 'Drop file here or click to upload'}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            PDF, .eml, .msg — Claude reads and extracts all fields
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.eml,.msg,.txt"
            style={{ display: 'none' }}
            onChange={e => handleFileParse(e.target.files[0])}
          />
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
        </div>
      </div>

      {/* Review form */}
      {form && (
        <div className="card">
          <div className="section-title">
            Review & Edit Job Details
            <button className="btn btn-primary" onClick={handleCreate} disabled={saving}>
              {saving ? <><span className="spinner"></span> Saving...</> : '✓ Create Job'}
            </button>
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

          {/* Shipment details */}
          <div className="form-grid-4 mb-4">
            <div className="form-group">
              <label className="form-label">Packages</label>
              <input type="number" className="form-control" value={form.packages} onChange={e => setField('packages', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Weight (kg)</label>
              <input type="number" className="form-control" value={form.weight} onChange={e => setField('weight', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Dimensions</label>
              <input className="form-control" value={form.dimensions} onChange={e => setField('dimensions', e.target.value)} placeholder="e.g. 60x40x30 cm" />
            </div>
            <div className="form-group">
              <label className="form-label">CBM</label>
              <input type="number" className="form-control" value={form.cbm} onChange={e => setField('cbm', e.target.value)} />
            </div>
          </div>

          <div className="form-grid-3 mb-4">
            <div className="form-group">
              <label className="form-label">Commodity</label>
              <input className="form-control" value={form.commodity} onChange={e => setField('commodity', e.target.value)} />
            </div>
            <div className="form-group">
              <label className="form-label">Agent</label>
              <input className="form-control" value={form.agent} onChange={e => setField('agent', e.target.value)} />
            </div>
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

          {/* Billing lines pre-fill */}
          <div className="section-title">
            Pre-filled Billing Lines
            <button className="btn btn-outline btn-sm" onClick={addBillingLine}>+ Add Line</button>
          </div>
          {form.billing_lines && form.billing_lines.length > 0
            ? <table className="inline-table" style={{ marginBottom: 12 }}>
                <thead>
                  <tr>
                    <th>Service</th><th>Unit</th><th style={{width:90}}>Rate (SGD)</th>
                    <th style={{width:80}}>Qty</th><th style={{width:100}}>Total</th>
                    <th>Remarks</th><th style={{width:40}}></th>
                  </tr>
                </thead>
                <tbody>
                  {form.billing_lines.map((bl, i) => {
                    const total = (parseFloat(bl.rate)||0) * (parseFloat(bl.qty)||1)
                    return (
                      <tr key={i}>
                        <td><input className="form-control form-control-sm" value={bl.service||''} onChange={e => setBillingLine(i,'service',e.target.value)} /></td>
                        <td><input className="form-control form-control-sm" value={bl.unit||''} onChange={e => setBillingLine(i,'unit',e.target.value)} /></td>
                        <td><input type="number" className="form-control form-control-sm" value={bl.rate||''} onChange={e => setBillingLine(i,'rate',e.target.value)} /></td>
                        <td><input type="number" className="form-control form-control-sm" value={bl.qty||''} onChange={e => setBillingLine(i,'qty',e.target.value)} /></td>
                        <td className="text-right font-bold">${total.toFixed(2)}</td>
                        <td><input className="form-control form-control-sm" value={bl.remarks||''} onChange={e => setBillingLine(i,'remarks',e.target.value)} /></td>
                        <td><button className="btn btn-ghost btn-xs" onClick={() => removeBillingLine(i)} style={{color:'var(--red)'}}>✕</button></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            : <p className="text-muted" style={{ fontSize: 13, marginBottom: 12 }}>No billing lines extracted. Add them after creating the job or add manually above.</p>
          }

          <div className="flex-between mt-4" style={{ paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-ghost" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn btn-navy" onClick={handleCreate} disabled={saving}>
              {saving ? <><span className="spinner"></span> Creating...</> : '✓ Create Job'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
