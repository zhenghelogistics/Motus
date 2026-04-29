import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  getJob, updateJob, deleteJob,
  addCostLine, updateCostLine, deleteCostLine,
  addBillingLine, updateBillingLine, deleteBillingLine,
  uploadDocument, deleteDocument, parseInvoice
} from '../api'

const MODES = ['Air Express', 'Local Delivery', 'Local Clearance & Delivery', 'Sea FCL', 'Sea LCL']
const STATUSES = ['New', 'In Progress', 'Completed', 'On Hold']
const DOC_TYPES = ['CI', 'PL', 'DO', 'Invoice', 'Other']
const navy = [4, 44, 83]
const blue = [24, 95, 165]

const fmt = (n) => `$${Number(n||0).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function deadlineClass(date) {
  if (!date) return ''
  const today = new Date(); today.setHours(0,0,0,0)
  const d = new Date(date)
  const diff = Math.ceil((d - today) / (1000*60*60*24))
  if (diff < 0) return 'deadline-past'
  if (diff <= 3) return 'deadline-soon'
  return 'deadline-ok'
}

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [infoForm, setInfoForm] = useState({})
  const [invoiceParsing, setInvoiceParsing] = useState(false)
  const [sendToAccountsModal, setSendToAccountsModal] = useState(false)
  const [gpEditing, setGpEditing] = useState(false)
  const [gpInput, setGpInput] = useState('')
  const invoiceRef = useRef()

  function loadJob() {
    return getJob(id).then(r => { setJob(r.data); setLoading(false) })
  }
  useEffect(() => { loadJob() }, [id])
  useEffect(() => { if (job) setInfoForm(f => f.id === job.id ? f : { ...job }) }, [job?.id])

  // ── Info editing (always-on, save on button click) ────────────────────────
  async function saveInfo() {
    setSaving(true)
    try {
      const r = await updateJob(id, infoForm)
      setJob(j => ({ ...j, ...r.data }))
    } finally { setSaving(false) }
  }

  function setInfo(k, v) { setInfoForm(f => ({ ...f, [k]: v })) }

  // ── Status quick-change ───────────────────────────────────────────────────
  async function changeStatus(status) {
    const r = await updateJob(id, { status })
    setJob(j => ({ ...j, status: r.data.status }))
  }

  // ── GP override ───────────────────────────────────────────────────────────
  function startGpEdit() { setGpInput(job.gp_override != null ? String(job.gp_override) : ''); setGpEditing(true) }

  async function saveGpOverride() {
    const val = gpInput.trim() === '' ? null : parseFloat(gpInput)
    const r = await updateJob(id, { gp_override: val })
    setJob(j => ({ ...j, gp_override: r.data.gp_override, gp_percent: r.data.gp_percent, computed_gp: r.data.computed_gp }))
    setGpEditing(false)
  }

  async function clearGpOverride() {
    const r = await updateJob(id, { gp_override: null })
    setJob(j => ({ ...j, gp_override: null, gp_percent: r.data.computed_gp, computed_gp: r.data.computed_gp }))
  }

  // ── Cost lines ───────────────────────────────────────────────────────────
  async function addCost() {
    const r = await addCostLine(id, { vendor:'', amount:0, invoice_no:'', invoice_date:'', service:'', remarks:'' })
    setJob(j => ({ ...j, cost_lines: [...j.cost_lines, r.data] }))
    refreshTotals()
  }
  async function saveCost(lid, data) {
    const r = await updateCostLine(id, lid, data)
    setJob(j => ({ ...j, cost_lines: j.cost_lines.map(l => l.id === lid ? r.data : l) }))
    refreshTotals()
  }
  async function removeCost(lid) {
    await deleteCostLine(id, lid)
    setJob(j => ({ ...j, cost_lines: j.cost_lines.filter(l => l.id !== lid) }))
    refreshTotals()
  }

  // ── Billing lines ─────────────────────────────────────────────────────────
  async function addBilling() {
    const r = await addBillingLine(id, { service:'', unit:'', rate:0, qty:1, remarks:'' })
    setJob(j => ({ ...j, billing_lines: [...j.billing_lines, r.data] }))
    refreshTotals()
  }
  async function saveBilling(lid, data) {
    const r = await updateBillingLine(id, lid, data)
    setJob(j => ({ ...j, billing_lines: j.billing_lines.map(l => l.id === lid ? r.data : l) }))
    refreshTotals()
  }
  async function removeBilling(lid) {
    await deleteBillingLine(id, lid)
    setJob(j => ({ ...j, billing_lines: j.billing_lines.filter(l => l.id !== lid) }))
    refreshTotals()
  }

  function refreshTotals() { getJob(id).then(r => setJob(r.data)) }

  // ── Invoice PDF parse → triggers Send to Accounts modal ──────────────────
  async function handleInvoiceUpload(file) {
    if (!file) return
    setInvoiceParsing(true)
    try {
      const { data } = await parseInvoice(file)
      const r = await addCostLine(id, {
        vendor: data.vendor || '',
        amount: data.amount || 0,
        invoice_no: data.invoice_no || '',
        invoice_date: data.invoice_date || null,
        service: data.service || '',
        remarks: data.remarks || ''
      })
      setJob(j => ({ ...j, cost_lines: [...j.cost_lines, r.data] }))
      refreshTotals()
      setSendToAccountsModal(true) // 🔔 trigger popup
    } catch (err) {
      alert('Invoice parsing failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setInvoiceParsing(false)
      if (invoiceRef.current) invoiceRef.current.value = ''
    }
  }

  // ── Documents ─────────────────────────────────────────────────────────────
  async function handleDocUpload(file, docType) {
    if (!file) return
    const r = await uploadDocument(id, file, docType || 'Other')
    setJob(j => ({ ...j, documents: [r.data, ...j.documents] }))
  }
  async function removeDoc(did) {
    if (!confirm('Delete this document?')) return
    await deleteDocument(id, did)
    setJob(j => ({ ...j, documents: j.documents.filter(d => d.id !== did) }))
  }

  async function handleDelete() {
    if (!confirm(`Delete job ${job.job_number}? This cannot be undone.`)) return
    await deleteJob(id)
    navigate('/jobs')
  }

  // ── Full Costing Sheet PDF ────────────────────────────────────────────────
  function exportPDF() {
    const doc = new jsPDF('p', 'mm', 'a4')
    const pw = 210
    let y = 15

    doc.setFillColor(...navy)
    doc.rect(0, 0, pw, 28, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(16); doc.setFont('helvetica', 'bold')
    doc.text('ZHENGHE LOGISTICS PTE LTD', 14, 12)
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text('Freight Forwarding & Logistics', 14, 19)
    doc.setFontSize(11); doc.setFont('helvetica', 'bold')
    doc.text('COSTING SHEET', pw - 14, 12, { align: 'right' })
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(job.job_number, pw - 14, 19, { align: 'right' })
    y = 36

    doc.setTextColor(0, 0, 0)
    doc.setFillColor(245, 247, 250)
    doc.roundedRect(14, y, pw - 28, 38, 2, 2, 'F')
    doc.setFontSize(8)
    const infoCol1 = [['Job No.', job.job_number], ['Customer Ref', job.customer_ref||'—'], ['Shipper', job.shipper||'—'], ['Consignee', job.consignee||'—']]
    const infoCol2 = [['Mode', job.mode||'—'], ['Agent', job.agent||'—'], ['Deadline', job.deadline_date||'—'], ['Status', job.status||'—']]
    const infoCol3 = [['Packages', job.packages??'—'], ['Weight', job.weight ? `${job.weight} kg` : '—'], ['Dimensions', job.dimensions||'—'], ['Commodity', job.commodity||'—']]
    ;[[infoCol1,16],[infoCol2,80],[infoCol3,150]].forEach(([col,cx]) => {
      col.forEach(([label, val], ri) => {
        doc.setFont('helvetica','bold'); doc.setTextColor(...navy)
        doc.text(label+':', cx, y+7+ri*8)
        doc.setFont('helvetica','normal'); doc.setTextColor(0,0,0)
        doc.text(String(val), cx+22, y+7+ri*8)
      })
    })
    y += 44

    if (job.pickup_address || job.delivery_address) {
      doc.setFontSize(8); doc.setFont('helvetica','bold'); doc.setTextColor(...blue)
      doc.text('PICKUP', 14, y); doc.setFont('helvetica','normal'); doc.setTextColor(0,0,0)
      doc.text(job.pickup_address||'—', 38, y)
      if (job.pickup_contact_name) doc.text(`PIC: ${job.pickup_contact_name} ${job.pickup_contact_number||''}`, 38, y+5)
      doc.setFont('helvetica','bold'); doc.setTextColor(...blue)
      doc.text('DELIVERY', 110, y); doc.setFont('helvetica','normal'); doc.setTextColor(0,0,0)
      doc.text(job.delivery_address||'—', 134, y)
      if (job.delivery_contact_name) doc.text(`PIC: ${job.delivery_contact_name} ${job.delivery_contact_number||''}`, 134, y+5)
      y += 14
    }

    y += 4
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...navy)
    doc.text('COST LINES', 14, y); y += 4
    autoTable(doc, {
      startY: y,
      head: [['Vendor','Service','Invoice No.','Invoice Date','Amount (SGD)','Remarks']],
      body: job.cost_lines.length ? job.cost_lines.map(l => [l.vendor,l.service,l.invoice_no,l.invoice_date||'',`$${Number(l.amount).toFixed(2)}`,l.remarks]) : [['—','','','','','']],
      foot: [['','','','Total Cost',fmt(job.cost_sgd),'']],
      headStyles: { fillColor: navy, fontSize: 8, fontStyle: 'bold' },
      footStyles: { fillColor: [245,247,250], textColor: navy, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 3 }, columnStyles: { 4: { halign: 'right' } }, margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 8
    doc.setFontSize(10); doc.setFont('helvetica','bold'); doc.setTextColor(...navy)
    doc.text('BILLING LINES', 14, y); y += 4
    autoTable(doc, {
      startY: y,
      head: [['Service','Unit','Rate (SGD)','Qty','Total (SGD)','Remarks']],
      body: job.billing_lines.length ? job.billing_lines.map(l => [l.service,l.unit,`$${Number(l.rate).toFixed(2)}`,l.qty,fmt(l.total),l.remarks]) : [['—','','','','','']],
      foot: [['','','','Total Sale',fmt(job.sale_sgd),'']],
      headStyles: { fillColor: blue, fontSize: 8, fontStyle: 'bold' },
      footStyles: { fillColor: [245,247,250], textColor: navy, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 3 }, columnStyles: { 2: { halign: 'right' }, 4: { halign: 'right' } }, margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 8
    autoTable(doc, {
      startY: y,
      body: [['Total Cost',fmt(job.cost_sgd)],['Total Sale',fmt(job.sale_sgd)],['Profit',fmt(job.profit_sgd)],['GP Margin',`${Number(job.gp_percent||0).toFixed(1)}%${job.gp_override != null ? ' (manual)' : ''}`]],
      styles: { fontSize: 9, cellPadding: 3 },
      columnStyles: { 0: { fontStyle:'bold', fillColor:[245,247,250], cellWidth: 140 }, 1: { halign:'right', fontStyle:'bold', cellWidth: 40 } },
      margin: { left: pw - 14 - 180, right: 14 },
    })
    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p); doc.setFontSize(7); doc.setTextColor(150,150,150)
      doc.text(`Generated ${new Date().toLocaleDateString('en-SG')} — Zhenghe Logistics Pte Ltd`, 14, 290)
      doc.text(`Page ${p} of ${totalPages}`, pw - 14, 290, { align: 'right' })
    }
    doc.save(`ZHL_${job.job_number.replace('/','-')}_Costing.pdf`)
  }

  // ── Accounts Reference PDF (billing + cost for accounts team) ─────────────
  function exportAccountsPDF() {
    const doc = new jsPDF('p', 'mm', 'a4')
    const pw = 210
    let y = 15

    // Header
    doc.setFillColor(...blue)
    doc.rect(0, 0, pw, 26, 'F')
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(15); doc.setFont('helvetica', 'bold')
    doc.text('ZHENGHE LOGISTICS PTE LTD', 14, 11)
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text('Freight Forwarding & Logistics | info@zhenghe.com.sg', 14, 18)
    doc.setFontSize(10); doc.setFont('helvetica', 'bold')
    doc.text('ACCOUNTS REFERENCE', pw - 14, 11, { align: 'right' })
    doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    doc.text(`Prepared: ${new Date().toLocaleDateString('en-SG')}`, pw - 14, 18, { align: 'right' })
    y = 34

    // Job summary strip
    doc.setFillColor(245, 247, 250)
    doc.roundedRect(14, y, pw - 28, 22, 2, 2, 'F')
    const stripItems = [
      ['Job No.', job.job_number],
      ['Cust. Ref', job.customer_ref || '—'],
      ['Shipper', job.shipper || '—'],
      ['Consignee', job.consignee || '—'],
      ['Mode', job.mode || '—'],
      ['Deadline', job.deadline_date || '—'],
    ]
    const colW = (pw - 28) / 3
    stripItems.forEach(([label, val], i) => {
      const col = i % 3, row = Math.floor(i / 3)
      const x = 16 + col * colW
      doc.setFontSize(7); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text(label, x, y + 6 + row * 9)
      doc.setFont('helvetica', 'normal'); doc.setTextColor(0, 0, 0)
      doc.text(String(val), x + 18, y + 6 + row * 9)
    })
    y += 28

    // BILLING section (what customer owes)
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
    doc.text('BILLING TO CUSTOMER', 14, y); y += 4
    const totalSale = job.billing_lines.reduce((s, l) => s + (l.rate||0)*(l.qty||1), 0)
    autoTable(doc, {
      startY: y,
      head: [['#', 'Service', 'Unit', 'Rate (SGD)', 'Qty', 'Total (SGD)', 'Remarks']],
      body: job.billing_lines.length
        ? job.billing_lines.map((l, i) => [i+1, l.service, l.unit, `$${Number(l.rate).toFixed(2)}`, l.qty, fmt((l.rate||0)*(l.qty||1)), l.remarks||''])
        : [['', 'No billing lines', '', '', '', '', '']],
      foot: [['', '', '', '', '', fmt(totalSale), '']],
      headStyles: { fillColor: blue, fontSize: 8, fontStyle: 'bold', textColor: [255,255,255] },
      footStyles: { fillColor: [232,241,250], textColor: navy, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: { 0:{cellWidth:8}, 3:{halign:'right'}, 5:{halign:'right', fontStyle:'bold'} },
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 10

    // COST section (what we owe vendors)
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('VENDOR COSTS', 14, y); y += 4
    const totalCost = job.cost_lines.reduce((s, l) => s + (l.amount||0), 0)
    autoTable(doc, {
      startY: y,
      head: [['#', 'Vendor', 'Service', 'Invoice No.', 'Invoice Date', 'Amount (SGD)', 'Remarks']],
      body: job.cost_lines.length
        ? job.cost_lines.map((l, i) => [i+1, l.vendor, l.service, l.invoice_no||'—', l.invoice_date||'—', fmt(l.amount), l.remarks||''])
        : [['', 'No cost lines', '', '', '', '', '']],
      foot: [['', '', '', '', '', fmt(totalCost), '']],
      headStyles: { fillColor: navy, fontSize: 8, fontStyle: 'bold', textColor: [255,255,255] },
      footStyles: { fillColor: [245,247,250], textColor: navy, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 8, cellPadding: 3 },
      columnStyles: { 0:{cellWidth:8}, 5:{halign:'right', fontStyle:'bold'} },
      margin: { left: 14, right: 14 },
    })
    y = doc.lastAutoTable.finalY + 10

    // P&L Summary box
    const profit = totalSale - totalCost
    const gp = totalSale > 0 ? (profit/totalSale)*100 : 0
    const gpDisplay = job.gp_override != null ? job.gp_override : gp
    doc.setFillColor(...navy)
    doc.roundedRect(pw - 14 - 90, y, 90, 36, 2, 2, 'F')
    doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','bold')
    const summary = [['Total Sale', fmt(totalSale)], ['Total Cost', fmt(totalCost)], ['Profit', fmt(profit)], ['GP Margin', `${gpDisplay.toFixed(1)}%`]]
    summary.forEach(([label, val], i) => {
      doc.setFont('helvetica','bold'); doc.text(label, pw - 14 - 88, y + 7 + i * 7)
      doc.setFont('helvetica','normal'); doc.text(val, pw - 16, y + 7 + i * 7, { align: 'right' })
    })

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p); doc.setFontSize(7); doc.setTextColor(150,150,150)
      doc.text(`Zhenghe Logistics Pte Ltd — Accounts Reference — ${job.job_number}`, 14, 290)
      doc.text(`Page ${p} of ${totalPages}`, pw - 14, 290, { align: 'right' })
    }
    doc.save(`ZHL_${job.job_number.replace('/','-')}_Accounts.pdf`)
  }

  // ─── RENDER ────────────────────────────────────────────────────────────────
  if (loading) return <div style={{ padding: 40, textAlign: 'center' }}><span className="spinner spinner-dark" style={{width:32,height:32}}></span></div>
  if (!job) return <div className="alert alert-error">Job not found.</div>

  const totalCost = (job.cost_lines||[]).reduce((s,l) => s+(l.amount||0), 0)
  const totalSale = (job.billing_lines||[]).reduce((s,l) => s+(l.rate||0)*(l.qty||1), 0)
  const profit = totalSale - totalCost
  const computedGP = totalSale > 0 ? (profit/totalSale)*100 : 0
  const displayGP = job.gp_override != null ? job.gp_override : computedGP
  const dlCls = deadlineClass(job.deadline_date)

  return (
    <div>
      {/* Send to Accounts Modal */}
      {sendToAccountsModal && (
        <div className="modal-overlay" onClick={() => setSendToAccountsModal(false)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Invoice Extracted</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setSendToAccountsModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ textAlign: 'center', padding: '32px 24px' }}>
              <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
              <p style={{ fontSize: 15, fontWeight: 700, color: 'var(--navy)', marginBottom: 8 }}>
                Vendor invoice extracted successfully.
              </p>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
                Cost line has been added to <strong>{job.job_number}</strong>.<br />
                Would you like to generate an accounts reference PDF?
              </p>
              <div className="flex gap-2" style={{ justifyContent: 'center' }}>
                <button className="btn btn-ghost" onClick={() => setSendToAccountsModal(false)}>
                  Dismiss
                </button>
                <button className="btn btn-navy" onClick={() => { exportAccountsPDF(); setSendToAccountsModal(false) }}>
                  📄 Download Accounts PDF
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex-between mb-4" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="flex-center gap-2">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/jobs')}>← Back</button>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--navy)', letterSpacing: '-0.5px' }}>{job.job_number}</h1>
          {job.customer_ref && (
            <span style={{ background: 'var(--blue-light)', color: 'var(--blue)', padding: '3px 10px', borderRadius: 6, fontSize: 12, fontWeight: 700 }}>
              {job.customer_ref}
            </span>
          )}
          <StatusDropdown status={job.status} onChange={changeStatus} />
        </div>
        <div className="flex gap-2">
          <button className="btn btn-ghost btn-sm" onClick={exportPDF}>↓ Costing PDF</button>
          <button className="btn btn-outline btn-sm" onClick={exportAccountsPDF}>📄 Accounts PDF</button>
          <button className="btn btn-primary btn-sm" onClick={saveInfo} disabled={saving}>
            {saving ? <><span className="spinner"></span> Saving...</> : '✓ Save Changes'}
          </button>
          <button className="btn btn-danger btn-sm" onClick={handleDelete}>Delete</button>
        </div>
      </div>

      {/* Job Info — always editable */}
      <div className="card mb-4">
        <div className="section-title">Job Information</div>
        <InfoEdit form={infoForm} setField={setInfo} />
      </div>

      {/* Cost Lines */}
      <div className="card mb-4">
        <div className="section-title">
          Cost Lines
          <div className="flex gap-2">
            <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
              {invoiceParsing ? <><span className="spinner spinner-dark"></span> Parsing...</> : '⬆ Invoice PDF → AI'}
              <input ref={invoiceRef} type="file" accept=".pdf" style={{ display: 'none' }}
                onChange={e => handleInvoiceUpload(e.target.files[0])} />
            </label>
            <button className="btn btn-outline btn-sm" onClick={addCost}>+ Add Row</button>
          </div>
        </div>
        <CostTable lines={job.cost_lines||[]} onSave={saveCost} onDelete={removeCost} />
        <div className="flex-between" style={{ paddingTop: 8, borderTop: '1px solid var(--border-solid)', marginTop: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{job.cost_lines?.length||0} line(s)</span>
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>Total Cost: {fmt(totalCost)}</span>
        </div>
      </div>

      {/* Billing Lines */}
      <div className="card mb-4">
        <div className="section-title">
          Billing Lines
          <button className="btn btn-outline btn-sm" onClick={addBilling}>+ Add Row</button>
        </div>
        <BillingTable lines={job.billing_lines||[]} onSave={saveBilling} onDelete={removeBilling} />
        <div className="flex-between" style={{ paddingTop: 8, borderTop: '1px solid var(--border-solid)', marginTop: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{job.billing_lines?.length||0} line(s)</span>
          <span style={{ fontWeight: 700, color: 'var(--navy)' }}>Total Sale: {fmt(totalSale)}</span>
        </div>
      </div>

      {/* Totals Panel with GP Override */}
      <div className="totals-panel mb-4">
        <div className="total-item">
          <div className="total-item-label">Total Cost</div>
          <div className="total-item-value">{fmt(totalCost)}</div>
        </div>
        <div className="total-item">
          <div className="total-item-label">Total Sale</div>
          <div className="total-item-value">{fmt(totalSale)}</div>
        </div>
        <div className="total-item">
          <div className="total-item-label">Profit</div>
          <div className={`total-item-value ${profit >= 0 ? 'green' : 'red'}`}>{fmt(profit)}</div>
        </div>
        <div className="total-item">
          <div className="total-item-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            GP Margin
            {job.gp_override != null && (
              <span style={{ background: 'rgba(255,200,100,0.25)', color: '#FDE68A', fontSize: 9, fontWeight: 800, padding: '1px 5px', borderRadius: 4, letterSpacing: '0.3px' }}>MANUAL</span>
            )}
          </div>
          {gpEditing ? (
            <div className="flex-center gap-2" style={{ marginTop: 6 }}>
              <input
                type="number"
                value={gpInput}
                onChange={e => setGpInput(e.target.value)}
                placeholder={computedGP.toFixed(1)}
                style={{ width: 70, padding: '4px 8px', borderRadius: 6, border: '1.5px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.12)', color: 'white', fontSize: 14, fontFamily: 'var(--font)', fontWeight: 700 }}
                autoFocus
              />
              <span style={{ color: 'white', fontWeight: 700 }}>%</span>
              <button onClick={saveGpOverride} style={{ background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white', borderRadius: 5, padding: '3px 8px', cursor: 'pointer', fontWeight: 700, fontSize: 12 }}>✓</button>
              <button onClick={() => setGpEditing(false)} style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
          ) : (
            <div className="flex-center gap-2" style={{ marginTop: 4 }}>
              <div className={`total-item-value ${displayGP >= 20 ? 'green' : displayGP >= 10 ? '' : 'red'}`} style={{ marginTop: 0 }}>
                {totalSale > 0 || job.gp_override != null ? `${displayGP.toFixed(1)}%` : '—'}
              </div>
              <button onClick={startGpEdit} title="Override GP%" style={{ background: 'rgba(255,255,255,0.12)', border: 'none', color: 'rgba(255,255,255,0.7)', borderRadius: 5, padding: '3px 7px', cursor: 'pointer', fontSize: 11 }}>✎</button>
              {job.gp_override != null && (
                <button onClick={clearGpOverride} title="Reset to calculated" style={{ background: 'transparent', border: 'none', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', fontSize: 11 }}>↺</button>
              )}
            </div>
          )}
          {job.gp_override != null && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.45)', marginTop: 3 }}>
              Calculated: {computedGP.toFixed(1)}%
            </div>
          )}
        </div>
      </div>

      {/* Documents */}
      <div className="card">
        <div className="section-title">
          Documents
          <DocUploadButton onUpload={handleDocUpload} />
        </div>
        <DocDropZone onUpload={handleDocUpload} />
        {(job.documents||[]).length > 0 && (
          <ul className="doc-list" style={{ marginTop: 12 }}>
            {job.documents.map(d => (
              <li key={d.id} className="doc-item">
                <div className="flex-center gap-2">
                  <span style={{ fontSize: 18 }}>📎</span>
                  <a href={d.file_url} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--blue)', fontWeight: 600, fontSize: 13 }}>{d.file_name}</a>
                  <span className="doc-type-badge">{d.doc_type}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.upload_date?.split('T')[0]}</span>
                </div>
                <button className="btn btn-ghost btn-xs" style={{ color: 'var(--red)' }} onClick={() => removeDoc(d.id)}>✕</button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ────────────────────────────────────────────────────────────

function StatusDropdown({ status, onChange }) {
  const map = { 'New':'new', 'In Progress':'inprogress', 'Completed':'completed', 'On Hold':'onhold' }
  return (
    <select className={`pill pill-${map[status]||'new'}`} value={status} onChange={e => onChange(e.target.value)}
      style={{ border:'none', cursor:'pointer', fontFamily:'var(--font)', fontWeight:800, fontSize:10 }}>
      {STATUSES.map(s => <option key={s}>{s}</option>)}
    </select>
  )
}

function InfoView({ job, dlCls }) {
  const row = (label, value) => (
    <div key={label}>
      <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.4px' }}>{label}</div>
      <div style={{ fontSize:13, marginTop:2, fontWeight:500 }}>{value||'—'}</div>
    </div>
  )
  return (
    <div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:14 }}>
        {row('Shipper', job.shipper)}
        {row('Consignee', job.consignee)}
        {row('Mode', job.mode)}
        {row('Agent', job.agent)}
        {row('Customer Ref', job.customer_ref)}
        {row('Status', job.status)}
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.4px' }}>Deadline</div>
          <div className={dlCls} style={{ fontSize:13, marginTop:2, fontWeight: dlCls ? 700 : 500 }}>{job.deadline_date||'—'}</div>
        </div>
        {row('Commodity', job.commodity)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:14, marginBottom:14 }}>
        {row('Packages', job.packages)}
        {row('Weight (kg)', job.weight)}
        {row('Dimensions', job.dimensions)}
        {row('CBM', job.cbm)}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
        <div className="sub-box">
          <div className="sub-box-label">Pickup</div>
          <div style={{ fontSize:13, fontWeight:500 }}>{job.pickup_address||'—'}</div>
          {job.pickup_contact_name && <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>PIC: {job.pickup_contact_name} {job.pickup_contact_number}</div>}
        </div>
        <div className="sub-box">
          <div className="sub-box-label">Delivery</div>
          <div style={{ fontSize:13, fontWeight:500 }}>{job.delivery_address||'—'}</div>
          {job.delivery_contact_name && <div style={{ fontSize:12, color:'var(--text-muted)', marginTop:2 }}>PIC: {job.delivery_contact_name} {job.delivery_contact_number}</div>}
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
        {row('Date Out', job.date_out)}
        {row('Date Delivered', job.date_delivered)}
      </div>
      {job.notes && <div style={{ marginTop:12, padding:'10px 14px', background:'var(--bg)', borderRadius:8, fontSize:13, fontWeight:500 }}>{job.notes}</div>}
    </div>
  )
}

function InfoEdit({ form, setField }) {
  const inp = (key, label, type='text', placeholder='') => (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input type={type} className="form-control" value={form[key]||''} onChange={e => setField(key, e.target.value)} placeholder={placeholder} />
    </div>
  )
  return (
    <div>
      <div className="form-grid-4 mb-4">
        {inp('shipper','Shipper')} {inp('consignee','Consignee')}
        <div className="form-group">
          <label className="form-label">Mode</label>
          <select className="form-control" value={form.mode||''} onChange={e => setField('mode',e.target.value)}>
            {MODES.map(m => <option key={m}>{m}</option>)}
          </select>
        </div>
        {inp('agent','Agent')}
        {inp('customer_ref','Customer Ref','text','e.g. KPS1137')}
        <div className="form-group">
          <label className="form-label">Status</label>
          <select className="form-control" value={form.status||''} onChange={e => setField('status',e.target.value)}>
            {STATUSES.map(s => <option key={s}>{s}</option>)}
          </select>
        </div>
        {inp('deadline_date','Deadline Date','date')}
        {inp('commodity','Commodity')}
      </div>
      <div className="form-grid-4 mb-4">
        {inp('packages','Packages','number')} {inp('weight','Weight (kg)','number')}
        {inp('dimensions','Dimensions','text','60x40x30 cm')} {inp('cbm','CBM','number')}
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
        <div className="sub-box">
          <div className="sub-box-label">Pickup</div>
          <div className="form-grid-3" style={{ gap:10 }}>
            {inp('pickup_address','Address')} {inp('pickup_contact_name','Contact Name')} {inp('pickup_contact_number','Contact Number')}
          </div>
        </div>
        <div className="sub-box">
          <div className="sub-box-label">Delivery</div>
          <div className="form-grid-3" style={{ gap:10 }}>
            {inp('delivery_address','Address')} {inp('delivery_contact_name','Contact Name')} {inp('delivery_contact_number','Contact Number')}
          </div>
        </div>
      </div>
      <div className="form-grid-2 mb-4">
        {inp('date_out','Date Out','date')} {inp('date_delivered','Date Delivered','date')}
      </div>
      <div className="form-group">
        <label className="form-label">Notes</label>
        <textarea className="form-control" rows={2} value={form.notes||''} onChange={e => setField('notes',e.target.value)} />
      </div>
    </div>
  )
}

function CostTable({ lines, onSave, onDelete }) {
  const [editing, setEditing] = useState({})
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState({})

  function startEdit(l) { setDrafts(d => ({ ...d, [l.id]: { ...l } })); setEditing(e => ({ ...e, [l.id]: true })) }
  function setDraft(id, key, val) { setDrafts(d => ({ ...d, [id]: { ...d[id], [key]: val } })) }
  async function save(id) {
    setSaving(s => ({ ...s, [id]: true }))
    await onSave(id, drafts[id])
    setEditing(e => ({ ...e, [id]: false }))
    setSaving(s => ({ ...s, [id]: false }))
  }

  if (!lines.length) return <p className="text-muted" style={{ fontSize:13, padding:'8px 0' }}>No cost lines yet. Add a row or upload an invoice PDF.</p>

  return (
    <table className="inline-table">
      <thead>
        <tr><th>Vendor</th><th>Service</th><th>Invoice No.</th><th>Invoice Date</th><th style={{width:110}}>Amount (SGD)</th><th>Remarks</th><th style={{width:80}}></th></tr>
      </thead>
      <tbody>
        {lines.map(l => {
          const isEdit = editing[l.id]; const d = drafts[l.id]||l
          return (
            <tr key={l.id} onDoubleClick={() => startEdit(l)}>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.vendor||''} onChange={e => setDraft(l.id,'vendor',e.target.value)} /> : (l.vendor||'—')}</td>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.service||''} onChange={e => setDraft(l.id,'service',e.target.value)} /> : (l.service||'—')}</td>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.invoice_no||''} onChange={e => setDraft(l.id,'invoice_no',e.target.value)} /> : (l.invoice_no||'—')}</td>
              <td>{isEdit ? <input type="date" className="form-control form-control-sm" value={d.invoice_date||''} onChange={e => setDraft(l.id,'invoice_date',e.target.value)} /> : (l.invoice_date||'—')}</td>
              <td>{isEdit ? <input type="number" className="form-control form-control-sm" value={d.amount||''} onChange={e => setDraft(l.id,'amount',parseFloat(e.target.value)||0)} /> : <strong>{fmt(l.amount)}</strong>}</td>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.remarks||''} onChange={e => setDraft(l.id,'remarks',e.target.value)} /> : (l.remarks||'')}</td>
              <td>
                <div className="flex gap-2">
                  {isEdit ? <button className="btn btn-primary btn-xs" onClick={() => save(l.id)} disabled={saving[l.id]}>{saving[l.id]?'...':'✓'}</button>
                    : <button className="btn btn-ghost btn-xs" onClick={() => startEdit(l)}>✎</button>}
                  <button className="btn btn-ghost btn-xs" style={{ color:'var(--red)' }} onClick={() => onDelete(l.id)}>✕</button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function BillingTable({ lines, onSave, onDelete }) {
  const [editing, setEditing] = useState({})
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState({})

  function startEdit(l) { setDrafts(d => ({ ...d, [l.id]: { ...l } })); setEditing(e => ({ ...e, [l.id]: true })) }
  function setDraft(id, key, val) { setDrafts(d => ({ ...d, [id]: { ...d[id], [key]: val } })) }
  async function save(id) {
    setSaving(s => ({ ...s, [id]: true }))
    await onSave(id, drafts[id])
    setEditing(e => ({ ...e, [id]: false }))
    setSaving(s => ({ ...s, [id]: false }))
  }

  if (!lines.length) return <p className="text-muted" style={{ fontSize:13, padding:'8px 0' }}>No billing lines yet. Add a row or use Email Intake to pre-populate.</p>

  return (
    <table className="inline-table">
      <thead>
        <tr><th>Service</th><th>Unit</th><th style={{width:100}}>Rate (SGD)</th><th style={{width:80}}>Qty</th><th style={{width:110}}>Total (SGD)</th><th>Remarks</th><th style={{width:80}}></th></tr>
      </thead>
      <tbody>
        {lines.map(l => {
          const isEdit = editing[l.id]; const d = drafts[l.id]||l
          const total = (parseFloat(d.rate)||0)*(parseFloat(d.qty)||1)
          return (
            <tr key={l.id} onDoubleClick={() => startEdit(l)}>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.service||''} onChange={e => setDraft(l.id,'service',e.target.value)} /> : (l.service||'—')}</td>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.unit||''} onChange={e => setDraft(l.id,'unit',e.target.value)} /> : (l.unit||'—')}</td>
              <td>{isEdit ? <input type="number" className="form-control form-control-sm" value={d.rate||''} onChange={e => setDraft(l.id,'rate',parseFloat(e.target.value)||0)} /> : fmt(l.rate)}</td>
              <td>{isEdit ? <input type="number" className="form-control form-control-sm" value={d.qty||''} onChange={e => setDraft(l.id,'qty',parseFloat(e.target.value)||1)} /> : l.qty}</td>
              <td><strong>{fmt(isEdit ? total : l.total)}</strong></td>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.remarks||''} onChange={e => setDraft(l.id,'remarks',e.target.value)} /> : (l.remarks||'')}</td>
              <td>
                <div className="flex gap-2">
                  {isEdit ? <button className="btn btn-primary btn-xs" onClick={() => save(l.id)} disabled={saving[l.id]}>{saving[l.id]?'...':'✓'}</button>
                    : <button className="btn btn-ghost btn-xs" onClick={() => startEdit(l)}>✎</button>}
                  <button className="btn btn-ghost btn-xs" style={{ color:'var(--red)' }} onClick={() => onDelete(l.id)}>✕</button>
                </div>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function DocUploadButton({ onUpload }) {
  const [docType, setDocType] = useState('CI')
  const ref = useRef()
  return (
    <div className="flex gap-2">
      <select className="form-control form-control-sm" value={docType} onChange={e => setDocType(e.target.value)} style={{ width:80 }}>
        {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
      </select>
      <label className="btn btn-outline btn-sm" style={{ cursor:'pointer' }}>
        ⬆ Upload
        <input ref={ref} type="file" style={{ display:'none' }} onChange={e => { onUpload(e.target.files[0], docType); ref.current.value='' }} />
      </label>
    </div>
  )
}

function DocDropZone({ onUpload }) {
  const [dragOver, setDragOver] = useState(false)
  const [docType, setDocType] = useState('Other')
  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) onUpload(file, docType)
  }
  return (
    <div>
      <div style={{ marginBottom:8 }}>
        <span style={{ fontSize:12, color:'var(--text-muted)', marginRight:8 }}>Drop as:</span>
        {DOC_TYPES.map(t => (
          <label key={t} style={{ marginRight:12, fontSize:12, cursor:'pointer' }}>
            <input type="radio" name="droptype" value={t} checked={docType===t} onChange={() => setDocType(t)} style={{ marginRight:4 }} />{t}
          </label>
        ))}
      </div>
      <div className={`drop-zone${dragOver?' drag-over':''}`}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
        Drag & drop CI, PL, DO, or any file here
      </div>
    </div>
  )
}
