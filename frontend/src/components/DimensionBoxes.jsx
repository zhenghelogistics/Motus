import { useState, useEffect } from 'react'

const MAX_BOXES = 20

function parseDimBoxes(dimStr, pkgCount) {
  const dimRegex = /(\d+\.?\d*)\s*[xX×*]\s*(\d+\.?\d*)\s*[xX×*]\s*(\d+\.?\d*)/
  const matches = []
  if (dimStr) {
    for (const seg of dimStr.split(',')) {
      const dm = dimRegex.exec(seg)
      if (dm) {
        const afterDim = seg.slice(dm.index + dm[0].length)
        const qm = /×\s*(\d+)/.exec(afterDim)
        matches.push({ l: dm[1], w: dm[2], h: dm[3], qty: qm ? qm[1] : '1' })
      }
    }
  }
  // Backward compat: single entry with no qty suffix → use pkgCount as qty
  if (matches.length === 1 && matches[0].qty === '1') {
    const count = Math.max(parseInt(pkgCount) || 1, 1)
    if (count > 1) matches[0].qty = String(count)
  }
  return matches.length > 0 ? matches : [{ l: '', w: '', h: '', qty: '1' }]
}

function serializeDimBoxes(boxes) {
  return boxes
    .filter(b => b.l && b.w && b.h)
    .map(b => {
      const q = parseInt(b.qty) || 1
      return `${b.l}x${b.w}x${b.h} cm${q > 1 ? ` ×${q}` : ''}`
    })
    .join(', ')
}

export function calcCBM(boxes) {
  let total = 0, any = false
  for (const { l, w, h, qty } of boxes) {
    const lv = parseFloat(l), wv = parseFloat(w), hv = parseFloat(h)
    const q = parseInt(qty) || 1
    if (lv > 0 && wv > 0 && hv > 0) { total += (lv / 100) * (wv / 100) * (hv / 100) * q; any = true }
  }
  return any ? parseFloat(total.toFixed(4)) : null
}

function calcVolWt(boxes) {
  let total = 0, any = false
  for (const { l, w, h, qty } of boxes) {
    const lv = parseFloat(l), wv = parseFloat(w), hv = parseFloat(h)
    const q = parseInt(qty) || 1
    if (lv > 0 && wv > 0 && hv > 0) { total += (lv * wv * hv) / 6000 * q; any = true }
  }
  return any ? parseFloat(total.toFixed(2)) : null
}

function totalPkgs(boxes) {
  return boxes.reduce((sum, b) => sum + (parseInt(b.qty) || 1), 0)
}

// onChange({ packages, dimensions, cbm }) — called whenever values change
// syncKey — increment from parent to force re-parse of dimensions/packages props
export default function DimensionBoxes({ packages, dimensions, onChange, syncKey }) {
  const [boxes, setBoxes] = useState(() => parseDimBoxes(dimensions, packages))

  useEffect(() => {
    setBoxes(parseDimBoxes(dimensions, packages))
  }, [syncKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const total = totalPkgs(boxes)
  const tooMany = boxes.length > MAX_BOXES  // rows, not total packages

  function push(nextBoxes) {
    onChange({
      packages: totalPkgs(nextBoxes),
      dimensions: serializeDimBoxes(nextBoxes),
      cbm: calcCBM(nextBoxes),
    })
  }

  function updateBox(i, key, val) {
    setBoxes(prev => {
      const next = prev.map((b, idx) => idx === i ? { ...b, [key]: val } : b)
      push(next)
      return next
    })
  }

  function addBox() {
    setBoxes(prev => {
      const last = prev.length > 0 ? { ...prev[prev.length - 1], qty: '1' } : { l: '', w: '', h: '', qty: '1' }
      const next = [...prev, last]
      push(next)
      return next
    })
  }

  function removeBox(idx) {
    setBoxes(prev => {
      if (prev.length <= 1) return prev
      const next = prev.filter((_, i) => i !== idx)
      push(next)
      return next
    })
  }

  const volWeight = calcVolWt(boxes)
  const totalCBM = calcCBM(boxes)

  if (tooMany) {
    return (
      <input className="form-control" value={dimensions || ''}
        onChange={e => onChange({ dimensions: e.target.value, packages, cbm: null })}
        placeholder="e.g. 60x40x30 cm" />
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)', textTransform: 'uppercase', letterSpacing: '0.4px', whiteSpace: 'nowrap' }}>Packages</label>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--navy)' }}>{total}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>— L × W × H (cm) per box:</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 168px', gap: 16, alignItems: 'start' }}>
        <div>
          {boxes.map((box, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 7 }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--navy)', minWidth: 44 }}>Box {i + 1}</span>
              <input type="number" className="form-control form-control-sm" placeholder="L" value={box.l}
                onChange={e => updateBox(i, 'l', e.target.value)} style={{ flex: 1, minWidth: 50 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>×</span>
              <input type="number" className="form-control form-control-sm" placeholder="W" value={box.w}
                onChange={e => updateBox(i, 'w', e.target.value)} style={{ flex: 1, minWidth: 50 }} />
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>×</span>
              <input type="number" className="form-control form-control-sm" placeholder="H" value={box.h}
                onChange={e => updateBox(i, 'h', e.target.value)} style={{ flex: 1, minWidth: 50 }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>cm</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 4 }}>×</span>
              <input type="number" min="1" className="form-control form-control-sm" placeholder="Qty" value={box.qty}
                onChange={e => updateBox(i, 'qty', e.target.value)} style={{ width: 52 }} title="Number of packages with this dimension" />
              {boxes.length > 1 && (
                <button type="button" onClick={() => removeBox(i)} title="Remove box"
                  style={{ marginLeft: 2, background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addBox}
            style={{ marginTop: 4, background: 'none', border: '1px dashed var(--border-solid)', borderRadius: 6, color: 'var(--blue)', fontSize: 12, fontWeight: 600, padding: '5px 14px', cursor: 'pointer' }}>
            + Add Box
          </button>
        </div>

        <div style={{ background: 'var(--bg-hover,#EEF3F8)', borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--navy)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.4px' }}>CBM Breakdown</div>
          {boxes.map((box, i) => {
            const lv = parseFloat(box.l), wv = parseFloat(box.w), hv = parseFloat(box.h)
            const q = parseInt(box.qty) || 1
            const bc = lv > 0 && wv > 0 && hv > 0 ? (lv / 100) * (wv / 100) * (hv / 100) : null
            const bct = bc != null ? bc * q : null
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: 'var(--text-muted)' }}>Box {i + 1}{q > 1 ? ` ×${q}` : ''}</span>
                <span style={{ fontWeight: 600 }}>{bct != null ? bct.toFixed(4) : '—'} m³</span>
              </div>
            )
          })}
          <div style={{ borderTop: '1px solid var(--border-solid,#D1DCE8)', marginTop: 6, paddingTop: 6, fontSize: 12, fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}>
            <span>Total CBM</span>
            <span style={{ color: 'var(--navy)' }}>{totalCBM != null ? totalCBM.toFixed(4) : '—'} m³</span>
          </div>
          {volWeight != null && (
            <div style={{ fontSize: 11, color: 'var(--blue)', marginTop: 4, fontWeight: 600, textAlign: 'right' }}>Vol Wt: {volWeight} kg</div>
          )}
        </div>
      </div>
    </div>
  )
}
