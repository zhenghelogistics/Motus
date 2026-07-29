// The site currently folds multi-cargo-type bookings (e.g. LCL + a 40' container +
// a 20' reefer in one quote) into a "CARGO LINES (n): 1. TYPE × qty — Wkg — commodity
// [— HS code]" block inside specialHandlingNotes, rather than sending a structured
// array. Parse that block so it can be displayed as a real itemized table. If the
// site ever starts sending a real `cargoLines`/`cargo_lines` array instead, that's
// used directly and this text-parsing fallback is skipped.
function parseCargoLinesFromNotes(text) {
  if (!text) return []
  const lineRe = /^\d+\.\s*(.+?)\s*[×x]\s*(\d+)\s*[—-]\s*([\d.]+)\s*kg\s*[—-]\s*([^—-]+?)(?:\s*[—-]\s*HS\s*(\S+))?\s*$/i
  const out = []
  for (const rawLine of String(text).split('\n')) {
    const m = lineRe.exec(rawLine.trim())
    if (!m) continue
    out.push({
      cargoType: m[1].trim(),
      qty: parseInt(m[2], 10) || 1,
      weightKg: parseFloat(m[3]) || 0,
      commodity: m[4].trim(),
      hsCode: m[5] ? m[5].trim() : '',
    })
  }
  return out
}

function extractCargoLines(b, specialHandlingNotes) {
  const structured = Array.isArray(b.cargoLines) ? b.cargoLines
    : Array.isArray(b.cargo_lines) ? b.cargo_lines
    : null
  if (structured && structured.length) {
    return structured.map(c => ({
      cargoType: String(c.cargoType || c.mode || c.type || ''),
      qty: parseInt(c.itemCount ?? c.qty, 10) || 1,
      weightKg: parseFloat(c.weightKg ?? c.weight ?? c.wt) || 0,
      commodity: String(c.commodity || ''),
      hsCode: String(c.hsCode || ''),
    }))
  }
  return parseCargoLinesFromNotes(specialHandlingNotes)
}

module.exports = { parseCargoLinesFromNotes, extractCargoLines }
