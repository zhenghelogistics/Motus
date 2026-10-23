// Splits entities are ordered by sort_order (insertion order) — the last entity
// always absorbs the rounding remainder so the splits reconcile to the cent.
export function autoFillSplit(lineTotal, entities) {
  const totalShare = entities.reduce((s, e) => s + (Number(e.default_share) || 0), 0)
  if (!totalShare || !entities.length) return entities.map(e => ({ entity_id: e.id, amount: 0 }))
  let runningSum = 0
  const out = entities.slice(0, -1).map(e => {
    const amt = Math.round(lineTotal * (Number(e.default_share) || 0) / totalShare * 100) / 100
    runningSum += amt
    return { entity_id: e.id, amount: amt }
  })
  const last = entities[entities.length - 1]
  out.push({ entity_id: last.id, amount: Math.round((lineTotal - runningSum) * 100) / 100 })
  return out
}

// Amounts are coerced with Number() rather than trusted as-is: these come from
// NUMERIC columns, and a NUMERIC arrives as a *string* unless the driver is told
// otherwise. A bare `s + l.amount` then concatenates instead of adding
// ("0" + "12.50" + "7.25" = "012.507.25" -> NaN) and quietly corrupts invoice totals.
const splitAmount = (line, entityId) =>
  Number(line.splits?.find(x => x.entity_id === entityId)?.amount) || 0

export function computeEntityTotals(entity, job) {
  const sale = (job.billing_lines||[]).reduce((s,l) => s + splitAmount(l, entity.id), 0)
  const cost = (job.cost_lines||[]).reduce((s,l) => s + splitAmount(l, entity.id), 0)
  const profit = sale - cost
  return { sale, cost, profit, gp: sale > 0 ? (profit/sale)*100 : 0 }
}

// ─── RECONCILIATION ──────────────────────────────────────────────────────────
// The rule the sales manager stated: "key in the split and it will total up to the
// whole amount which will reflect on overall invoice." Nothing enforced that, so
// splitting a $100 line as 60 and 30 quietly dropped $10 — the entity invoices went
// out $10 short while the overall invoice still read $100, and nobody was told.
//
// Rounding to the cent before comparing, because the amounts come from NUMERIC columns
// and from text inputs, and 60.00 + 30.00 + 10.00 can land a fraction of a cent off a
// line total computed as rate x qty.
const CENT = 0.005

// qty defaults to 1 only when it is genuinely absent. `Number(undefined) ?? 1` does NOT
// do that: Number(undefined) is NaN, and ?? only substitutes for null and undefined, so
// the NaN survives and multiplies the whole line total to zero.
const qtyOf = (line) =>
  line.qty === undefined || line.qty === null || line.qty === '' ? 1 : Number(line.qty) || 0

export const lineTotalOf = (line, lineType) =>
  lineType === 'cost'
    ? Number(line.amount) || 0
    : Number(line.total ?? (Number(line.rate) || 0) * qtyOf(line)) || 0

/**
 * Reconciliation state for one line.
 * `remainder` is what is still unassigned: positive means short of the line total,
 * negative means the splits add up to more than the line is worth.
 */
export function lineSplitStatus(line, lineType) {
  const lineTotal = lineTotalOf(line, lineType)
  const splits = line.splits || []
  const assigned = splits.filter(s => Number(s.amount) !== 0)
  const splitSum = splits.reduce((s, x) => s + (Number(x.amount) || 0), 0)
  const remainder = Math.round((lineTotal - splitSum) * 100) / 100
  return {
    lineTotal,
    splitSum: Math.round(splitSum * 100) / 100,
    remainder,
    // A line nobody has split yet is not a problem: it simply bills to the job as a
    // whole. Only a line that has been split AND does not add up is wrong.
    hasSplits: assigned.length > 0,
    reconciled: Math.abs(lineTotal - splitSum) < CENT,
  }
}

/** Every split line on the job that does not add up, billing and cost alike. */
export function jobSplitIssues(job = {}) {
  const check = (lines, lineType) => (lines || [])
    .map(l => ({ line: l, lineType, ...lineSplitStatus(l, lineType) }))
    .filter(s => s.hasSplits && !s.reconciled)

  const billing = check(job.billing_lines, 'billing')
  const cost = check(job.cost_lines, 'cost')
  return {
    billing,
    cost,
    count: billing.length + cost.length,
    // Signed, so "$10 short across 2 lines" and "$10 over" read differently.
    netRemainder: Math.round(
      [...billing, ...cost].reduce((s, x) => s + x.remainder, 0) * 100
    ) / 100,
  }
}
