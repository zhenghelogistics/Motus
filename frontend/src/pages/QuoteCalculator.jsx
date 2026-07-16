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

const PRESET_REMARKS = [
  { label: 'Rates subject to change',       text: 'Rates, surcharges and schedules are subject to change without prior notice at carrier\'s discretion based on final cargo details & market conditions.' },
  { label: 'Space subject to confirmation', text: 'Space availability is subject to carrier\'s acceptance and confirmation.' },
  { label: 'General cargo only',            text: 'The above quotations are for general cargo only. Hazardous, over-length, odd-size, perishables or any other special cargo is subject to rate adjustment at the discretion of the respective shipping agent.' },
  { label: 'Standard permit only',          text: 'Quoted price is for standard export non-controlled permit. Extra charges apply for any other permit requirement based on shipper\'s instructions.' },
  { label: 'Chargeable weight basis',       text: 'All charges are based on the chargeable weight of each shipment as specified in the Bill of Lading / Shipping Note. Chargeable rates are based on actual gross or volumetric weight / CBM, whichever is higher.' },
  { label: 'Excludes recoverable expenses', text: 'The above does not include recoverable expenses paid by us on your behalf, e.g. GST, surveyor\'s fee, storage charges, and duties.' },
  { label: 'Additional charges apply',      text: 'Additional charges will apply for urgent shipments, diversion, extra works performed, use of mechanical aids, overtime incurred, etc.' },
  { label: 'Marine insurance excluded',     text: 'Marine insurance is not inclusive unless stated within the quotation.' },
  { label: 'Post-validity rate revision',   text: 'If shipment departs after the quotation validity, any revision in rates will supersede the current rates provided.' },
  { label: 'Subject to Singapore GST',      text: 'All rates quoted are subject to prevailing Goods and Services Tax in Singapore.' },
  { label: 'Excludes storage & port charges', text: 'Above rates do not include storage rent, inspection, loading at port, or unloading at place of consignee (if any).' },
  { label: 'Outer packaging only',          text: 'Cargo acceptance is based on outer packaging (e.g. cartons, cases, crates & pallets) only. Inner contents will not be our liability.' },
  { label: 'Excludes insurance & packing',  text: 'Rates quoted exclude insurance, packing, manpower, transshipment, and import into Singapore.' },
  { label: 'Delivery delays possible',      text: 'Delivery time is normally within the stated period. Delays may occur due to port conditions, customs formalities, connecting vessel/airline delays & acts of God.' },
  { label: 'Client loading equipment',      text: 'Clients are to ensure they have proper equipment to load or unload at premises. Prior notice must be given. Extra charges may apply depending on equipment and availability.' },
  { label: 'Standard trading conditions',   text: 'All business handled is subject to our Standard Trading Conditions, a copy of which is available on application.' },
  { label: 'Rates effective on booking',    text: 'Acceptance of rates is effected upon confirmation of bookings.' },
  { label: 'Payment terms (30 days)',       text: 'Payment term is 30 days upon receiving our invoice.' },
  { label: 'Contact for other destinations', text: 'For other destinations, cities or countries, please contact us.' },
  { label: 'Cargo packaging (IATA)',        text: 'Please ensure cargo is packed in good condition in accordance with IATA requirements. Additional charges will apply if repacking is needed.' },
  { label: 'Space & equipment availability', text: 'Subject to space and equipment availability.' },
  { label: 'Empty repositioning cost',      text: 'Subject to empty repositioning cost, if any.' },
  { label: 'Heavy weight surcharge',        text: 'Subject to Heavy Weight Surcharge, if applicable.' },
  { label: 'ISOCC monthly review',          text: 'ISOCC is subject to monthly review.' },
  { label: 'Prepaid charges not shown',     text: 'Standard prepaid charges are not shown.' },
  { label: 'Dry boxes only',                text: 'Above rates are for Dry Boxes only, Non-DG / Waste / Scrap.' },
  { label: 'POL local charges',             text: 'Container seal fee, documentation fees and other POL local charges are payable by either the POL shipper or POD consignee.' },
  { label: 'Ocean freight payable in SG',   text: 'TOS: Ocean Freight payable in Singapore only.' },
  { label: 'New surcharges post-quotation', text: 'Subject to other surcharges if implemented after this quotation or upon booking.' },
  { label: 'Monthly surcharge fluctuation', text: 'Surcharges are subject to monthly fluctuation.' },
  { label: 'Surcharges w/o prior notice',   text: 'Surcharges are subject to changes without prior notice.' },
  { label: 'DG cargo approval required',    text: 'DG cargoes are subject to approval at POL & POD agent.' },
  { label: 'Quote void after 7 days',       text: 'Above quotation will be null & void after 7 days of not receiving your confirmation.' },
  { label: 'Confirm before validity expires', text: 'Please advise acceptance of quotes before validity expires.' },
  { label: 'Rates subject to change (short)', text: 'Rate subject to changes without prior notice.' },
]
const DEFAULT_REMARKS = new Set([0, 1, 7, 9, 16])

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
  const [selectedRemarks, setSelectedRemarks] = useState(() => new Set(DEFAULT_REMARKS))
  const [customRemarks, setCustomRemarks] = useState([])
  const [newCustomRemark, setNewCustomRemark] = useState('')
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
    setSelectedRemarks(new Set(DEFAULT_REMARKS))
    setCustomRemarks([])
    setNewCustomRemark('')
  }

  function toggleRemark(i) {
    setSelectedRemarks(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function addCustomRemark() {
    const t = newCustomRemark.trim()
    if (!t) return
    setCustomRemarks(prev => [...prev, t])
    setNewCustomRemark('')
  }

  const allRemarks = [
    ...PRESET_REMARKS.filter((_, i) => selectedRemarks.has(i)).map(r => r.text),
    ...customRemarks,
  ]

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
      doc.rect(0, 0, pw, 40, 'F')
      if (logoRef.current) {
        const nw = logoRef.current.naturalWidth || 1
        const nh = logoRef.current.naturalHeight || 1
        const lw = 50
        const lh = (nh / nw) * lw
        doc.addImage(logoRef.current, 'PNG', 5, Math.max(2, (40 - lh) / 2), lw, lh)
      }
      doc.setTextColor(255, 255, 255)
      doc.setFontSize(8); doc.setFont('helvetica', 'normal')
      doc.text('75 Bukit Timah Road, #05-01 Boon Siew Building, Singapore 229833', 60, 18)
      doc.text('T: 6955 8298   F: 6980 2095   rfq@zhenghe.com.sg   Reg No. 201734570K', 60, 26)

      // ── Ref + Date (top right) ───────────────────────────────────────
      let y = 48
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

      // ── Remarks ──────────────────────────────────────────────────────
      if (allRemarks.length) {
        doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
        doc.text('Remarks:', ml, y); y += 6
        doc.setFont('helvetica', 'normal'); doc.setTextColor(55, 55, 55)
        allRemarks.forEach(c => {
          const wrapped = doc.splitTextToSize(`• ${c}`, tw - 4)
          doc.text(wrapped, ml + 2, y)
          y += wrapped.length * 5 + 1.5
        })
        y += 6
      }

      // ── Closing ──────────────────────────────────────────────────────
      // Need ~85mm for closing + signature block — add page if not enough
      if (y > 200) { doc.addPage(); y = 20 }

      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(50, 50, 50)
      const closing = 'We hope the above rates quoted will meet your requirements. Should you need any further assistance or clarification, please feel free to contact us.'
      const closingLines = doc.splitTextToSize(closing, tw)
      doc.text(closingLines, ml, y); y += closingLines.length * 5 + 6
      doc.text('Thank you!', ml, y); y += 10

      // ── Signature block (two-column: ZHL left, customer ack right) ──
      const sigY = y
      const rX = 112   // right column start x
      const rW = pw - mr - rX  // ~80mm

      // ── LEFT: Yours sincerely → signature → name → role → company ──
      doc.setFontSize(9); doc.setFont('helvetica', 'italic'); doc.setTextColor(60, 60, 60)
      doc.text('Yours sincerely,', ml, sigY)

      let lY = sigY + 6
      if (profile.signature_data) {
        doc.addImage(profile.signature_data, 'PNG', ml, lY, 55, 22)
        doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3)
        doc.line(ml, lY + 23, ml + 62, lY + 23)
        lY += 28
      } else {
        doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3)
        doc.line(ml, lY + 18, ml + 62, lY + 18)
        lY += 22
      }
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text(profile.display_name || '___________________', ml, lY); lY += 5
      if (profile.designation) {
        doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(70, 70, 70)
        doc.text(profile.designation, ml, lY); lY += 5
      }
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('Zhenghe Logistics Pte Ltd', ml, lY)

      // ── RIGHT: Acknowledged & Agreed → signature box → pre-filled name + company ──
      doc.setFontSize(9); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      doc.text('Acknowledged & Agreed:', rX, sigY)

      // Signature box (empty space + bottom line)
      const boxTop = sigY + 6
      const boxBot = sigY + 34
      doc.setDrawColor(200, 200, 200); doc.setLineWidth(0.3)
      doc.line(rX, boxBot, rX + rW, boxBot)

      // Pre-filled recipient details below the box
      let rY = boxBot + 7
      doc.setFontSize(9.5); doc.setFont('helvetica', 'bold'); doc.setTextColor(...navy)
      if (recipient.attn) { doc.text(recipient.attn, rX, rY); rY += 5 }
      doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(70, 70, 70)
      if (recipient.company) { doc.text(recipient.company, rX, rY); rY += 5 }
      if (recipient.email) {
        doc.setFontSize(8.5); doc.setTextColor(100, 100, 100)
        doc.text(recipient.email, rX, rY)
        rY += 5
      }

      y = Math.max(lY + 6, rY + 8)

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
    if (allRemarks.length) {
      out += `\nREMARKS\n${sep}\n`
      allRemarks.forEach((r, i) => { out += `${i + 1}. ${r}\n` })
    }
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

      {/* ── Remarks ─────────────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 800, color: 'var(--heading)', textTransform: 'uppercase', letterSpacing: '0.6px' }}>Remarks</span>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>Included in PDF &amp; copied quote</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-xs" onClick={() => setSelectedRemarks(new Set(PRESET_REMARKS.map((_, i) => i)))}>Select all</button>
            <button className="btn btn-ghost btn-xs" onClick={() => setSelectedRemarks(new Set())}>Clear all</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', marginBottom: 14 }}>
          {PRESET_REMARKS.map((r, i) => (
            <label key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', cursor: 'pointer', padding: '5px 6px', borderRadius: 6, background: selectedRemarks.has(i) ? 'var(--blue-light)' : 'transparent', transition: 'background 0.12s' }}>
              <input
                type="checkbox"
                checked={selectedRemarks.has(i)}
                onChange={() => toggleRemark(i)}
                style={{ marginTop: 2, accentColor: 'var(--navy)', flexShrink: 0 }}
              />
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text)' }}>{r.label}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4, marginTop: 1 }}>{r.text.slice(0, 80)}{r.text.length > 80 ? '…' : ''}</div>
              </div>
            </label>
          ))}
        </div>

        {customRemarks.length > 0 && (
          <div style={{ marginBottom: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {customRemarks.map((r, i) => (
              <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 10px', background: 'var(--sub-box-bg)', borderRadius: 6, border: '1px solid var(--sub-box-border)' }}>
                <span style={{ fontSize: 12, color: 'var(--text)', flex: 1, lineHeight: 1.5 }}>{r}</span>
                <button onClick={() => setCustomRemarks(prev => prev.filter((_, j) => j !== i))} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 14, padding: '0 2px', lineHeight: 1, flexShrink: 0 }}>✕</button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8 }}>
          <textarea
            className="form-control"
            rows={2}
            placeholder="Add a custom remark…"
            value={newCustomRemark}
            onChange={e => setNewCustomRemark(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); addCustomRemark() } }}
            style={{ resize: 'none', fontSize: 12, fontFamily: 'var(--font)', flex: 1 }}
          />
          <button className="btn btn-outline btn-sm" onClick={addCustomRemark} disabled={!newCustomRemark.trim()} style={{ alignSelf: 'flex-end' }}>Add</button>
        </div>

        {allRemarks.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            {allRemarks.length} remark{allRemarks.length !== 1 ? 's' : ''} selected
          </div>
        )}
      </div>

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
