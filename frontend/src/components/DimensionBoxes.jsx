import { useState, useEffect } from 'react'

const MAX_BOXES = 20

function parseDimBoxes(dimStr, pkgCount) {
  const count = Math.min(Math.max(parseInt(pkgCount) || 1, 1), MAX_BOXES)
  const regex = /(\d+\.?\d*)\s*[xX×*]\s*(\d+\.?\d*)\s*[xX×*]\s*(\d+\.?\d*)/g
  const matches = []
  let m
  if (dimStr) { while ((m = regex.exec(dimStr)) !== null) matches.push({ l: m[1], w: m[2], h: m[3] }) }
  const last = matches.length > 0 ? matches[matches.length - 1] : { l: '', w: '', h: '' }
  return Array(count).fill(null).map((_, i) => i < matches.length ? { ...matches[i] } : { ...last })
}

function serializeDimBoxes(boxes) {
  return boxes.filter(b => b.l && b.w && b.h).map(b => `${b.l}x${b.w}x${b.h} cm`).join(', ')
}

export function calcCBM(boxes) {
  let total = 0, any = false
  for (const { l, w, h } of boxes) {
    const lv = parseFloat(l), wv = parseFloat(w), hv = parseFloat(h)
    if (lv > 0 && wv > 0 && hv > 0) { total += (lv / 100) * (wv / 100) * (hv / 100); any = true }
  }
  return any ? parseFloat(total.toFixed(4)) : null
}

function calcVolWt(boxes) {
  let total = 0, any = false
  for (const { l, w, h } of boxes) {
    const lv = parseFloat(l), wv = parseFloat(w), hv = parseFloat(h)
    if (lv > 0 && wv > 0 && hv > 0) { total += (lv * wv * hv) / 6000; any = true }
  }
  return any ? parseFloat(total.toFixed(2)) : null
}

// onChange({ packages, dimensions, cbm }) — called whenever values change
// syncKey — increment from parent to force re-parse of dimensions/packages props
export default function DimensionBoxes({ packages, dimensions, onChange, syncKey }) {
  const [boxes, setBoxes] = useState(() => parseDimBoxes(dimensions, packages))

  useEffect(() => {
    setBoxes(parseDimBoxes(dimensions, packages))
  }, [syncKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const tooMany = (parseInt(packages) || 0) > MAX_BOXES

  function push(nextBoxes, nextPkg) {
    onChange({
      packages: nextPkg ?? nextBoxes.length,
      dimensions: serializeDimBoxes(nextBoxes),
      cbm: calcCBM(nextBoxes),
    })
  }

  function onPkgsChange(val) {
    const count = Math.min(Math.max(parseInt(val) || 1, 1), MAX_BOXES)
    setBoxes(prev => {
      const last = prev.length > 0 ? prev[prev.length - 1] : { l: '', w: '', h: '' }
      const next = count >= prev.length
        ? [...prev, ...Array(count - prev.length).fill(null).map(() => ({ ...last }))]
        : prev.slice(0, count)
      push(next, val)
      return next
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
      const last = prev.length > 0 ? { ...prev[prev.length - 1] } : { l: '', w: '', h: '' }
      const next = [...prev, { ...last }]
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
        <input type="number" min="1" className="form-control form-control-sm" value={packages || ''} style={{ width: 80 }}
          onChange={e => onPkgsChange(e.target.value)} />
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
              {boxes.length > 1 && (
                <button type="button" onClick={() => removeBox(i)} title="Remove box"
                  style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#9CA3AF', fontSize: 18, lineHeight: 1, padding: '0 2px' }}>×</button>
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
            const bc = lv > 0 && wv > 0 && hv > 0 ? (lv / 100) * (wv / 100) * (hv / 100) : null
            return (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 3 }}>
                <span style={{ color: 'var(--text-muted)' }}>Box {i + 1}</span>
                <span style={{ fontWeight: 600 }}>{bc != null ? bc.toFixed(4) : '—'} m³</span>
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
