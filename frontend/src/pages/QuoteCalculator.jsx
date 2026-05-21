import { useState, useMemo, useEffect, useRef } from 'react'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { getProfile } from '../api'

const PRESET_DESCRIPTIONS = [
  'Ocean Freight', 'Air Freight', 'Origin THC', 'Destination THC',
  'Documentation Fee', 'Customs Clearance (Origin)', 'Customs Clearance (Destination)',
  'Marine Insurance', 'Fuel Surcharge (BAF)', 'Port Security Surcharge',
  'Warehouse Handling', 'Last Mile Delivery',
]

const UNIT_OPTIONS = ['CBM', 'kg', 'set', 'B/L', 'container', 'pallet', 'shipment']
const MODES = ['SEA', 'AIR', 'LAND', 'SEA + AIR']
const QUICK_ADD = [
  'Customs Clearance (Destination)', 'Marine Insurance', 'Origin THC', 'Last Mile Delivery',
]
const MARKUP_PRESETS = [5, 10, 15, 20, 25]

let _uid = 1
function makeRow(description = '') {
  return { id: _uid++, description, qty: '', unit: '', rate: '', markup: '' }
}

function calcLine(row) {
  const qty = parseFloat(row.qty)
  const rate = parseFloat(row.rate) || 0
  const base = !isNaN(qty) && qty > 0 ? qty * rate : rate
  const markup = parseFloat(row.markup)
  const total = !isNaN(markup) && markup > 0 ? base * (1 + markup / 100) : base
  return { base, total }
}

