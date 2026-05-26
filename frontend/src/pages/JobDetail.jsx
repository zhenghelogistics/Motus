import { useEffect, useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import {
  getJob, updateJob, deleteJob,
  addCostLine, updateCostLine, deleteCostLine,
  addBillingLine, updateBillingLine, deleteBillingLine,
  uploadDocument, deleteDocument, parseInvoice, getStaff, getFxRates, linkInventoryMovement, voidInventoryMovement, parsePackingList, syncStockLines
} from '../api'
import DimensionBoxes from '../components/DimensionBoxes'

const MODES = ['Air Express', 'Air Freight', 'LCL Express', 'LCL', 'Local Delivery', 'Local Clearance & Delivery', 'Sea FCL', 'Sea LCL', 'Warehousing']
const CURRENCIES = ['SGD', 'USD', 'IDR', 'EUR']
const STATUSES = ['New', 'In Progress', 'Completed', 'On Hold', 'Voided']
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

function nameFromEmail(email) {
  if (!email) return ''
  const prefix = email.split('@')[0]
  return prefix.split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(' ')
}

export default function JobDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [job, setJob] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [infoForm, setInfoForm] = useState({})
  const [invoiceParsing, setInvoiceParsing] = useState(false)
  const [sendToAccountsModal, setSendToAccountsModal] = useState(false)
  const [voidModal, setVoidModal] = useState(false)
  const [voidReason, setVoidReason] = useState('')
  const [voidLinkedInventory, setVoidLinkedInventory] = useState(true)
  const [voiding, setVoiding] = useState(false)
  const [gpEditing, setGpEditing] = useState(false)
  const [gpInput, setGpInput] = useState('')
  const [docUploading, setDocUploading] = useState(false)
  const [doModal, setDoModal] = useState(null)
  const [subCertModal, setSubCertModal] = useState(null)
  const [releaseDOModal, setReleaseDOModal] = useState(null)
  const [fxRates, setFxRates] = useState({})
  const [staffList, setStaffList] = useState([])
  const [showPdfCcyMenu, setShowPdfCcyMenu] = useState(false)
  const [createdByEdit, setCreatedByEdit] = useState(false)
  const [createdByVal, setCreatedByVal] = useState('')
  const [plParsing, setPlParsing] = useState(false)
  const [syncingLines, setSyncingLines] = useState(false)
  const invoiceRef = useRef()
  const plFileRef = useRef()
  const logoRef = useRef(null)
  const logoBlueRef = useRef(null)

  useEffect(() => {
    function loadLogo(path, ref) {
      const img = new Image()
      img.onload = () => {
        const MAX = 400
        const scale = Math.min(1, MAX / img.naturalWidth)
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.naturalWidth  * scale)
        canvas.height = Math.round(img.naturalHeight * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        ref.current = canvas.toDataURL('image/png')
      }
      img.onerror = () => {}
      img.src = path
    }
    loadLogo('/logo.png', logoRef)
    loadLogo('/logo-blue.png', logoBlueRef)
    getFxRates().then(r => setFxRates(r.data.rates)).catch(() => {})
    getStaff().then(r => setStaffList(r.data)).catch(() => {})

    function onRatesUpdated(e) { setFxRates(e.detail) }
    window.addEventListener('fxRatesUpdated', onRatesUpdated)
    return () => window.removeEventListener('fxRatesUpdated', onRatesUpdated)
  }, [])

  function loadJob() {
    return getJob(id).then(r => { setJob(r.data); setLoading(false) })
  }
  useEffect(() => { loadJob() }, [id])
  useEffect(() => {
    if (!job || job.id === infoForm.id) return
    setInfoForm({ ...job })
  }, [job?.id])

  // ── Info editing (always-on, save on button click) ────────────────────────
  async function saveInfo() {
    setSaving(true)
    try {
      const r = await updateJob(id, infoForm)
      setJob(j => ({ ...j, ...r.data }))

      let movementId = r.data.inventory_movement_id || job.inventory_movement_id

      // Auto-link to Inventory if this is a new Warehousing job without a movement
      if (r.data.mode === 'Warehousing' && !movementId) {
        try {
          const linked = await linkInventoryMovement(id)
          movementId = linked.data.inventory_movement_id
          setJob(j => ({ ...j, inventory_movement_id: movementId, inventory_movement_no: linked.data.inventory_movement_no }))
        } catch (e) {
          const msg = e?.response?.data?.error || e.message
          console.error('[Motus] Inventory link failed:', msg)
          alert(`Inventory link failed: ${msg}\n\nThe job was saved but no movement was created in Inventory.`)
        }
      }

      // Auto-sync stock lines to Hive on every save
      if (r.data.mode === 'Warehousing' && movementId && infoForm.packing_list_items?.length) {
        try {
          await syncStockLines(id)
        } catch (e) {
          console.error('[Motus] Auto-sync stock lines failed:', e?.response?.data?.error || e.message)
        }
      }
    } finally { setSaving(false) }
  }

  function setInfo(k, v) { setInfoForm(f => ({ ...f, [k]: v })) }

  // ── Packing list ─────────────────────────────────────────────────────────
  async function extractPDFTextPL(file) {
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
  }

  async function handlePLParse(file) {
    if (!file) return
    setPlParsing(true)
    try {
      let text = ''
      try { text = await extractPDFTextPL(file) } catch (_) {}
      const { data } = text.length > 50
        ? await parsePackingList(null, text)
        : await parsePackingList(file, null)
      setInfo('packing_list_items', data)
    } catch (e) {
      alert(e?.response?.data?.error || 'Packing list parsing failed.')
    } finally {
      setPlParsing(false)
      if (plFileRef.current) plFileRef.current.value = ''
    }
  }

  function updatePLItem(i, key, val) {
    const items = [...(infoForm.packing_list_items || [])]
    items[i] = { ...items[i], [key]: val }
    setInfo('packing_list_items', items)
  }

  function removePLItem(i) {
    setInfo('packing_list_items', (infoForm.packing_list_items || []).filter((_, idx) => idx !== i))
  }

  function addPLRow() {
    setInfo('packing_list_items', [...(infoForm.packing_list_items || []), { sku: '', description: '', qty_actual: '', unit: 'pcs', num_packages: '', length_cm: '', breadth_cm: '', height_cm: '' }])
  }

  async function handleSyncLines() {
    setSyncingLines(true)
    try {
      await updateJob(id, { packing_list_items: infoForm.packing_list_items })
      const r = await syncStockLines(id)
      alert(`${r.data.synced} stock line(s) synced to Hive.`)
    } catch (e) {
      alert(`Sync failed: ${e?.response?.data?.error || e.message}`)
    } finally { setSyncingLines(false) }
  }

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
  function matchesNOA(s) { const v = (s||'').toLowerCase(); return v.includes('noa') || v.includes('notice of arrival') }
  function matchesGST(s) { const v = (s||'').toLowerCase(); return v.includes('gst') || v.includes('goods and services tax') }

  async function autoMirrorToBilling(service, amount, currentBillingLines) {
    if (!service) return
    const isNOA = matchesNOA(service)
    const isGST = matchesGST(service)
    if (!isNOA && !isGST) return
    const billing = currentBillingLines || job.billing_lines || []
    const alreadyExists = billing.some(b => (isNOA && matchesNOA(b.service)) || (isGST && matchesGST(b.service)))
    if (alreadyExists) return
    const r = await addBillingLine(id, { service, rate: amount || 0, qty: 1, remarks: '' })
    setJob(j => ({ ...j, billing_lines: [...(j.billing_lines || []), r.data] }))
    refreshTotals()
  }

  async function addCost() {
    const r = await addCostLine(id, { vendor:'', amount:0, invoice_no:'', invoice_date:'', service:'', remarks:'' })
    setJob(j => ({ ...j, cost_lines: [...j.cost_lines, r.data] }))
    refreshTotals()
  }
  async function saveCost(lid, data) {
    const r = await updateCostLine(id, lid, data)
    setJob(j => ({ ...j, cost_lines: j.cost_lines.map(l => l.id === lid ? r.data : l) }))
    refreshTotals()
    await autoMirrorToBilling(data.service, data.amount)
  }
  async function removeCost(lid) {
    await deleteCostLine(id, lid)
    setJob(j => ({ ...j, cost_lines: j.cost_lines.filter(l => l.id !== lid) }))
    refreshTotals()
  }

  // ── Billing lines ─────────────────────────────────────────────────────────
  async function addBilling() {
    const r = await addBillingLine(id, { service:'', rate:0, qty:1, remarks:'' })
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
    setDocUploading(true)
    try {
      const r = await uploadDocument(id, file, docType || 'Other')
      setJob(j => ({ ...j, documents: [r.data, ...(j.documents || [])] }))
    } catch (err) {
      alert('Upload failed: ' + (err.response?.data?.error || err.message))
    } finally {
      setDocUploading(false)
    }
  }
  async function removeDoc(did) {
    if (!confirm('Delete this document?')) return
    await deleteDocument(id, did)
    setJob(j => ({ ...j, documents: j.documents.filter(d => d.id !== did) }))
  }

  async function handleVoid() {
    setVoiding(true)
    try {
      const r = await updateJob(id, { status: 'Voided', void_reason: voidReason.trim() })
      setJob(j => ({ ...j, status: 'Voided', void_reason: r.data.void_reason }))
      if (job.inventory_movement_id && voidLinkedInventory) {
        try { await voidInventoryMovement(id) } catch (e) {
          console.error('[Nexus] Inventory void failed:', e?.response?.data?.error || e.message)
        }
      }
      setVoidModal(false)
      setVoidReason('')
    } finally { setVoiding(false) }
  }

  // ── Full Costing Sheet PDF ────────────────────────────────────────────────
  function exportPDF() {
    const doc = new jsPDF('p', 'mm', 'a4')
    const pw = 210, ml = 14, mr = 14, tw = pw - ml - mr
    const lw = 30, vw = 61  // label / value col width — (lw+vw)×2 = 182

    // Header
    doc.setFillColor(...navy)
    doc.rect(0, 0, pw, 38, 'F')
    if (logoRef.current) doc.addImage(logoRef.current, 'PNG', 6, 1, 28, 36)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
    doc.text('Freight Forwarding & Logistics', 38, 15)
    doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.25)
    doc.line(38, 20, pw - mr, 20)
    doc.setDrawColor(0); doc.setLineWidth(0.1)
    doc.text('rfq@zhenghe.com.sg', 38, 28)
    doc.setFontSize(12); doc.setFont('helvetica', 'bold')
    doc.text('COSTING SHEET', pw - mr, 15, { align: 'right' })
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(job.job_number, pw - mr, 28, { align: 'right' })

    // Info table — autoTable wraps long names automatically
    const infoStyle = { fontSize: 8.5, cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 }, overflow: 'linebreak', valign: 'middle' }
    const labelCol = { fontStyle: 'bold', fillColor: [237, 242, 248], textColor: navy, cellWidth: lw }
    const valCol   = { cellWidth: vw }
    autoTable(doc, {
      startY: 43,
      body: [
        ['Job No.',     job.job_number,                       'Mode',      job.mode || '—'],
        ['Customer Ref',job.customer_ref || '—',             'Agent',     job.agent || '—'],
        ['Customer',    job.customer_name || '—',            'Status',    job.status || '—'],
        ['Shipper',     job.shipper || '—',                  'Deadline',  job.deadline_date || '—'],
        ['Consignee',   job.consignee || '—',                'Commodity', job.commodity || '—'],
        ['Packages',    job.packages != null ? String(job.packages) : '—', 'Weight', job.weight ? `${job.weight} kg` : '—'],
        ['Dimensions',  job.dimensions || '—',               'CBM',       job.cbm != null ? String(job.cbm) : '—'],
      ],
      columnStyles: { 0: labelCol, 1: valCol, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: infoStyle,
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Pickup / Delivery side-by-side
    const pu = `${job.pickup_address || '—'}${job.pickup_contact_name ? '\nPIC: ' + job.pickup_contact_name + (job.pickup_contact_number ? '   ' + job.pickup_contact_number : '') : ''}`
    const dl = `${job.delivery_address || '—'}${job.delivery_contact_name ? '\nPIC: ' + job.delivery_contact_name + (job.delivery_contact_number ? '   ' + job.delivery_contact_number : '') : ''}`
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 3,
      head: [[
        { content: 'PICKUP',   styles: { fillColor: navy, textColor: [255,255,255], fontStyle: 'bold', fontSize: 8 } },
        { content: 'DELIVERY', styles: { fillColor: navy, textColor: [255,255,255], fontStyle: 'bold', fontSize: 8 } },
      ]],
      body: [[pu, dl]],
      columnStyles: { 0: { cellWidth: 'auto', fillColor: [245,247,250] }, 1: { cellWidth: 'auto', fillColor: [245,247,250] } },
      styles: { fontSize: 8.5, cellPadding: 5, overflow: 'linebreak', valign: 'top' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Cost Lines
    let y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('COST LINES', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      head: [['Vendor', 'Service', 'Invoice No.', 'Invoice Date', 'Amount (SGD)', 'Remarks']],
      body: job.cost_lines.length
        ? job.cost_lines.map(l => [l.vendor || '—', l.service || '—', l.invoice_no || '—', l.invoice_date || '—', `$${Number(l.amount).toFixed(2)}`, l.remarks || ''])
        : [['—', '', '', '', '', '']],
      foot: [['', '', '', 'Total Cost', fmt(job.cost_sgd), '']],
      headStyles: { fillColor: [55, 88, 120], fontSize: 8, fontStyle: 'bold', textColor: [255,255,255] },
      footStyles: { fillColor: [245,247,250], textColor: navy, fontStyle: 'bold', fontSize: 8.5 },
      styles: { fontSize: 8, cellPadding: 3.5, overflow: 'linebreak' },
      columnStyles: { 4: { halign: 'right', fontStyle: 'bold', cellWidth: 28 }, 5: { cellWidth: 32 } },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Billing Lines
    y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
    doc.text('BILLING LINES', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      head: [['Service', 'Rate (SGD)', 'Qty', 'Total (SGD)', 'Remarks']],
      body: job.billing_lines.length
        ? job.billing_lines.map(l => [l.service || '—', `$${Number(l.rate).toFixed(2)}`, l.qty, fmt(l.total), l.remarks || ''])
        : [['—', '', '', '', '']],
      foot: [['', '', 'Total Sale', fmt(job.sale_sgd), '']],
      headStyles: { fillColor: blue, fontSize: 8, fontStyle: 'bold', textColor: [255,255,255] },
      footStyles: { fillColor: [232,241,250], textColor: navy, fontStyle: 'bold', fontSize: 8.5 },
      styles: { fontSize: 8, cellPadding: 3.5, overflow: 'linebreak' },
      columnStyles: { 2: { halign: 'right', cellWidth: 28 }, 4: { halign: 'right', fontStyle: 'bold', cellWidth: 28 }, 5: { cellWidth: 32 } },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // P&L Summary
    y = doc.lastAutoTable.finalY + 5
    autoTable(doc, {
      startY: y,
      body: [
        ['Total Cost',  fmt(job.cost_sgd)],
        ['Total Sale',  fmt(job.sale_sgd)],
        ['Profit',      fmt(job.profit_sgd)],
        ['GP Margin',   `${Number(job.gp_percent||0).toFixed(1)}%${job.gp_override != null ? '  (manual)' : ''}`],
      ],
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [237,242,248], textColor: navy, cellWidth: 140 },
        1: { halign: 'right', fontStyle: 'bold', cellWidth: 42 },
      },
      margin: { left: pw - mr - 182, right: mr },
      tableWidth: 182,
    })

    // Notes
    if (job.notes) {
      y = doc.lastAutoTable.finalY + 6
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('NOTES', ml, y); y += 2
      autoTable(doc, {
        startY: y,
        body: [[{ content: job.notes, styles: { fontSize: 8.5 } }]],
        styles: { overflow: 'linebreak', cellPadding: 5, fillColor: [255, 252, 230] },
        margin: { left: ml, right: mr },
        tableWidth: tw,
      })
    }

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p); doc.setFontSize(7); doc.setTextColor(150, 150, 150)
      doc.text(`Generated ${new Date().toLocaleDateString('en-SG')} — Zhenghe Logistics Pte Ltd`, ml, 290)
      doc.text(`Page ${p} of ${totalPages}`, pw - mr, 290, { align: 'right' })
    }
    doc.save(`ZHL_${job.job_number.replace('/', '-')}_Costing.pdf`)
  }

  // ── Accounts Reference PDF (billing + cost for accounts team) ─────────────
  function exportAccountsPDF(exportCcy = 'SGD') {
    // Convert a stored SGD amount to the target export currency.
    // For lines whose original currency matches the target, use rate_local directly
    // to avoid drift from rate changes between entry and export.
    function toExport(sgdAmount, origCurrency, origLocal) {
      if (exportCcy === 'SGD') return sgdAmount
      if (origCurrency === exportCcy && origLocal != null) return Number(origLocal)
      const fx = fxRates[exportCcy]
      if (!fx) return sgdAmount
      return sgdAmount * fx
    }
    function fmtCcy(n) {
      const num = Number(n || 0)
      if (exportCcy === 'SGD') return `S$${num.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      return `${exportCcy} ${num.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    }
    const rateNote = exportCcy !== 'SGD' && fxRates[exportCcy]
      ? ` (1 SGD = ${fxRates[exportCcy]} ${exportCcy})`
      : ''

    const doc = new jsPDF('p', 'mm', 'a4')
    const pw = 210, ml = 14, mr = 14, tw = pw - ml - mr
    const lw = 30, vw = 61

    // Header
    doc.setFillColor(...blue)
    doc.rect(0, 0, pw, 38, 'F')
    if (logoRef.current) doc.addImage(logoRef.current, 'PNG', 6, 1, 28, 36)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
    doc.text('Freight Forwarding & Logistics', 38, 15)
    doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.25)
    doc.line(38, 20, pw - mr, 20)
    doc.setDrawColor(0); doc.setLineWidth(0.1)
    doc.text('rfq@zhenghe.com.sg', 38, 28)
    doc.setFontSize(12); doc.setFont('helvetica', 'bold')
    doc.text('ACCOUNTS REFERENCE', pw - mr, 15, { align: 'right' })
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(`Prepared: ${new Date().toLocaleDateString('en-SG')}`, pw - mr, 28, { align: 'right' })

    // Job info
    const labelCol = { fontStyle: 'bold', fillColor: [237, 242, 248], textColor: navy, cellWidth: lw }
    const valCol   = { cellWidth: vw }
    autoTable(doc, {
      startY: 43,
      body: [
        ['Job No.',      job.job_number,          'Mode',     job.mode || '—'],
        ['Customer Ref', job.customer_ref || '—', 'Agent',    job.agent || '—'],
        ['Shipper',      job.shipper || '—',       'Deadline', job.deadline_date || '—'],
        ['Consignee',    job.consignee || '—',     'Status',   job.status || '—'],
      ],
      columnStyles: { 0: labelCol, 1: valCol, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 }, overflow: 'linebreak', valign: 'middle' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Billing party contact box — always shown so accounts can reach customer directly
    let y = doc.lastAutoTable.finalY + 5
    const billingPartyName    = job.customer_name    || job.shipper    || '—'
    const billingPartyContact = job.customer_contact_name  || '—'
    const billingPartyPhone   = job.customer_contact_number || '—'
    const billingPartyEmail   = job.customer_email   || '—'
    const bpLabel = { fontStyle: 'bold', fillColor: [4, 44, 83], textColor: [255, 255, 255], cellWidth: lw }
    const bpVal   = { fillColor: [232, 241, 250] }
    autoTable(doc, {
      startY: y,
      head: [[{ content: 'BILLING PARTY / CUSTOMER DETAILS', colSpan: 4, styles: { fillColor: navy, textColor: [255,255,255], fontStyle: 'bold', fontSize: 9, halign: 'left' } }]],
      body: [
        [{ content: 'Company',  styles: bpLabel }, { content: billingPartyName,    styles: { ...bpVal, fontStyle: 'bold', fontSize: 9 }, colSpan: 3 }],
        [{ content: 'Contact',  styles: bpLabel }, { content: billingPartyContact, styles: bpVal }, { content: 'Phone', styles: bpLabel }, { content: billingPartyPhone, styles: bpVal }],
        [{ content: 'Email',    styles: bpLabel }, { content: billingPartyEmail,   styles: bpVal, colSpan: 3 }],
      ],
      columnStyles: { 0: { cellWidth: lw }, 1: { cellWidth: vw }, 2: { cellWidth: lw }, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: { top: 4, bottom: 4, left: 5, right: 5 }, overflow: 'linebreak', valign: 'middle' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Billing lines
    y = doc.lastAutoTable.finalY + 6
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
    doc.text(`BILLING TO CUSTOMER${rateNote}`, ml, y); y += 2
    const totalSale = job.billing_lines.reduce((s, l) => s + (l.rate||0)*(l.qty||1), 0)
    const totalSaleExport = job.billing_lines.reduce((s, l) => {
      const lineRate = toExport(l.rate||0, l.currency, l.rate_local)
      return s + lineRate * (l.qty||1)
    }, 0)
    autoTable(doc, {
      startY: y,
      head: [['#', 'Service', `Rate (${exportCcy})`, 'Qty', `Total (${exportCcy})`, 'Remarks']],
      body: job.billing_lines.length
        ? job.billing_lines.map((l, i) => {
            const lineRate = toExport(l.rate||0, l.currency, l.rate_local)
            return [i+1, l.service || '—', fmtCcy(lineRate), l.qty, fmtCcy(lineRate*(l.qty||1)), l.remarks || '']
          })
        : [['', 'No billing lines', '', '', '', '']],
      foot: [['', '', '', 'Total Sale', fmtCcy(totalSaleExport), '']],
      headStyles: { fillColor: blue, fontSize: 8, fontStyle: 'bold', textColor: [255,255,255] },
      footStyles: { fillColor: [232,241,250], textColor: navy, fontStyle: 'bold', fontSize: 8.5 },
      styles: { fontSize: 8, cellPadding: 3.5, overflow: 'linebreak' },
      columnStyles: { 0:{cellWidth:8}, 2:{cellWidth:34}, 3:{halign:'right', cellWidth:16}, 4:{halign:'right', fontStyle:'bold', cellWidth:40}, 5:{cellWidth:26} },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Vendor costs
    y = doc.lastAutoTable.finalY + 6
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('VENDOR COSTS', ml, y); y += 2
    const totalCost = job.cost_lines.reduce((s, l) => s + (l.amount||0), 0)
    const totalCostPayable = job.cost_lines.reduce((s, l) => s + (l.total_payable != null ? l.total_payable : (l.amount||0)), 0)
    autoTable(doc, {
      startY: y,
      head: [['#', 'Vendor', 'Service', 'Invoice No.', 'Invoice Date', 'Amount (SGD)', 'Total Payable', 'Remarks']],
      body: job.cost_lines.length
        ? job.cost_lines.map((l, i) => [i+1, l.vendor || '—', l.service || '—', l.invoice_no || '—', l.invoice_date || '—', fmt(l.amount), l.total_payable != null ? fmt(l.total_payable) : '—', l.remarks || ''])
        : [['', 'No cost lines', '', '', '', '', '', '']],
      foot: [['', '', '', '', 'Total', fmt(totalCost), fmt(totalCostPayable), '']],
      headStyles: { fillColor: [55, 88, 120], fontSize: 8, fontStyle: 'bold', textColor: [255,255,255] },
      footStyles: { fillColor: [245,247,250], textColor: navy, fontStyle: 'bold', fontSize: 8.5 },
      styles: { fontSize: 8, cellPadding: 3.5, overflow: 'linebreak' },
      columnStyles: { 0:{cellWidth:8}, 4:{cellWidth:20}, 5:{halign:'right', cellWidth:26}, 6:{halign:'right', fontStyle:'bold', cellWidth:26} },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // P&L summary (autoTable instead of manual box)
    y = doc.lastAutoTable.finalY + 6
    const totalCostExport = job.cost_lines.reduce((s, l) => {
      return s + toExport(l.amount||0, l.currency, l.amount_local)
    }, 0)
    const profitExport = totalSaleExport - totalCostExport
    const gp = totalSale > 0 ? ((totalSale - totalCost)/totalSale)*100 : 0
    const gpDisplay = job.gp_override != null ? job.gp_override : gp
    autoTable(doc, {
      startY: y,
      body: [
        [`Total Sale (${exportCcy})`,  fmtCcy(totalSaleExport)],
        [`Total Cost (${exportCcy})`,  fmtCcy(totalCostExport)],
        [`Profit (${exportCcy})`,      fmtCcy(profitExport)],
        ['GP Margin',                  `${gpDisplay.toFixed(1)}%`],
      ],
      styles: { fontSize: 9.5, cellPadding: 5 },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: navy, textColor: [255,255,255], cellWidth: 120 },
        1: { halign: 'right', fontStyle: 'bold', fillColor: navy, textColor: [255,255,255], cellWidth: 62 },
      },
      margin: { left: pw - mr - 182, right: mr },
      tableWidth: 182,
    })

    // Notes
    if (job.notes) {
      y = doc.lastAutoTable.finalY + 6
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('NOTES', ml, y); y += 2
      autoTable(doc, {
        startY: y,
        body: [[{ content: job.notes, styles: { fontSize: 8.5 } }]],
        styles: { overflow: 'linebreak', cellPadding: 5, fillColor: [255, 252, 230] },
        margin: { left: ml, right: mr },
        tableWidth: tw,
      })
    }

    const totalPages = doc.internal.getNumberOfPages()
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p); doc.setFontSize(7); doc.setTextColor(150, 150, 150)
      doc.text(`Zhenghe Logistics Pte Ltd — Accounts Reference — ${job.job_number}`, ml, 290)
      doc.text(`Page ${p} of ${totalPages}`, pw - mr, 290, { align: 'right' })
    }
    doc.save(`ZHL_${job.job_number.replace('/', '-')}_Accounts_${exportCcy}.pdf`)
  }

  // ── Internal Job Report PDF ───────────────────────────────────────────────
  function exportJobReport() {
    const doc = new jsPDF('p', 'mm', 'a4')
    const pw = 210, ml = 14, mr = 14, tw = pw - ml - mr
    const lw = 34, vw = 57

    // Header
    doc.setFillColor(...navy)
    doc.rect(0, 0, pw, 38, 'F')
    if (logoRef.current) doc.addImage(logoRef.current, 'PNG', 6, 1, 28, 36)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
    doc.text('Freight Forwarding & Logistics', 38, 15)
    doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.25)
    doc.line(38, 20, pw - mr, 20)
    doc.setDrawColor(0); doc.setLineWidth(0.1)
    doc.text('rfq@zhenghe.com.sg', 38, 28)
    doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text('JOB REPORT', pw - mr, 15, { align: 'right' })
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(job.job_number, pw - mr, 28, { align: 'right' })

    // Job info table
    const labelCol = { fontStyle: 'bold', fillColor: [237, 242, 248], textColor: navy, cellWidth: lw }
    const valCol   = { cellWidth: vw }
    autoTable(doc, {
      startY: 43,
      body: [
        ['Job No.',      job.job_number,                                      'Mode',        job.mode || '—'],
        ['Customer Ref', job.customer_ref || '—',                             'Status',      job.status || '—'],
        ['Salesperson',  nameFromEmail(job.created_by) || '—',                'Deadline',    job.deadline_date || '—'],
        ['Shipper',      job.shipper || '—',                                  'Date Out',    job.date_out || '—'],
        ['Consignee',    job.consignee || '—',                                'Delivered',   job.date_delivered || '—'],
        ['Agent',        job.agent || '—',                                    'Commodity',   job.commodity || '—'],
        ['Customer',     job.customer_name || '—',                            'Customer Ref',job.customer_ref || '—'],
        ['Packages',     job.packages != null ? String(job.packages) : '—',  'Weight',      job.weight ? `${job.weight} kg` : '—'],
        ['Dimensions',   job.dimensions || '—',                               'CBM',         job.cbm != null ? String(job.cbm) : '—'],
      ],
      columnStyles: { 0: labelCol, 1: valCol, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: { top: 3.5, bottom: 3.5, left: 5, right: 5 }, overflow: 'linebreak', valign: 'middle' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Pickup / Delivery side-by-side
    const pu = `${job.pickup_address || '—'}${job.pickup_contact_name ? '\nPIC: ' + job.pickup_contact_name + (job.pickup_contact_number ? '   ' + job.pickup_contact_number : '') : ''}`
    const dl = `${job.delivery_address || '—'}${job.delivery_contact_name ? '\nPIC: ' + job.delivery_contact_name + (job.delivery_contact_number ? '   ' + job.delivery_contact_number : '') : ''}`
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 3,
      head: [[
        { content: 'PICKUP',   styles: { fillColor: navy, textColor: [255,255,255], fontStyle: 'bold', fontSize: 8 } },
        { content: 'DELIVERY', styles: { fillColor: navy, textColor: [255,255,255], fontStyle: 'bold', fontSize: 8 } },
      ]],
      body: [[pu, dl]],
      columnStyles: { 0: { cellWidth: 'auto', fillColor: [245,247,250] }, 1: { cellWidth: 'auto', fillColor: [245,247,250] } },
      styles: { fontSize: 8.5, cellPadding: 5, overflow: 'linebreak', valign: 'top' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Cost Lines
    let y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('COST LINES', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      head: [['#', 'Vendor', 'Service', 'Invoice No.', 'Invoice Date', 'Amount (SGD)', 'Remarks']],
      body: job.cost_lines.length
        ? job.cost_lines.map((l, i) => [i+1, l.vendor || '—', l.service || '—', l.invoice_no || '—', l.invoice_date || '—', fmt(l.amount), l.remarks || ''])
        : [['', 'No cost lines', '', '', '', '', '']],
      foot: [['', '', '', '', 'Total Cost', fmt(job.cost_sgd), '']],
      headStyles: { fillColor: [55, 88, 120], fontSize: 8, fontStyle: 'bold', textColor: [255,255,255] },
      footStyles: { fillColor: [245,247,250], textColor: navy, fontStyle: 'bold', fontSize: 8.5 },
      styles: { fontSize: 8, cellPadding: 3.5, overflow: 'linebreak' },
      columnStyles: { 0:{cellWidth:8}, 4:{cellWidth:22}, 5:{halign:'right', fontStyle:'bold', cellWidth:28} },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Billing Lines
    y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
    doc.text('BILLING LINES', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      head: [['#', 'Service', 'Rate (SGD)', 'Qty', 'Total (SGD)', 'Remarks']],
      body: job.billing_lines.length
        ? job.billing_lines.map((l, i) => [i+1, l.service || '—', `$${Number(l.rate).toFixed(2)}`, l.qty, fmt(l.total), l.remarks || ''])
        : [['', 'No billing lines', '', '', '', '']],
      foot: [['', '', '', 'Total Sale', fmt(job.sale_sgd), '']],
      headStyles: { fillColor: blue, fontSize: 8, fontStyle: 'bold', textColor: [255,255,255] },
      footStyles: { fillColor: [232,241,250], textColor: navy, fontStyle: 'bold', fontSize: 8.5 },
      styles: { fontSize: 8, cellPadding: 3.5, overflow: 'linebreak' },
      columnStyles: { 0:{cellWidth:8}, 2:{cellWidth:34}, 3:{halign:'right', cellWidth:16}, 4:{halign:'right', fontStyle:'bold', cellWidth:40}, 5:{cellWidth:26} },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // P&L Summary
    y = doc.lastAutoTable.finalY + 5
    const profit = (job.sale_sgd||0) - (job.cost_sgd||0)
    const gpDisplay = job.gp_override != null ? job.gp_override : (job.gp_percent||0)
    autoTable(doc, {
      startY: y,
      body: [
        ['Total Cost',  fmt(job.cost_sgd)],
        ['Total Sale',  fmt(job.sale_sgd)],
        ['Profit',      fmt(profit)],
        ['GP Margin',   `${Number(gpDisplay).toFixed(1)}%${job.gp_override != null ? '  (manual)' : ''}`],
      ],
      styles: { fontSize: 9, cellPadding: 4 },
      columnStyles: {
        0: { fontStyle: 'bold', fillColor: [237,242,248], textColor: navy, cellWidth: 140 },
        1: { halign: 'right', fontStyle: 'bold', cellWidth: 42 },
      },
      margin: { left: pw - mr - 182, right: mr },
      tableWidth: 182,
    })

    // Notes
    if (job.notes) {
      y = doc.lastAutoTable.finalY + 6
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('NOTES', ml, y); y += 2
      autoTable(doc, {
        startY: y,
        body: [[{ content: job.notes, styles: { fontSize: 8.5 } }]],
        styles: { overflow: 'linebreak', cellPadding: 5, fillColor: [255, 252, 230] },
        margin: { left: ml, right: mr },
        tableWidth: tw,
      })
    }

    // Prepared by footer (on last page)
    const preparedBy = nameFromEmail(job.created_by) || '—'
    const totalPages = doc.internal.getNumberOfPages()
    doc.setPage(totalPages)
    y = doc.lastAutoTable.finalY + 14
    if (y > 270) y = 270
    doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.3)
    doc.line(ml, y, ml + 60, y)
    y += 5
    doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text(`Prepared by: ${preparedBy}`, ml, y)
    doc.setFont('helvetica', 'normal'); doc.setTextColor(120, 120, 120)
    doc.text(`Date: ${new Date().toLocaleDateString('en-SG')}`, ml, y + 5)

    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p); doc.setFontSize(7); doc.setTextColor(150, 150, 150)
      doc.text(`Zhenghe Logistics Pte Ltd — Internal Job Report — ${job.job_number}`, ml, 290)
      doc.text(`Page ${p} of ${totalPages}`, pw - mr, 290, { align: 'right' })
    }
    doc.save(`ZHL_${job.job_number.replace('/', '-')}_JobReport.pdf`)
  }

  // ── Pickup Request Order PDF ──────────────────────────────────────────────
  function exportPickupOrder() {
    const doc = new jsPDF('p', 'mm', 'a4')
    const pw = 210, ml = 14, mr = 14, tw = pw - ml - mr
    const lw = 35

    doc.setFillColor(...navy)
    doc.rect(0, 0, pw, 38, 'F')
    if (logoRef.current) doc.addImage(logoRef.current, 'PNG', 6, 1, 28, 36)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
    doc.text('Freight Forwarding & Logistics', 38, 15)
    doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.25)
    doc.line(38, 20, pw - mr, 20)
    doc.setDrawColor(0); doc.setLineWidth(0.1)
    doc.text('rfq@zhenghe.com.sg', 38, 28)
    doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text('PICKUP REQUEST ORDER', pw - mr, 15, { align: 'right' })
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(`Date: ${new Date().toLocaleDateString('en-SG')}`, pw - mr, 28, { align: 'right' })

    // Job ref
    const labelCol = { fontStyle: 'bold', fillColor: [237,242,248], textColor: navy, cellWidth: lw }
    autoTable(doc, {
      startY: 43,
      body: [
        ['Job No.', job.job_number, 'Customer Ref', job.customer_ref || '—'],
        ['Mode',    job.mode || '—', 'Status',       job.status || '—'],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Pickup details
    let y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('PICKUP DETAILS', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      body: [
        ['Shipper',        { content: job.shipper || '—',               colSpan: 3 }],
        ['Pickup Address', { content: job.pickup_address || '—',        colSpan: 3 }],
        ['Contact Name',   job.pickup_contact_name || '—', 'Contact No.', job.pickup_contact_number || '—'],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Delivery details
    y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('DELIVERY DETAILS', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      body: [
        ['Consignee',        { content: job.consignee || '—',            colSpan: 3 }],
        ['Delivery Address', { content: job.delivery_address || '—',     colSpan: 3 }],
        ['Contact Name',     job.delivery_contact_name || '—', 'Contact No.', job.delivery_contact_number || '—'],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Cargo
    y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('CARGO DETAILS', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      body: [
        ['Commodity',  { content: job.commodity || '—', colSpan: 3 }],
        ['Packages', job.packages != null ? String(job.packages) : '—', 'Weight', job.weight ? `${job.weight} kg` : '—'],
        ['Dimensions', job.dimensions || '—', 'CBM', job.cbm != null ? String(job.cbm) : '—'],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    if (job.notes) {
      y = doc.lastAutoTable.finalY + 5
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('NOTES', ml, y); y += 2
      autoTable(doc, {
        startY: y,
        body: [[{ content: job.notes, styles: { fontSize: 8.5 } }]],
        styles: { overflow: 'linebreak', cellPadding: 5, fillColor: [255, 252, 230] },
        margin: { left: ml, right: mr },
        tableWidth: tw,
      })
    }

    y = Math.max(doc.lastAutoTable.finalY + 12, 228)
    doc.setDrawColor(160, 160, 160)
    doc.line(ml, y, 95, y); doc.line(115, y, pw - mr, y)
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 100, 100)
    doc.text('Driver Signature / Name', ml, y + 5)
    doc.text('Date / Time Collected', 115, y + 5)
    doc.setFontSize(7); doc.setTextColor(150, 150, 150)
    doc.text(`Zhenghe Logistics Pte Ltd — Pickup Request — ${job.job_number} — ${new Date().toLocaleDateString('en-SG')}`, ml, 290)
    doc.save(`ZHL_${job.job_number.replace('/', '-')}_PickupOrder.pdf`)
  }

  // ── Delivery Order — opens modal for editing before PDF generation ─────────
  function openDOModal() {
    const isLocal = ['Local Delivery', 'Local Clearance & Delivery'].includes(job.mode)
    setDoModal({
      type: isLocal ? 'local' : 'international',
      consignee: job.consignee || '',
      delivery_address: job.delivery_address || '',
      delivery_contact_name: job.delivery_contact_name || '',
      delivery_contact_number: job.delivery_contact_number || '',
      agent: job.agent || '',
      shipper: job.shipper || '',
      commodity: job.commodity || '',
      packages: job.packages != null ? String(job.packages) : '',
      weight: job.weight != null ? String(job.weight) : '',
      dimensions: job.dimensions || '',
      cbm: job.cbm != null ? String(job.cbm) : '',
      notes: job.notes || '',
    })
  }

  function handleDOGenerate(type, fields) {
    const d = { ...job, ...fields, packages: fields.packages ? parseInt(fields.packages) : job.packages, weight: fields.weight ? parseFloat(fields.weight) : job.weight, cbm: fields.cbm ? parseFloat(fields.cbm) : job.cbm }
    if (type === 'local' || type === 'both') exportLocalDO(d)
    if (type === 'international' || type === 'both') exportInternationalDO(d)
    setDoModal(null)
  }

  function openSubCertModal() {
    const billingTotal = (job.billing_lines||[]).reduce((s,l) => s + (l.rate||0)*(l.qty||1), 0)
    const defaultInvoiceValue = billingTotal > 0
      ? `SGD ${billingTotal.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : ''
    setSubCertModal({
      etd: '',
      permit_no: '',
      destination: '',
      invoice_value: defaultInvoiceValue,
      signatory_name: nameFromEmail(user?.email),
    })
  }

  function exportSubCert(fields) {
    const doc = new jsPDF('p', 'mm', 'a4')
    const pw = 210, ph = 297

    function ordSuffix(n) {
      if (n >= 11 && n <= 13) return 'TH'
      return ['TH','ST','ND','RD','TH','TH','TH','TH','TH','TH'][n % 10]
    }
    const now = new Date()
    const MONTHS = ['JANUARY','FEBRUARY','MARCH','APRIL','MAY','JUNE','JULY','AUGUST','SEPTEMBER','OCTOBER','NOVEMBER','DECEMBER']
    const dateStr = `${now.getDate()}${ordSuffix(now.getDate())} ${MONTHS[now.getMonth()]} ${now.getFullYear()}`

    const invoiceVal = fields.invoice_value?.trim() || '—'

    let y = 10

    // Logo + company header (centered) — blue logo on white background
    const logoSrc = logoBlueRef.current || logoRef.current
    if (logoSrc) {
      // logo-blue.png is 2217x676px — display at full usable width for clarity
      const logoW = 90, logoH = logoW * (676 / 2217)
      doc.addImage(logoSrc, 'PNG', (pw - logoW) / 2, y, logoW, logoH)
      y += logoH + 4
    } else { y += 4 }

    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(0, 0, 0)
    doc.text('ZHENGHE LOGISTICS PTE LTD', pw / 2, y, { align: 'center' }); y += 6
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
    doc.text('75 Bukit Timah Road #05-01 Boon Siew Building', pw / 2, y, { align: 'center' }); y += 4.5
    doc.text('Singapore 229833', pw / 2, y, { align: 'center' }); y += 4.5
    doc.text('Reg No: 201734570K', pw / 2, y, { align: 'center' }); y += 4.5
    doc.text('Tel: 6955 8298  Fax: 6980 2095', pw / 2, y, { align: 'center' }); y += 7

    // Divider line
    doc.setDrawColor(0); doc.setLineWidth(0.3)
    doc.line(14, y, pw - 14, y); y += 9

    // Title
    doc.setFont('courier', 'bold'); doc.setFontSize(16)
    doc.text('SUBSIDIARY EXPORT CERTIFICATE', pw / 2, y, { align: 'center' })
    const tw = doc.getTextWidth('SUBSIDIARY EXPORT CERTIFICATE')
    doc.setLineWidth(0.5)
    doc.line((pw - tw) / 2, y + 1.5, (pw + tw) / 2, y + 1.5)
    y += 8

    // OUR REF
    doc.setFont('courier', 'normal'); doc.setFontSize(10)
    doc.text(`OUR REF : ${job.job_number}`, pw / 2, y, { align: 'center' }); y += 14

    // Field layout constants
    const lx = 20      // label start x
    const cx = 66      // colon x — wide enough for "OUTWARD PERMIT NO"
    const vx = cx + 4  // value start x

    function fieldLine(label, value) {
      doc.setFont('courier', 'normal'); doc.setFontSize(10); doc.setTextColor(0, 0, 0)
      doc.text(label, lx, y)
      doc.text(': ' + (value || '—'), cx, y)
      y += 5.5
    }

    function fieldBlock(label, lines) {
      doc.setFont('courier', 'normal'); doc.setFontSize(10); doc.setTextColor(0, 0, 0)
      doc.text(label, lx, y)
      doc.text(':', cx, y)
      lines.forEach((line, i) => { if (line.trim()) { doc.text(line.trim(), vx, y + i * 5) } })
      y += Math.max(lines.filter(l => l.trim()).length, 1) * 5 + 3
    }

    // Exporter — shipper name + pickup address lines
    const exporterLines = [job.shipper || '—', ...(job.pickup_address || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean)]
    fieldBlock('EXPORTER NAME', exporterLines); y += 2

    // Consignee — consignee name + delivery address lines
    const consigneeLines = [job.consignee || '—', ...(job.delivery_address || '').split(/[\n,]/).map(s => s.trim()).filter(Boolean)]
    fieldBlock('CONSIGNEE NAME', consigneeLines); y += 2

    fieldLine('ETD SINGAPORE', fields.etd || '—')
    fieldLine('OUTWARD PERMIT NO', fields.permit_no || '—')
    fieldLine('DESTINATION', fields.destination || '—')
    y += 4

    fieldLine('PCS', job.packages ? `${job.packages} Pcs` : '—')
    fieldLine('WEIGHT', job.weight ? `${job.weight}kg` : '—')
    fieldLine('INVOICE NO', job.customer_ref || job.job_number)
    fieldLine('INVOICE VALUE', invoiceVal)
    fieldLine('DATE', dateStr)
    y += 14

    // Signatory
    const sigName = (fields.signatory_name || 'SALES MANAGEMENT').toUpperCase()
    doc.setFont('courier', 'normal'); doc.setFontSize(10); doc.setTextColor(0, 0, 0)
    doc.text(sigName, lx, y); y += 5
    doc.text('SALES MANAGEMENT', lx, y); y += 5
    doc.text('ZHENGHE LOGISTICS PTE LTD', lx, y)

    // Footer
    doc.setFont('courier', 'normal'); doc.setFontSize(8); doc.setTextColor(80, 80, 80)
    doc.text('THIS IS COMPUTER GENERATED, NO SIGNATURE REQUIRED', pw / 2, ph - 10, { align: 'center' })

    setSubCertModal(null)
    doc.save(`ZHL_${job.job_number.replace('/', '-')}_SubCert.pdf`)
  }

  function exportLocalDO(d = job) {
    const doc = new jsPDF('p', 'mm', 'a4')
    const pw = 210, ml = 14, mr = 14, tw = pw - ml - mr
    const lw = 35

    doc.setFillColor(...blue)
    doc.rect(0, 0, pw, 38, 'F')
    if (logoRef.current) doc.addImage(logoRef.current, 'PNG', 6, 1, 28, 36)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
    doc.text('Freight Forwarding & Logistics', 38, 15)
    doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.25)
    doc.line(38, 20, pw - mr, 20)
    doc.setDrawColor(0); doc.setLineWidth(0.1)
    doc.text('rfq@zhenghe.com.sg', 38, 28)
    doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text('LOCAL DELIVERY ORDER', pw - mr, 15, { align: 'right' })
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(`DO Date: ${new Date().toLocaleDateString('en-SG')}`, pw - mr, 28, { align: 'right' })

    const labelCol = { fontStyle: 'bold', fillColor: [237,242,248], textColor: navy, cellWidth: lw }
    autoTable(doc, {
      startY: 43,
      body: [
        ['Job No.',      d.job_number,   'Customer Ref', d.customer_ref || '—'],
        ['Mode',         d.mode || '—',  'Date Out',     d.date_out || '—'],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Agent details (consignee on this DO is the local agent)
    let y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
    doc.text('AGENT / CARRIER', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      body: [
        ['Agent', { content: d.agent || '—', colSpan: 3 }],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Delivery details (end recipient)
    y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
    doc.text('DELIVER TO', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      body: [
        ['Consignee',        { content: d.consignee || '—',         colSpan: 3 }],
        ['Delivery Address', { content: d.delivery_address || '—',  colSpan: 3 }],
        ['Contact Name',     d.delivery_contact_name || '—', 'Contact No.', d.delivery_contact_number || '—'],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Cargo — shipper is always Zhenghe for local DO
    y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('CARGO DESCRIPTION', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      body: [
        ['Shipper',   { content: 'Zhenghe Logistics Pte Ltd', colSpan: 3 }],
        ['Commodity', { content: d.commodity || '—', colSpan: 3 }],
        ['Packages',  d.packages != null ? String(d.packages) : '—', 'Weight', d.weight ? `${d.weight} kg` : '—'],
        ['Dimensions', d.dimensions || '—', 'CBM', d.cbm != null ? String(d.cbm) : '—'],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    if (d.notes) {
      y = doc.lastAutoTable.finalY + 5
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('NOTES', ml, y); y += 2
      autoTable(doc, {
        startY: y,
        body: [[{ content: d.notes, styles: { fontSize: 8.5 } }]],
        styles: { overflow: 'linebreak', cellPadding: 5, fillColor: [255, 252, 230] },
        margin: { left: ml, right: mr },
        tableWidth: tw,
      })
    }

    y = Math.max(doc.lastAutoTable.finalY + 10, 215)
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('ACKNOWLEDGEMENT OF RECEIPT', ml, y); y += 6
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80)
    doc.text('I/We confirm that the above cargo has been received in good condition.', ml, y); y += 12
    doc.setDrawColor(160, 160, 160)
    doc.line(ml, y, 95, y); doc.line(115, y, pw - mr, y)
    doc.setFontSize(8); doc.setTextColor(100, 100, 100)
    doc.text('Driver Signature / Name', ml, y + 5)
    doc.text('Date / Time Received', 115, y + 5)
    doc.line(ml, y + 16, 80, y + 16)
    doc.text('Company Stamp', ml, y + 21)
    doc.setFontSize(7); doc.setTextColor(150, 150, 150)
    doc.text(`Zhenghe Logistics Pte Ltd — Local Delivery Order — ${job.job_number} — ${new Date().toLocaleDateString('en-SG')}`, ml, 290)
    doc.save(`ZHL_${job.job_number.replace('/', '-')}_LocalDO.pdf`)
  }

  function openReleaseDOModal() {
    const totalPkgs = (job.packing_list_items || []).reduce((s, it) => s + (parseInt(it.num_packages) || 0), 0)
    setReleaseDOModal({
      company:     job.consignee || '',
      veh_no:      '',
      description: job.commodity || (job.packing_list_items || []).map(it => it.description).filter(Boolean).join(', ') || '',
      num_packages: totalPkgs > 0 ? String(totalPkgs) : (job.packages != null ? String(job.packages) : ''),
    })
  }

  function exportReleaseDO(fields) {
    const doc = new jsPDF('p', 'mm', 'a4')
    const pw = 210, ml = 14, mr = 14, tw = pw - ml - mr
    const navy = [4, 44, 83]
    const lw = 38

    // Header
    doc.setFillColor(...navy)
    doc.rect(0, 0, pw, 40, 'F')
    if (logoRef.current) {
      const img = logoRef.current
      const nw = typeof img === 'string' ? 400 : (img.naturalWidth || 400)
      const nh = typeof img === 'string' ? 200 : (img.naturalHeight || 200)
      const lh = (nh / nw) * 28
      doc.addImage(img, 'PNG', 6, (40 - lh) / 2, 28, lh)
    }
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(14); doc.setFont('helvetica', 'bold')
    doc.text('RELEASE DELIVERY ORDER', pw - mr, 16, { align: 'right' })
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal')
    doc.text(`Job No: ${job.job_number}`, pw - mr, 25, { align: 'right' })
    doc.text(`Date: ${new Date().toLocaleDateString('en-SG')}`, pw - mr, 31, { align: 'right' })
    doc.setFontSize(8); doc.setFont('helvetica', 'normal')
    doc.text('Zhenghe Logistics Pte Ltd', 38, 22)
    doc.text('rfq@zhenghe.com.sg  |  T: 6955 8298', 38, 29)

    const labelCol = { fontStyle: 'bold', fillColor: [237, 242, 248], textColor: navy, cellWidth: lw }

    // Collecting party
    let y = 46
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('COLLECTED BY', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      body: [
        ['Company',    { content: fields.company || '—',  colSpan: 3 }],
        ['Vehicle No.', { content: fields.veh_no || '—', colSpan: 3 }],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Cargo description
    y = doc.lastAutoTable.finalY + 6
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('CARGO RELEASED', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      body: [
        ['Description',   { content: fields.description || '—', colSpan: 3 }],
        ['No. of Packages', { content: fields.num_packages ? `${fields.num_packages} pkgs` : '—', colSpan: 3 }],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 9, cellPadding: 5, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    // Packing list breakdown (if available)
    const plItems = job.packing_list_items || []
    if (plItems.length) {
      y = doc.lastAutoTable.finalY + 6
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('ITEM BREAKDOWN', ml, y); y += 2
      autoTable(doc, {
        startY: y,
        head: [['SKU', 'Description', 'Qty', 'Pkgs']],
        body: plItems.map(it => [it.sku || '—', it.description || '—', it.qty_actual ? `${it.qty_actual} ${it.unit || ''}`.trim() : '—', it.num_packages || '—']),
        headStyles: { fillColor: navy, fontSize: 8, fontStyle: 'bold', textColor: [255, 255, 255] },
        styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
        columnStyles: { 0: { cellWidth: 28 }, 1: { cellWidth: 'auto' }, 2: { cellWidth: 22, halign: 'center' }, 3: { cellWidth: 18, halign: 'center' } },
        margin: { left: ml, right: mr },
        tableWidth: tw,
      })
    }

    // Acknowledgement
    y = Math.max(doc.lastAutoTable.finalY + 12, 210)
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('ACKNOWLEDGEMENT OF RECEIPT', ml, y); y += 6
    doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(70, 70, 70)
    doc.text('I/We confirm that the above-listed cargo has been released and collected in good order and condition.', ml, y, { maxWidth: tw }); y += 14
    doc.setDrawColor(160, 160, 160); doc.setLineWidth(0.4)
    doc.line(ml, y, 95, y)
    doc.line(115, y, pw - mr, y)
    doc.setFontSize(8); doc.setTextColor(110, 110, 110)
    doc.text("Collector's Signature / Name", ml, y + 5)
    doc.text('Date / Time', 115, y + 5)
    y += 18
    doc.line(ml, y, 80, y)
    doc.text('Company Stamp', ml, y + 5)

    doc.setFontSize(7); doc.setTextColor(160, 160, 160)
    doc.text(`Zhenghe Logistics Pte Ltd — Release D/O — ${job.job_number} — ${new Date().toLocaleDateString('en-SG')}`, ml, 290)
    doc.save(`ZHL_${job.job_number.replace('/', '-')}_ReleaseDO.pdf`)
    setReleaseDOModal(null)
  }

  function exportInternationalDO(d = job) {
    const doc = new jsPDF('p', 'mm', 'a4')
    const pw = 210, ml = 14, mr = 14, tw = pw - ml - mr
    const lw = 35

    doc.setFillColor(...blue)
    doc.rect(0, 0, pw, 38, 'F')
    if (logoRef.current) doc.addImage(logoRef.current, 'PNG', 6, 1, 28, 36)
    doc.setTextColor(255, 255, 255)
    doc.setFontSize(9.5); doc.setFont('helvetica', 'normal')
    doc.text('Freight Forwarding & Logistics', 38, 15)
    doc.setDrawColor(255, 255, 255); doc.setLineWidth(0.25)
    doc.line(38, 20, pw - mr, 20)
    doc.setDrawColor(0); doc.setLineWidth(0.1)
    doc.text('rfq@zhenghe.com.sg', 38, 28)
    doc.setFontSize(13); doc.setFont('helvetica', 'bold')
    doc.text('DELIVERY ORDER', pw - mr, 15, { align: 'right' })
    doc.setFontSize(9); doc.setFont('helvetica', 'normal')
    doc.text(`DO Date: ${new Date().toLocaleDateString('en-SG')}`, pw - mr, 28, { align: 'right' })

    const labelCol = { fontStyle: 'bold', fillColor: [237,242,248], textColor: navy, cellWidth: lw }
    autoTable(doc, {
      startY: 43,
      body: [
        ['Job No.',      d.job_number,            'Customer Ref', d.customer_ref || '—'],
        ['Mode',         d.mode || '—',           'Date Out',     d.date_out || '—'],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    let y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...blue)
    doc.text('DELIVERY DETAILS', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      body: [
        ['Consignee',        { content: d.consignee || '—',         colSpan: 3 }],
        ['Delivery Address', { content: d.delivery_address || '—',  colSpan: 3 }],
        ['Contact Name',     d.delivery_contact_name || '—', 'Contact No.', d.delivery_contact_number || '—'],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    y = doc.lastAutoTable.finalY + 5
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('CARGO DESCRIPTION', ml, y); y += 2
    autoTable(doc, {
      startY: y,
      body: [
        ['Shipper',    { content: d.shipper || '—',    colSpan: 3 }],
        ['Commodity',  { content: d.commodity || '—',  colSpan: 3 }],
        ['Packages',  d.packages != null ? String(d.packages) : '—', 'Weight', d.weight ? `${d.weight} kg` : '—'],
        ['Dimensions', d.dimensions || '—', 'CBM', d.cbm != null ? String(d.cbm) : '—'],
      ],
      columnStyles: { 0: labelCol, 1: { cellWidth: 'auto' }, 2: labelCol, 3: { cellWidth: 'auto' } },
      styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak' },
      margin: { left: ml, right: mr },
      tableWidth: tw,
    })

    if (d.notes) {
      y = doc.lastAutoTable.finalY + 5
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('NOTES', ml, y); y += 2
      autoTable(doc, {
        startY: y,
        body: [[{ content: d.notes, styles: { fontSize: 8.5 } }]],
        styles: { overflow: 'linebreak', cellPadding: 5, fillColor: [255, 252, 230] },
        margin: { left: ml, right: mr },
        tableWidth: tw,
      })
    }

    y = Math.max(doc.lastAutoTable.finalY + 10, 215)
    doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
    doc.text('ACKNOWLEDGEMENT OF RECEIPT', ml, y); y += 6
    doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80)
    doc.text('I/We confirm that the above cargo has been received in good condition.', ml, y); y += 12
    doc.setDrawColor(160, 160, 160)
    doc.line(ml, y, 95, y); doc.line(115, y, pw - mr, y)
    doc.setFontSize(8); doc.setTextColor(100, 100, 100)
    doc.text('Receiver Signature / Name', ml, y + 5)
    doc.text('Date / Time Received', 115, y + 5)
    doc.line(ml, y + 16, 80, y + 16)
    doc.text('Company Stamp', ml, y + 21)
    doc.setFontSize(7); doc.setTextColor(150, 150, 150)
    doc.text(`Zhenghe Logistics Pte Ltd — Delivery Order — ${job.job_number} — ${new Date().toLocaleDateString('en-SG')}`, ml, 290)
    doc.save(`ZHL_${job.job_number.replace('/', '-')}_DO.pdf`)
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
      {/* Delivery Order Modal */}
      {doModal && (
        <DOModal
          modal={doModal}
          onClose={() => setDoModal(null)}
          onGenerate={handleDOGenerate}
        />
      )}

      {/* Subsidiary Export Certificate Modal */}
      {subCertModal && (
        <SubCertModal
          modal={subCertModal}
          onClose={() => setSubCertModal(null)}
          onGenerate={exportSubCert}
        />
      )}

      {/* Release D/O Modal */}
      {releaseDOModal && (
        <div className="modal-overlay" onClick={() => setReleaseDOModal(null)}>
          <div className="modal" style={{ maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Release D/O</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setReleaseDOModal(null)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-group">
                <label className="form-label">Company</label>
                <input className="form-control" placeholder="Collecting company name"
                  value={releaseDOModal.company}
                  onChange={e => setReleaseDOModal(m => ({ ...m, company: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Vehicle No.</label>
                <input className="form-control" placeholder="e.g. SGX1234A" autoFocus
                  value={releaseDOModal.veh_no}
                  onChange={e => setReleaseDOModal(m => ({ ...m, veh_no: e.target.value }))} />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea className="form-control" rows={3} placeholder="Description of goods"
                  value={releaseDOModal.description}
                  onChange={e => setReleaseDOModal(m => ({ ...m, description: e.target.value }))}
                  style={{ resize: 'vertical', fontFamily: 'var(--font)' }} />
              </div>
              <div className="form-group">
                <label className="form-label">No. of Packages</label>
                <input className="form-control" type="number" min="0" placeholder="0"
                  value={releaseDOModal.num_packages}
                  onChange={e => setReleaseDOModal(m => ({ ...m, num_packages: e.target.value }))} />
              </div>
            </div>
            <div className="flex-between" style={{ padding: '12px 24px', borderTop: '1px solid var(--border-solid)' }}>
              <button className="btn btn-ghost" onClick={() => setReleaseDOModal(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={() => exportReleaseDO(releaseDOModal)}>Generate PDF</button>
            </div>
          </div>
        </div>
      )}

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

      {/* Void confirmation modal */}
      {voidModal && (
        <div className="modal-overlay" onClick={() => setVoidModal(false)}>
          <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Void {job.job_number}?</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setVoidModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ padding: '20px 24px' }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                The job number will be <strong>permanently reserved</strong> and cannot be reused or reassigned.
                The job record is kept for audit purposes.
              </p>
              {job.inventory_movement_id && (
                <div style={{ background: '#FFF7ED', border: '1px solid #FED7AA', borderRadius: 8, padding: '10px 14px', marginBottom: 16, fontSize: 13 }}>
                  <div style={{ fontWeight: 600, color: '#92400E', marginBottom: 6 }}>Linked Inventory movement #{job.inventory_movement_id}</div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', color: '#78350F' }}>
                    <input
                      type="checkbox"
                      checked={voidLinkedInventory}
                      onChange={e => setVoidLinkedInventory(e.target.checked)}
                    />
                    Also void this movement in Inventory
                  </label>
                </div>
              )}
              <div className="form-group">
                <label className="form-label">Reason for voiding <span style={{ color: 'var(--red)' }}>*</span></label>
                <textarea
                  className="form-control"
                  rows={3}
                  value={voidReason}
                  onChange={e => setVoidReason(e.target.value)}
                  placeholder="e.g. Customer cancelled, duplicate entry, pricing error..."
                  autoFocus
                />
              </div>
            </div>
            <div className="flex-between" style={{ padding: '12px 24px', borderTop: '1px solid var(--border-solid)' }}>
              <button className="btn btn-ghost" onClick={() => setVoidModal(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={handleVoid} disabled={!voidReason.trim() || voiding}>
                {voiding ? <><span className="spinner"></span> Voiding...</> : 'Confirm Void'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voided banner */}
      {job.status === 'Voided' && (
        <div style={{ background: '#FEF2F2', border: '1.5px solid #FECACA', borderRadius: 10, padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 20 }}>🚫</span>
          <div>
            <div style={{ fontWeight: 700, color: '#991B1B', fontSize: 14 }}>This job has been voided</div>
            {job.void_reason && <div style={{ fontSize: 13, color: '#7F1D1D', marginTop: 3 }}>Reason: {job.void_reason}</div>}
            <div style={{ fontSize: 12, color: '#B91C1C', marginTop: 4 }}>Job number {job.job_number} is permanently reserved and will not be reused.</div>
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
        <div className="flex gap-2" style={{ flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" onClick={exportJobReport}>📋 Job Report</button>
          <button className="btn btn-ghost btn-sm" onClick={exportPDF}>↓ Costing PDF</button>
          <button className="btn btn-ghost btn-sm" onClick={exportPickupOrder}>🚛 Pickup Order</button>
          <button className="btn btn-ghost btn-sm" onClick={openDOModal}>📦 Delivery Order</button>
          <button className="btn btn-ghost btn-sm" onClick={openReleaseDOModal}>📋 Release D/O</button>
          <button className="btn btn-ghost btn-sm" onClick={openSubCertModal}>🛃 Sub Cert</button>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', borderRadius: 6, overflow: 'visible', border: '1.5px solid var(--border-solid)' }}>
              <button className="btn btn-ghost btn-sm" style={{ borderRadius: '4px 0 0 4px', border: 'none' }} onClick={() => exportAccountsPDF('SGD')}>📄 Accounts PDF</button>
              <button className="btn btn-ghost btn-sm" style={{ borderRadius: '0 4px 4px 0', border: 'none', borderLeft: '1px solid var(--border-solid)', padding: '0 8px' }}
                onClick={() => setShowPdfCcyMenu(v => !v)}>▾</button>
            </div>
            {showPdfCcyMenu && (
              <>
                <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setShowPdfCcyMenu(false)} />
                <div style={{ position: 'absolute', top: '100%', right: 0, zIndex: 200, marginTop: 4, backgroundColor: '#ffffff', border: '1px solid var(--border-solid)', borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,0.14)', minWidth: 160 }}>
                  {['SGD', 'USD', 'EUR', 'IDR'].map(ccy => (
                    <button key={ccy} onClick={() => { exportAccountsPDF(ccy); setShowPdfCcyMenu(false) }}
                      style={{ display: 'block', width: '100%', padding: '9px 14px', background: 'none', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: 13, fontWeight: 500, fontFamily: 'var(--font)' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#F0F4FB'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >
                      📄 Export in {ccy}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="btn btn-primary btn-sm" onClick={saveInfo} disabled={saving || job.status === 'Voided'}>
            {saving ? <><span className="spinner"></span> Saving...</> : '✓ Save Changes'}
          </button>
          {job.status !== 'Voided'
            ? <button className="btn btn-danger btn-sm" onClick={() => { setVoidReason(''); setVoidLinkedInventory(true); setVoidModal(true) }}>Void Job</button>
            : <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '0 4px' }}>Voided</span>
          }
        </div>
      </div>

      {/* Job Info — always editable */}
      <div className="card mb-4">
        <div className="section-title">Job Information</div>
        <InfoEdit form={infoForm} setField={setInfo} staffList={staffList} />
      </div>

      {/* Packing List — Warehousing only */}
      {(infoForm.mode === 'Warehousing' || job.mode === 'Warehousing') && (
        <div className="card mb-4">
          <div className="section-title">
            Packing List
            <div className="flex gap-2">
              <label className="btn btn-ghost btn-sm" style={{ cursor: 'pointer' }}>
                {plParsing ? <><span className="spinner spinner-dark"></span> Parsing...</> : '⬆ Parse PDF'}
                <input ref={plFileRef} type="file" accept=".pdf" style={{ display: 'none' }}
                  onChange={e => handlePLParse(e.target.files[0])} />
              </label>
              <button className="btn btn-outline btn-sm" onClick={addPLRow}>+ Add Row</button>
            </div>
          </div>
          {!(infoForm.packing_list_items?.length) ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', padding: '8px 0' }}>
              No items yet — upload a packing list PDF or add rows manually.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-solid)', color: 'var(--text-muted)', textAlign: 'left' }}>
                    {['SKU','Description','Qty','Unit','Pkgs','L cm','B cm','H cm',''].map(h => (
                      <th key={h} style={{ padding: '4px 6px', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(infoForm.packing_list_items || []).map((item, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-solid)' }}>
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
                            onChange={e => updatePLItem(i, key, isNum ? e.target.value : e.target.value)}
                            style={{ padding: '2px 6px', fontSize: 12, width: w, textAlign: isNum ? 'right' : 'left' }}
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
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            {(infoForm.packing_list_items || []).length} item(s) — auto-synced to Hive on save
          </div>
        </div>
      )}

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
        <CostTable lines={job.cost_lines||[]} onSave={saveCost} onDelete={removeCost} fxRates={fxRates} />
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
        <BillingTable lines={job.billing_lines||[]} onSave={saveBilling} onDelete={removeBilling} fxRates={fxRates} />
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
          <div className="flex-center gap-2">
            {docUploading && <span className="spinner spinner-dark" style={{ width: 16, height: 16 }}></span>}
            <DocUploadButton onUpload={handleDocUpload} disabled={docUploading} />
          </div>
        </div>
        <DocDropZone onUpload={handleDocUpload} disabled={docUploading} />
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
  const map = { 'New':'new', 'In Progress':'inprogress', 'Completed':'completed', 'On Hold':'onhold', 'Voided':'voided' }
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
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:4 }}>Salesperson</div>
          {createdByEdit ? (
            <div style={{ display:'flex', gap:6, alignItems:'center' }}>
              <input
                className="form-control form-control-sm"
                style={{ flex:1 }}
                list="staff-datalist"
                value={createdByVal}
                onChange={e => setCreatedByVal(e.target.value)}
                placeholder="email@zhenghe.com.sg"
                autoFocus
              />
              <datalist id="staff-datalist">
                {staffList.map(email => (
                  <option key={email} value={email}>{nameFromEmail(email)}</option>
                ))}
              </datalist>
              <button className="btn btn-primary btn-xs" onClick={async () => {
                await updateJob(id, { created_by: createdByVal })
                setJob(j => ({ ...j, created_by: createdByVal }))
                setCreatedByEdit(false)
              }}>✓</button>
              <button className="btn btn-ghost btn-xs" onClick={() => setCreatedByEdit(false)}>✕</button>
            </div>
          ) : (
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:13 }}>{job.created_by ? nameFromEmail(job.created_by) : <span style={{color:'var(--text-muted)'}}>Unassigned</span>}</span>
              {job.status !== 'Voided' && (
                <button className="btn btn-ghost btn-xs" onClick={() => { setCreatedByVal(job.created_by||''); setCreatedByEdit(true) }}>✎</button>
              )}
            </div>
          )}
        </div>
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'0.4px' }}>Deadline</div>
          <div className={dlCls} style={{ fontSize:13, marginTop:2, fontWeight: dlCls ? 700 : 500 }}>{job.deadline_date||'—'}</div>
        </div>
        {row('Commodity', job.commodity)}
        {row('ZHL Invoice No.', job.zhl_invoice_no)}
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

function InfoEdit({ form, setField, staffList = [] }) {
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
        {inp('zhl_invoice_no','ZHL Invoice No.')}
        <div className="form-group">
          <label className="form-label">Salesperson</label>
          <input
            className="form-control"
            list="salesperson-datalist"
            value={form.created_by||''}
            onChange={e => setField('created_by', e.target.value)}
            placeholder="e.g. brandon.rodrigues@zhenghe.com.sg"
          />
          <datalist id="salesperson-datalist">
            {staffList.map(email => (
              <option key={email} value={email}>{nameFromEmail(email)}</option>
            ))}
          </datalist>
        </div>
      </div>

      {/* Customer (billing party) */}
      <div style={{ background:'var(--bg)', borderRadius:8, padding:14, marginBottom:14 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'var(--navy)', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:10 }}>Customer (Billing Party)</div>
        <div className="form-grid-4" style={{ gap:10 }}>
          {inp('customer_name','Customer Name','text','If different from shipper')}
          {inp('customer_email','Email','email')}
          {inp('customer_contact_name','Contact Name')}
          {inp('customer_contact_number','Contact No.')}
        </div>
      </div>

      {/* Weight / CBM */}
      <div className="form-grid-3 mb-2" style={{ maxWidth: 420 }}>
        {inp('weight','Weight (kg)','number')}
        <div className="form-group">
          <label className="form-label">CBM <span style={{ fontSize:10, color:'var(--text-muted)', fontWeight:400 }}>(auto-calc)</span></label>
          <input type="number" className="form-control" value={form.cbm||''} onChange={e => setField('cbm', e.target.value)} placeholder="Auto from dims" />
        </div>
      </div>

      {/* Per-box dimensions */}
      <div style={{ background:'var(--bg)', borderRadius:8, padding:14, marginBottom:14 }}>
        <div style={{ fontSize:12, fontWeight:700, color:'var(--navy)', textTransform:'uppercase', letterSpacing:'0.4px', marginBottom:12 }}>
          Dimensions <span style={{ fontWeight:400, fontSize:11, textTransform:'none', color:'var(--text-muted)' }}>— L × W × H (cm) per box</span>
        </div>
        <DimensionBoxes
          packages={form.packages}
          dimensions={form.dimensions}
          syncKey={form.id}
          onChange={({ packages, dimensions, cbm }) => {
            if (packages !== undefined) setField('packages', packages)
            if (dimensions !== undefined) setField('dimensions', dimensions)
            if (cbm !== null && cbm !== undefined) setField('cbm', cbm)
          }}
        />
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

      {form.mode === 'Warehousing' && (
        <div className="form-group" style={{ marginTop: 10 }}>
          <label className="form-label">Inventory Movement</label>
          {form.inventory_movement_id
            ? <div style={{ padding: '8px 12px', background: '#EFF6FF', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 13, fontWeight: 700, color: '#1D4ED8' }}>
                {form.inventory_movement_no ? `${form.inventory_movement_no}` : `#${form.inventory_movement_id}`} — linked
              </div>
            : <div style={{ padding: '8px 12px', background: 'var(--bg)', border: '1px solid var(--border-solid)', borderRadius: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                Not linked yet — save the job to create the Inventory movement
              </div>
          }
        </div>
      )}
    </div>
  )
}

function CostTable({ lines, onSave, onDelete, fxRates }) {
  const [editing, setEditing] = useState({})
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState({})

  function startEdit(l) { setDrafts(d => ({ ...d, [l.id]: { ...l, currency: l.currency||'SGD', amount_local: l.amount_local ?? l.amount, total_payable: l.total_payable ?? '' } })); setEditing(e => ({ ...e, [l.id]: true })) }
  function setDraft(id, key, val) { setDrafts(d => ({ ...d, [id]: { ...d[id], [key]: val } })) }

  function toSGD(localAmt, currency) {
    if (!currency || currency === 'SGD') return localAmt
    const rate = fxRates[currency]
    return rate ? parseFloat((localAmt / rate).toFixed(2)) : localAmt
  }

  async function save(id) {
    setSaving(s => ({ ...s, [id]: true }))
    const d = drafts[id]
    const currency = d.currency || 'SGD'
    const amount_local = parseFloat(d.amount_local) || 0
    const amount = toSGD(amount_local, currency)
    const total_payable = d.total_payable !== '' && d.total_payable != null ? parseFloat(d.total_payable) : null
    await onSave(id, { ...d, amount, amount_local, currency, total_payable })
    setEditing(e => ({ ...e, [id]: false }))
    setSaving(s => ({ ...s, [id]: false }))
  }

  if (!lines.length) return <p className="text-muted" style={{ fontSize:13, padding:'8px 0' }}>No cost lines yet. Add a row or upload an invoice PDF.</p>

  return (
    <table className="inline-table">
      <thead>
        <tr><th>Vendor</th><th>Service</th><th>Invoice No.</th><th>Invoice Date</th><th style={{width:140}}>Amount</th><th style={{width:120}}>Total Payable</th><th>Remarks</th><th style={{width:80}}></th></tr>
      </thead>
      <tbody>
        {lines.map(l => {
          const isEdit = editing[l.id]; const d = drafts[l.id]||l
          const currency = d.currency || 'SGD'
          const localAmt = parseFloat(d.amount_local) || 0
          const sgdAmt = toSGD(localAmt, currency)
          return (
            <tr key={l.id} onDoubleClick={() => startEdit(l)}>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.vendor||''} onChange={e => setDraft(l.id,'vendor',e.target.value)} /> : (l.vendor||'—')}</td>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.service||''} onChange={e => setDraft(l.id,'service',e.target.value)} /> : (l.service||'—')}</td>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.invoice_no||''} onChange={e => setDraft(l.id,'invoice_no',e.target.value)} /> : (l.invoice_no||'—')}</td>
              <td>{isEdit ? <input type="date" className="form-control form-control-sm" value={d.invoice_date||''} onChange={e => setDraft(l.id,'invoice_date',e.target.value)} /> : (l.invoice_date||'—')}</td>
              <td>
                {isEdit ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                    <div style={{ display:'flex', gap:4 }}>
                      <input type="number" className="form-control form-control-sm" style={{ flex:1, minWidth:70 }}
                        value={d.amount_local ?? d.amount ?? ''}
                        onChange={e => setDraft(l.id,'amount_local',e.target.value)} />
                      <select className="form-control form-control-sm" style={{ width:66 }} value={currency}
                        onChange={e => setDraft(l.id,'currency',e.target.value)}>
                        {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    {currency !== 'SGD' && <span style={{ fontSize:10, color:'var(--text-muted)' }}>≈ {fmt(sgdAmt)} SGD</span>}
                  </div>
                ) : (
                  <strong>
                    {(l.currency && l.currency !== 'SGD')
                      ? <>{l.currency} {Number(l.amount_local||l.amount).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2})} <span style={{fontWeight:400,fontSize:11,color:'var(--text-muted)'}}>({fmt(l.amount)})</span></>
                      : fmt(l.amount)}
                  </strong>
                )}
              </td>
              <td>
                {isEdit
                  ? <input type="number" className="form-control form-control-sm" placeholder="—"
                      value={d.total_payable ?? ''} onChange={e => setDraft(l.id,'total_payable',e.target.value)} />
                  : l.total_payable != null
                    ? <strong style={{ color:'var(--navy)' }}>{fmt(l.total_payable)}</strong>
                    : <span style={{ color:'var(--text-muted)', fontSize:12 }}>—</span>
                }
              </td>
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

function BillingTable({ lines, onSave, onDelete, fxRates }) {
  const [editing, setEditing] = useState({})
  const [drafts, setDrafts] = useState({})
  const [saving, setSaving] = useState({})

  function startEdit(l) { setDrafts(d => ({ ...d, [l.id]: { ...l, currency: l.currency||'SGD', rate_local: l.rate_local ?? l.rate } })); setEditing(e => ({ ...e, [l.id]: true })) }
  function setDraft(id, key, val) { setDrafts(d => ({ ...d, [id]: { ...d[id], [key]: val } })) }

  function toSGD(localRate, currency) {
    if (!currency || currency === 'SGD') return localRate
    const fx = fxRates[currency]
    return fx ? parseFloat((localRate / fx).toFixed(4)) : localRate
  }

  async function save(id) {
    setSaving(s => ({ ...s, [id]: true }))
    const d = drafts[id]
    const currency = d.currency || 'SGD'
    const rate_local = parseFloat(d.rate_local) || 0
    const rate = toSGD(rate_local, currency)
    await onSave(id, { ...d, rate, rate_local, currency })
    setEditing(e => ({ ...e, [id]: false }))
    setSaving(s => ({ ...s, [id]: false }))
  }

  if (!lines.length) return <p className="text-muted" style={{ fontSize:13, padding:'8px 0' }}>No billing lines yet. Add a row or use Email Intake to pre-populate.</p>

  return (
    <table className="inline-table">
      <thead>
        <tr><th>Service</th><th style={{width:150}}>Rate</th><th style={{width:80}}>Qty</th><th style={{width:110}}>Total (SGD)</th><th>Remarks</th><th style={{width:80}}></th></tr>
      </thead>
      <tbody>
        {lines.map(l => {
          const isEdit = editing[l.id]; const d = drafts[l.id]||l
          const currency = d.currency || 'SGD'
          const rate_local = parseFloat(d.rate_local) || 0
          const rate_sgd = toSGD(rate_local, currency)
          const total = rate_sgd * (parseFloat(d.qty)||1)
          return (
            <tr key={l.id} onDoubleClick={() => startEdit(l)}>
              <td>{isEdit ? <input className="form-control form-control-sm" value={d.service||''} onChange={e => setDraft(l.id,'service',e.target.value)} /> : (l.service||'—')}</td>
              <td>
                {isEdit ? (
                  <div style={{ display:'flex', flexDirection:'column', gap:3 }}>
                    <div style={{ display:'flex', gap:4 }}>
                      <input type="number" className="form-control form-control-sm" style={{ flex:1, minWidth:70 }}
                        value={d.rate_local ?? d.rate ?? ''}
                        onChange={e => setDraft(l.id,'rate_local',e.target.value)} />
                      <select className="form-control form-control-sm" style={{ width:66 }} value={currency}
                        onChange={e => setDraft(l.id,'currency',e.target.value)}>
                        {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    </div>
                    {currency !== 'SGD' && <span style={{ fontSize:10, color:'var(--text-muted)' }}>≈ {fmt(rate_sgd)} SGD each</span>}
                  </div>
                ) : (
                  (l.currency && l.currency !== 'SGD')
                    ? <>{l.currency} {Number(l.rate_local||l.rate).toLocaleString('en-SG',{minimumFractionDigits:2,maximumFractionDigits:2})} <span style={{fontSize:11,color:'var(--text-muted)'}}>({fmt(l.rate)})</span></>
                    : fmt(l.rate)
                )}
              </td>
              <td>{isEdit ? <input type="number" className="form-control form-control-sm" value={d.qty||''} onChange={e => setDraft(l.id,'qty',parseFloat(e.target.value)||1)} /> : l.qty}</td>
              <td><strong style={{ fontSize: 15 }}>{fmt(isEdit ? total : l.total)}</strong></td>
              <td>
                {isEdit
                  ? <input type="number" className="form-control form-control-sm" placeholder="Enter amount"
                      value={d.total_payable ?? ''} onChange={e => setDraft(l.id,'total_payable',e.target.value)} />
                  : l.total_payable != null
                    ? <strong style={{ color:'var(--navy)' }}>{fmt(l.total_payable)}</strong>
                    : <span style={{ color:'var(--text-muted)', fontSize:12 }}>—</span>
                }
              </td>
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

function DocUploadButton({ onUpload, disabled }) {
  const [docType, setDocType] = useState('CI')
  const ref = useRef()
  return (
    <div className="flex gap-2">
      <select className="form-control form-control-sm" value={docType} onChange={e => setDocType(e.target.value)} style={{ width:80 }} disabled={disabled}>
        {DOC_TYPES.map(t => <option key={t}>{t}</option>)}
      </select>
      <label className={`btn btn-outline btn-sm${disabled ? ' disabled' : ''}`} style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.6 : 1 }}>
        {disabled ? 'Uploading...' : '⬆ Upload'}
        <input ref={ref} type="file" style={{ display:'none' }} disabled={disabled}
          onChange={e => { if (!disabled) { onUpload(e.target.files[0], docType); ref.current.value='' } }} />
      </label>
    </div>
  )
}

function DocDropZone({ onUpload, disabled }) {
  const [dragOver, setDragOver] = useState(false)
  const [docType, setDocType] = useState('Other')
  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    if (disabled) return
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
      <div className={`drop-zone${dragOver && !disabled ? ' drag-over':''}`}
        style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : {}}
        onDragOver={e => { e.preventDefault(); if (!disabled) setDragOver(true) }}
        onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
        {disabled ? 'Uploading...' : 'Drag & drop CI, PL, DO, or any file here'}
      </div>
    </div>
  )
}

// ── Subsidiary Export Certificate Modal ──────────────────────────────────────
function SubCertModal({ modal, onClose, onGenerate }) {
  const [fields, setFields] = useState({ ...modal })
  const f = (k, v) => setFields(prev => ({ ...prev, [k]: v }))

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Subsidiary Export Certificate</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: '20px 24px' }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18, lineHeight: 1.6 }}>
            Exporter, consignee, and cargo details are pre-filled from the job.
          </p>
          <div className="form-group mb-3">
            <label className="form-label">ETD Singapore</label>
            <input
              className="form-control"
              value={fields.etd || ''}
              onChange={e => f('etd', e.target.value)}
              placeholder="e.g. 25th April 2026"
              autoFocus
            />
          </div>
          <div className="form-group mb-3">
            <label className="form-label">Outward Permit No.</label>
            <input
              className="form-control"
              value={fields.permit_no || ''}
              onChange={e => f('permit_no', e.target.value)}
              placeholder="e.g. OT6D3924490O"
            />
          </div>
          <div className="form-group mb-3">
            <label className="form-label">Destination</label>
            <input
              className="form-control"
              value={fields.destination || ''}
              onChange={e => f('destination', e.target.value)}
              placeholder="e.g. Bali"
            />
          </div>
          <div className="form-group mb-3">
            <label className="form-label">Invoice Value</label>
            <input
              className="form-control"
              value={fields.invoice_value || ''}
              onChange={e => f('invoice_value', e.target.value)}
              placeholder="e.g. USD 11,905.63"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Signatory Name</label>
            <input
              className="form-control"
              value={fields.signatory_name || ''}
              onChange={e => f('signatory_name', e.target.value)}
              placeholder="e.g. Brandon Rodrigues"
            />
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
              "Sales Management / Zhenghe Logistics Pte Ltd" is added automatically below.
            </div>
          </div>
        </div>
        <div className="flex-between" style={{ padding: '12px 24px', borderTop: '1px solid var(--border-solid)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-navy" onClick={() => onGenerate(fields)}>
            🛃 Generate Sub Cert PDF
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Delivery Order Modal ──────────────────────────────────────────────────────
function DOModal({ modal, onClose, onGenerate }) {
  const [type, setType] = useState(modal.type)
  const [fields, setFields] = useState({ ...modal })
  const f = (k, v) => setFields(prev => ({ ...prev, [k]: v }))

  const inp = (key, label, inputType = 'text') => (
    <div className="form-group">
      <label className="form-label">{label}</label>
      <input type={inputType} className="form-control" value={fields[key] || ''} onChange={e => f(key, e.target.value)} />
    </div>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Delivery Order</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ padding: '20px 24px', maxHeight: '72vh', overflowY: 'auto' }}>

          {/* DO Type */}
          <div className="form-group mb-4">
            <label className="form-label">DO Type</label>
            <div style={{ display: 'flex', gap: 24, marginTop: 4 }}>
              {[['local', 'Local DO'], ['international', 'International DO'], ['both', 'Both (generate 2 PDFs)']].map(([v, l]) => (
                <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', fontSize: 13, fontWeight: type === v ? 700 : 400, color: type === v ? 'var(--navy)' : 'var(--text-muted)' }}>
                  <input type="radio" name="do-type" value={v} checked={type === v} onChange={() => setType(v)} />
                  {l}
                </label>
              ))}
            </div>
          </div>

          <div className="form-grid-2 mb-3">
            {inp('consignee', 'Consignee')}
            {inp('agent', 'Agent / Carrier')}
          </div>
          <div className="form-group mb-3">
            <label className="form-label">Delivery Address</label>
            <input className="form-control" value={fields.delivery_address || ''} onChange={e => f('delivery_address', e.target.value)} />
          </div>
          <div className="form-grid-2 mb-3">
            {inp('delivery_contact_name', 'Contact Name')}
            {inp('delivery_contact_number', 'Contact Number')}
          </div>
          {(type === 'international' || type === 'both') && (
            <div className="form-group mb-3">
              <label className="form-label">Shipper</label>
              <input className="form-control" value={fields.shipper || ''} onChange={e => f('shipper', e.target.value)} />
            </div>
          )}
          <div className="form-group mb-3">
            <label className="form-label">Commodity</label>
            <input className="form-control" value={fields.commodity || ''} onChange={e => f('commodity', e.target.value)} />
          </div>
          <div className="form-grid-4 mb-3">
            {inp('packages', 'Packages', 'number')}
            {inp('weight', 'Weight (kg)', 'number')}
            {inp('cbm', 'CBM', 'number')}
          </div>
          <div className="form-group mb-3">
            <label className="form-label">Dimensions</label>
            <input className="form-control" value={fields.dimensions || ''} onChange={e => f('dimensions', e.target.value)} placeholder="e.g. 60x40x30 cm" />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea className="form-control" rows={2} value={fields.notes || ''} onChange={e => f('notes', e.target.value)} />
          </div>
        </div>
        <div className="flex-between" style={{ padding: '12px 24px', borderTop: '1px solid var(--border-solid)' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-navy" onClick={() => onGenerate(type, fields)}>
            📄 Generate PDF{type === 'both' ? 's' : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