export default function QuoteCalculator() {
  const [lines, setLines] = useState([makeRow()])
  const [globalMarkup, setGlobalMarkup] = useState(15)
  const [gstActive, setGstActive] = useState(false)
  const [currency, setCurrency] = useState('SGD')
  const [route, setRoute] = useState('')
  const [mode, setMode] = useState('SEA')
  const [copiedPrice, setCopiedPrice] = useState(false)
  const [copiedQuote, setCopiedQuote] = useState(false)
  const [refId] = useState(() => `Q-${Date.now().toString(36).toUpperCase().slice(-6)}`)

  // PDF generation state
  const [showPdfModal, setShowPdfModal] = useState(false)
  const [recipient, setRecipient] = useState({ company: '', address: '', attn: '', phone: '', email: '', validUntil: '', subject: '' })
  const [profile, setProfile] = useState({ display_name: '', designation: '', signature_data: '' })
  const [generatingPdf, setGeneratingPdf] = useState(false)
  const logoRef = useRef(null)

  useEffect(() => {
    getProfile().then(r => setProfile(r.data || {})).catch(() => {})
    const img = new Image()
    img.onload = () => { logoRef.current = img }
    img.src = '/logo-cropped.png'
  }, [])

  const sym = currency === 'USD' ? 'US$' : 'S$'

  const lineTotals = useMemo(() => lines.map(calcLine), [lines])
  const subtotal   = lineTotals.reduce((s, l) => s + l.total, 0)
  const markupAmt  = subtotal * (globalMarkup / 100)
  const preGst     = subtotal + markupAmt
  const gstAmt     = gstActive ? preGst * 0.09 : 0
  const finalPrice = Math.ceil(preGst + gstAmt)
  const effectiveMargin = finalPrice > 0 ? ((finalPrice - subtotal) / finalPrice * 100) : 0

  function fmtM(n) {
    return `${sym}${Number(n).toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  function updateLine(id, field, value) {
    setLines(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l))
  }
  function addLine(description = '') { setLines(prev => [...prev, makeRow(description)]) }
  function removeLine(id) { setLines(prev => prev.filter(l => l.id !== id)) }

  function clearAll() {
    setLines([makeRow()])
    setGlobalMarkup(15)
    setGstActive(false)
    setRoute('')
    setMode('SEA')
  }

  function openPdfModal() {
    setRecipient(r => ({ ...r, subject: r.subject || (route ? `${mode} Freight Rates Quotation — ${route}` : '') }))
    setShowPdfModal(true)
  }

  function generateQuotePDF() {
    setGeneratingPdf(true)
    try {
      const navy = [4, 44, 83]
      const blue = [24, 95, 165]
      const doc = new jsPDF('p', 'mm', 'a4')
      const pw = 210, ml = 18, mr = 18, tw = pw - ml - mr

      // ── Header bar ──────────────────────────────────────────────────
      doc.setFillColor(...navy)
      doc.rect(0, 0, pw, 44, 'F')
      if (logoRef.current) doc.addImage(logoRef.current, 'PNG', 5, 4, 72, 36)
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(8); doc.setFont('helvetica', 'normal')
      doc.text('75 Bukit Timah Road, #05-01 Boon Siew Building, Singapore 229833', 82, 20)
      doc.text('T: 6955 8298   F: 6980 2095   rfq@zhenghe.com.sg   Reg No. 201734570K', 82, 28)

      // ── Ref + Date (top right) ───────────────────────────────────────
      let y = 52
      doc.setTextColor(...navy)
      doc.setFontSize(8); doc.setFont('helvetica', 'bold')
      doc.text(refId, pw - mr, y, { align: 'right' })
      doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80)
      doc.text(new Date().toLocaleDateString('en-SG', { day: 'numeric', month: 'long', year: 'numeric' }), pw - mr, y + 5, { align: 'right' })

      // ── Recipient block ──────────────────────────────────────────────
      doc.setFontSize(9); doc.setTextColor(30, 30, 30)
      const labelX = ml, valX = ml + 22
      const rows = []
      if (recipient.company) rows.push(['To', recipient.company])
      if (recipient.address) {
        const parts = recipient.address.split('\n')
        rows.push(['Address', parts[0]])
        parts.slice(1).forEach(p => rows.push(['', p]))
      }
      if (recipient.attn)  rows.push(['Attn',  recipient.attn])
      if (recipient.phone) rows.push(['Tel',   recipient.phone])
      if (recipient.email) rows.push(['Email', recipient.email])

      rows.forEach((row, i) => {
        const ry = y + i * 6
        if (row[0]) {
          doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 90)
          doc.text(row[0], labelX, ry)
          doc.setTextColor(20, 20, 20)
          doc.text(`:  ${row[1]}`, valX, ry)
        } else {
          doc.setTextColor(20, 20, 20)
          doc.text(`   ${row[1]}`, valX, ry)
        }
      })

      y += Math.max(rows.length * 6, 6) + 10

      // ── Subject ──────────────────────────────────────────────────────
      const subjectText = recipient.subject || (route ? `${mode} Freight Rates Quotation — ${route}` : 'Freight Rates Quotation')
      doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text(`Re: ${subjectText}`, ml, y, { maxWidth: tw })
      const subjectLines = doc.splitTextToSize(`Re: ${subjectText}`, tw)
      y += subjectLines.length * 5.5 + 6

      // ── Greeting + intro ─────────────────────────────────────────────
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(40, 40, 40)
      const greeting = recipient.attn ? `Dear ${recipient.attn},` : 'Dear Sir/Madam,'
      doc.text(greeting, ml, y); y += 6
      const intro = 'Thank you for giving us this opportunity to offer our services. Please find below our rates offer for your kind consideration.'
      const introLines = doc.splitTextToSize(intro, tw)
      doc.text(introLines, ml, y); y += introLines.length * 5 + 8

      // ── Charges table ────────────────────────────────────────────────
      // Show quoted rates (with per-line + global markup, excluding GST)
      const globalFactor = subtotal > 0 ? preGst / subtotal : 1
      const tableRows = lines.map((line, i) => {
        const qty = parseFloat(line.qty)
        const { total } = lineTotals[i]
        const adjustedTotal = total * globalFactor
        const unitRate = (!isNaN(qty) && qty > 0) ? adjustedTotal / qty : adjustedTotal
        const unitStr = (!isNaN(qty) && qty > 0 && line.unit) ? ` PER ${line.unit.toUpperCase()}` : ''
        const rateStr = `${sym}${unitRate.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${unitStr}`
        const qtyStr = (!isNaN(qty) && qty > 0) ? `${qty}${line.unit ? ' ' + line.unit : ''}` : '—'
        return [String(i + 1), line.description || '—', qtyStr, rateStr, recipient.validUntil || '—', '']
      })

      autoTable(doc, {
        startY: y,
        head: [['No.', 'Freight Charges', 'Qty', `Rate (${currency})`, 'Validity', 'Remarks']],
        body: tableRows,
        headStyles: { fillColor: navy, fontSize: 8, fontStyle: 'bold', textColor: [255, 255, 255] },
        styles: { fontSize: 8.5, cellPadding: 4, overflow: 'linebreak', valign: 'middle' },
        columnStyles: {
          0: { cellWidth: 14, halign: 'center' },
          1: { cellWidth: 'auto' },
          2: { cellWidth: 24, halign: 'center' },
          3: { cellWidth: 50, fontStyle: 'bold' },
          4: { cellWidth: 22, halign: 'center' },
          5: { cellWidth: 36 },
        },
        margin: { left: ml, right: mr },
        tableWidth: tw,
      })

      y = doc.lastAutoTable.finalY + 6

      // ── Total ────────────────────────────────────────────────────────
      if (gstActive && gstAmt > 0) {
        doc.setFontSize(8.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(80, 80, 80)
        doc.text(`GST (9%): ${sym}${gstAmt.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, pw - mr, y, { align: 'right' })
        y += 6
      }
      doc.setFontSize(11); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      const totalLabel = gstActive ? `Total Quoted Price (incl. GST):` : `Total Quoted Price:`
      doc.text(`${totalLabel}  ${sym}${finalPrice.toLocaleString('en-SG')}`, pw - mr, y, { align: 'right' })
      y += 10

      // ── Remarks / Standard clauses ───────────────────────────────────
      const clauses = [
        'Quoted rates are subject to space and equipment availability at the time of booking.',
        'Rates exclude local charges at Port of Loading (POL) and Port of Discharge (POD), which will be billed separately.',
        'Cargo acceptance is subject to the carrier\'s discretion and approval.',
        'A free demurrage period of 7 days is granted at the Singapore transshipment port; extension charges apply thereafter.',
        'Zhenghe Logistics Pte Ltd shall not be held responsible for any customs clearance issues encountered at the Port of Discharge.',
        'All charges are subject to final rate and space confirmation at the time of booking.',
      ]

      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('Remarks:', ml, y); y += 6
      doc.setFont('helvetica', 'normal'); doc.setTextColor(55, 55, 55)
      clauses.forEach(c => {
        const wrapped = doc.splitTextToSize(`• ${c}`, tw - 4)
        doc.text(wrapped, ml + 2, y)
        y += wrapped.length * 5 + 1.5
      })
      y += 6

      // ── Closing ──────────────────────────────────────────────────────
      // Add new page if not enough space for closing + signature
      if (y > 230) { doc.addPage(); y = 20 }

      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50)
      const closing = 'We hope the above rates quoted will meet your requirements. Should you need any further assistance or clarification, please feel free to contact us.'
      const closingLines = doc.splitTextToSize(closing, tw)
      doc.text(closingLines, ml, y); y += closingLines.length * 5 + 6
      doc.text('Thank you!', ml, y); y += 10

      // ── Signature block (two-column: ZHL left, customer ack right) ──
      const sigY = y
      const rX = 112   // right column start x
      const rW = pw - mr - rX  // right column width (~80mm)
      const labelW = 26  // label area within right column

      // LEFT: our side heading
      doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(60, 60, 60)
      doc.text('Yours sincerely,', ml, sigY)

      // RIGHT: heading
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('Acknowledged & Agreed:', rX, sigY)

      // LEFT: name, designation, company
      let lY = sigY + 8
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text(profile.display_name || '___________________', ml, lY); lY += 5
      if (profile.designation) {
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(70, 70, 70)
        doc.text(profile.designation, ml, lY); lY += 5
      }
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('Zhenghe Logistics Pte Ltd', ml, lY); lY += 10

      // LEFT: signature image or line
      if (profile.signature_data) {
        doc.addImage(profile.signature_data, 'PNG', ml, lY, 55, 22)
      } else {
        doc.setDrawColor(180, 180, 180); doc.setLineWidth(0.3)
        doc.line(ml, lY + 16, ml + 62, lY + 16)
      }

      // RIGHT: customer fill-in fields
      const fields = ['Name', 'Company', 'Contact No.', 'Email']
      let rY = sigY + 10
      doc.setLineWidth(0.3); doc.setDrawColor(180, 180, 180)
      fields.forEach(label => {
        doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 90, 90)
        doc.text(`${label}:`, rX, rY)
        doc.line(rX + labelW, rY + 1, rX + rW, rY + 1)
        rY += 9
      })

      // RIGHT: signature space + line
      rY += 10
      doc.line(rX, rY, rX + rW, rY)
      doc.setFontSize(7.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(120, 120, 120)
      doc.text('Signature & Date', rX, rY + 4)

      y = Math.max(lY + 24, rY + 8)

      // ── Footer ───────────────────────────────────────────────────────
      const pageCount = doc.internal.getNumberOfPages()
      for (let p = 1; p <= pageCount; p++) {
        doc.setPage(p); doc.setFontSize(7); doc.setTextColor(160, 160, 160)
        doc.text('Zhenghe Logistics Pte Ltd  |  75 Bukit Timah Road, #05-01 Boon Siew Building, Singapore 229833  |  T: 6955 8298  |  rfq@zhenghe.com.sg', pw / 2, 290, { align: 'center' })
      }

      // ── File name: CompanyName_DDMmmYYYY_Quotation.pdf ───────────────
      const companySlug = (recipient.company || 'Quote').replace(/[^a-zA-Z0-9]/g, '')
      const dateStr = new Date().toLocaleDateString('en-SG', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '')
      doc.save(`${companySlug}_${dateStr}_Quotation.pdf`)

      setShowPdfModal(false)
    } catch (e) {
      alert('PDF generation failed: ' + e.message)
    } finally {
      setGeneratingPdf(false)
    }
  }

  function copyPrice() {
    navigator.clipboard?.writeText(String(finalPrice))
    setCopiedPrice(true)
    setTimeout(() => setCopiedPrice(false), 2000)
  }

  function buildQuoteText() {
    const W = 58
    const sep = '─'.repeat(W)
    const padRow = (left, right) => {
      const gap = W - left.length - right.length
      return `  ${left}${gap > 0 ? ' '.repeat(gap) : '  '}${right}`
    }
    let out = `FREIGHT QUOTATION — ${refId}\n`
    if (route) out += `Route: ${route}\n`
    out += `Mode:  ${mode}\n\n`
    out += `BREAKDOWN\n${sep}\n`
    lines.forEach(l => {
      const qty = parseFloat(l.qty)
      const rate = parseFloat(l.rate) || 0
      const { total } = calcLine(l)
      const desc = l.description || '(item)'
      const detail = !isNaN(qty) && qty > 0
        ? `${desc} (${qty} ${l.unit || 'unit'} × ${sym}${rate.toFixed(2)})`
        : desc
      out += padRow(detail, fmtM(total)) + '\n'
    })
    out += sep + '\n'
    if (gstActive && gstAmt > 0) {
      out += padRow('GST (9%):', fmtM(gstAmt)) + '\n'
    }
    out += padRow('Total Quoted Price', fmtM(finalPrice)) + '\n'
    out += `\nAll charges subject to space and rate confirmation.`
    return out
  }

  function copyQuote() {
    navigator.clipboard?.writeText(buildQuoteText())
    setCopiedQuote(true)
    setTimeout(() => setCopiedQuote(false), 2500)
  }

  const segBtn = (active, onClick, label) => (
    <button key={label} onClick={onClick} style={{
      padding: '7px 15px', borderRadius: 8,
      border: `1.5px solid ${active ? 'var(--navy)' : 'var(--border-solid)'}`,
      background: active ? 'var(--navy)' : 'transparent',
      color: active ? '#fff' : 'var(--text)',
      fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)',
      transition: 'all 0.15s',
    }}>{label}</button>
  )

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1200 }}>

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex-between" style={{ marginBottom: 20 }}>
        <div className="page-header" style={{ marginBottom: 0 }}>
          <h1>Quote Calculator</h1>
          <p>Build freight cost breakdowns and generate client-ready quotes</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Currency toggle */}
          <div style={{ display: 'flex', border: '1.5px solid var(--border-solid)', borderRadius: 8, overflow: 'hidden' }}>
            {['SGD', 'USD'].map(c => (
              <button key={c} onClick={() => setCurrency(c)} style={{
                padding: '7px 16px', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700,
                background: currency === c ? 'var(--navy)' : 'var(--surface)',
                color: currency === c ? '#fff' : 'var(--text)',
                fontFamily: 'var(--font)', transition: 'all 0.15s',
              }}>{c}</button>
            ))}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={clearAll}>Clear All</button>
        </div>
      </div>

      {/* ── Shipment details ────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 14, padding: '14px 18px' }}>
        <div style={{ display: 'flex', gap: 14, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px', minWidth: 160 }}>
            <label className="form-label">Route</label>
            <input
              className="form-control"
              placeholder="e.g. China → Singapore"
              value={route}
              onChange={e => setRoute(e.target.value)}
            />
          </div>
          <div>
            <label className="form-label">Mode of Transport</label>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {MODES.map(m => segBtn(mode === m, () => setMode(m), m))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Main layout ─────────────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 290px', gap: 14, alignItems: 'start' }}>

        {/* ── Left: line items + settings ─────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Line items card */}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{
              padding: '12px 16px',
              borderBottom: '1px solid var(--border-solid)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--heading)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                Line Items
              </span>
              <button className="btn btn-primary btn-sm" onClick={() => addLine()}>+ Add Row</button>
            </div>

            <div style={{ overflowX: 'auto' }}>
              <table className="inline-table" style={{ minWidth: 680 }}>
                <thead>
                  <tr>
                    <th style={{ width: 32, textAlign: 'center' }}>#</th>
                    <th>Description</th>
                    <th style={{ width: 72 }}>Qty</th>
                    <th style={{ width: 96 }}>Unit</th>
                    <th style={{ width: 120 }}>Rate ({sym})</th>
                    <th style={{ width: 82 }}>Markup %</th>
                    <th style={{ width: 118, textAlign: 'right' }}>Line Total</th>
                    <th style={{ width: 34 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => {
                    const { total } = calcLine(line)
                    return (
                      <tr key={line.id}>
                        <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: 11 }}>{i + 1}</td>
                        <td>
                          <input
                            className="form-control form-control-sm"
                            list="desc-opts"
                            placeholder="Description"
                            value={line.description}
                            onChange={e => updateLine(line.id, 'description', e.target.value)}
                            style={{ minWidth: 170 }}
                          />
                        </td>
                        <td>
                          <input
                            className="form-control form-control-sm"
                            type="number" min="0" step="any" placeholder="—"
                            value={line.qty}
                            onChange={e => updateLine(line.id, 'qty', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="form-control form-control-sm"
                            list="unit-opts"
                            placeholder="unit"
                            value={line.unit}
                            onChange={e => updateLine(line.id, 'unit', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="form-control form-control-sm"
                            type="number" min="0" step="any" placeholder="0.00"
                            value={line.rate}
                            onChange={e => updateLine(line.id, 'rate', e.target.value)}
                          />
                        </td>
                        <td>
                          <input
                            className="form-control form-control-sm"
                            type="number" min="0" max="100" step="any" placeholder="—"
                            value={line.markup}
                            onChange={e => updateLine(line.id, 'markup', e.target.value)}
                          />
                        </td>
                        <td style={{ textAlign: 'right', fontWeight: 700, fontSize: 13, paddingRight: 10 }}>
                          {total > 0
                            ? <span style={{ color: 'var(--heading)' }}>{fmtM(total)}</span>
                            : <span style={{ color: 'var(--text-muted)' }}>—</span>
                          }
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <button
                            onClick={() => removeLine(line.id)}
                            disabled={lines.length === 1}
                            style={{
                              background: 'none', border: 'none', padding: '3px 6px',
                              cursor: lines.length === 1 ? 'not-allowed' : 'pointer',
                              color: 'var(--red)', opacity: lines.length === 1 ? 0.2 : 0.6,
                              fontSize: 14, transition: 'opacity 0.15s',
                              fontFamily: 'var(--font)',
                            }}
                            onMouseEnter={e => { if (lines.length > 1) e.currentTarget.style.opacity = '1' }}
                            onMouseLeave={e => { if (lines.length > 1) e.currentTarget.style.opacity = '0.6' }}
                          >✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Quick add row */}
            <div style={{
              padding: '9px 14px',
              borderTop: '1px solid var(--border-solid)',
              display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
              background: 'var(--sub-box-bg)',
            }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', marginRight: 2 }}>
                Quick add:
              </span>
              {QUICK_ADD.map(desc => (
                <button key={desc} className="btn btn-ghost btn-xs" onClick={() => addLine(desc)}>
                  {desc}
                </button>
              ))}
            </div>
          </div>

          {/* Global markup + GST */}
          <div className="card" style={{ padding: '14px 18px' }}>
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div>
                <label className="form-label">Global Markup %</label>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    className="form-control"
                    type="number" min="0" max="200" step="any"
                    value={globalMarkup}
                    onChange={e => setGlobalMarkup(parseFloat(e.target.value) || 0)}
                    style={{ width: 76 }}
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    {MARKUP_PRESETS.map(p => (
                      <button key={p} className="btn btn-ghost btn-xs" onClick={() => setGlobalMarkup(p)} style={{
                        background: globalMarkup === p ? 'var(--blue-light)' : undefined,
                        color: globalMarkup === p ? 'var(--link)' : undefined,
                        border: globalMarkup === p ? '1px solid rgba(24,95,165,0.3)' : undefined,
                      }}>{p}%</button>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <label className="form-label">Tax</label>
                <button
                  onClick={() => setGstActive(g => !g)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', gap: 8,
                    padding: '7px 16px', borderRadius: 8,
                    border: `1.5px solid ${gstActive ? 'var(--green)' : 'var(--border-solid)'}`,
                    background: gstActive ? 'var(--green-light)' : 'transparent',
                    color: gstActive ? 'var(--green)' : 'var(--text-muted)',
                    fontSize: 13, fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font)',
                    transition: 'all 0.15s',
                  }}
                >
                  {gstActive ? '✓' : '+'} GST 9%
                  {gstActive && gstAmt > 0 && (
                    <span style={{ fontWeight: 500, fontSize: 12, opacity: 0.85 }}>({fmtM(gstAmt)})</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Right: Final price card ──────────────────────────────────── */}
        <div>
          <div className="totals-panel" style={{ gridTemplateColumns: '1fr', padding: '22px 24px', gap: 0 }}>
            {/* Decorative glow */}
            <div style={{
              position: 'absolute', bottom: -30, left: -30,
              width: 120, height: 120,
              background: 'rgba(24,95,165,0.15)', borderRadius: '50%', pointerEvents: 'none',
            }} />

            <div className="total-item-label" style={{ marginBottom: 10 }}>Final Quoted Price</div>
            <div style={{
              fontSize: 40, fontWeight: 900, color: 'white', letterSpacing: '-1.5px',
              lineHeight: 1, marginBottom: 16,
            }}>
              <span style={{ fontSize: 18, fontWeight: 700, opacity: 0.7, verticalAlign: 'top', marginTop: 6, display: 'inline-block', marginRight: 2 }}>
                {sym}
              </span>
              {finalPrice > 0 ? finalPrice.toLocaleString('en-SG') : '—'}
            </div>

            {subtotal > 0 && (
              <>
                <div style={{ height: 1, background: 'rgba(255,255,255,0.12)', margin: '0 0 12px' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14, fontSize: 12 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,0.6)' }}>
                    <span>Subtotal</span><span>{fmtM(subtotal)}</span>
                  </div>
                  {globalMarkup > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,0.6)' }}>
                      <span>Markup ({globalMarkup}%)</span><span>{fmtM(markupAmt)}</span>
                    </div>
                  )}
                  {gstActive && gstAmt > 0 && (
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: 'rgba(255,255,255,0.6)' }}>
                      <span>GST (9%)</span><span>{fmtM(gstAmt)}</span>
                    </div>
                  )}
                  <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '2px 0' }} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#4ADE80', fontWeight: 700, fontSize: 13 }}>
                    <span>Eff. margin</span><span>{effectiveMargin.toFixed(1)}%</span>
                  </div>
                </div>
              </>
            )}

            <button
              className="btn"
              onClick={copyPrice}
              style={{
                width: '100%', justifyContent: 'center', fontFamily: 'var(--font)',
                background: copiedPrice ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.12)',
                color: copiedPrice ? '#4ADE80' : 'white',
                border: `1px solid ${copiedPrice ? 'rgba(74,222,128,0.4)' : 'rgba(255,255,255,0.2)'}`,
                transition: 'all 0.2s',
              }}
            >
              {copiedPrice ? '✓ Copied!' : 'Copy Price'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Datalists ──────────────────────────────────────────────────── */}
      <datalist id="desc-opts">
        {PRESET_DESCRIPTIONS.map(d => <option key={d} value={d} />)}
      </datalist>
      <datalist id="unit-opts">
        {UNIT_OPTIONS.map(u => <option key={u} value={u} />)}
      </datalist>

      {/* ── Quote Preview ───────────────────────────────────────────────── */}
      {subtotal > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--heading)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>
              Client Quote Preview
            </span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-outline btn-sm" onClick={copyQuote}>
                {copiedQuote ? '✓ Copied!' : 'Copy Quote'}
              </button>
              <button className="btn btn-primary btn-sm" onClick={openPdfModal}>
                Generate Quotation PDF
              </button>
            </div>
          </div>
          <pre style={{
            fontFamily: 'ui-monospace, "SF Mono", "Courier New", monospace',
            fontSize: 12.5,
            background: 'var(--sub-box-bg)',
            border: '1px solid var(--sub-box-border)',
            borderRadius: 8,
            padding: '16px 18px',
            whiteSpace: 'pre',
            overflowX: 'auto',
            color: 'var(--text)',
            lineHeight: 1.75,
            margin: 0,
          }}>
            {buildQuoteText()}
          </pre>
        </div>
      )}

      {/* ── Recipient Details Modal ──────────────────────────────────────── */}
      {showPdfModal && (
        <div className="modal-overlay" onClick={() => setShowPdfModal(false)}>
          <div className="modal" style={{ maxWidth: 520 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Generate Quotation PDF</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPdfModal(false)}>✕</button>
            </div>

            <div className="modal-body" style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="form-grid-2">
                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Company Name *</label>
                  <input
                    className="form-control"
                    placeholder="e.g. Blue Aqua International"
                    value={recipient.company}
                    onChange={e => setRecipient(r => ({ ...r, company: e.target.value }))}
                    autoFocus
                  />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Address</label>
                  <textarea
                    className="form-control"
                    placeholder={'Line 1\nLine 2\nCity, Country'}
                    rows={3}
                    value={recipient.address}
                    onChange={e => setRecipient(r => ({ ...r, address: e.target.value }))}
                    style={{ resize: 'vertical', fontFamily: 'var(--font)' }}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Attn / Contact Person</label>
                  <input
                    className="form-control"
                    placeholder="e.g. John Lee"
                    value={recipient.attn}
                    onChange={e => setRecipient(r => ({ ...r, attn: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Phone</label>
                  <input
                    className="form-control"
                    placeholder="e.g. +65 9123 4567"
                    value={recipient.phone}
                    onChange={e => setRecipient(r => ({ ...r, phone: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Email</label>
                  <input
                    className="form-control"
                    type="email"
                    placeholder="e.g. john@company.com"
                    value={recipient.email}
                    onChange={e => setRecipient(r => ({ ...r, email: e.target.value }))}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Valid Until</label>
                  <input
                    className="form-control"
                    placeholder="e.g. 31 May 2026"
                    value={recipient.validUntil}
                    onChange={e => setRecipient(r => ({ ...r, validUntil: e.target.value }))}
                  />
                </div>

                <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                  <label className="form-label">Subject</label>
                  <input
                    className="form-control"
                    placeholder="e.g. SEA Freight Rates Quotation — China → Singapore"
                    value={recipient.subject}
                    onChange={e => setRecipient(r => ({ ...r, subject: e.target.value }))}
                  />
                </div>
              </div>

              {!profile.signature_data && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: '8px 12px', background: 'var(--bg)', borderRadius: 7 }}>
                  No signature on file — PDF will include a blank signature line. Add one in My Account.
                </div>
              )}
            </div>

            <div className="flex-between" style={{ padding: '12px 24px', borderTop: '1px solid var(--border-solid)' }}>
              <button className="btn btn-ghost" onClick={() => setShowPdfModal(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={generateQuotePDF}
                disabled={generatingPdf || !recipient.company.trim()}
              >
                {generatingPdf ? <><span className="spinner"></span> Generating...</> : 'Generate PDF'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
