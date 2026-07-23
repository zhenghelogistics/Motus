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

export function computeEntityTotals(entity, job) {
  const sale = (job.billing_lines||[]).reduce((s,l) => s + (l.splits?.find(x => x.entity_id===entity.id)?.amount || 0), 0)
  const cost = (job.cost_lines||[]).reduce((s,l) => s + (l.splits?.find(x => x.entity_id===entity.id)?.amount || 0), 0)
  const profit = sale - cost
  return { sale, cost, profit, gp: sale > 0 ? (profit/sale)*100 : 0 }
}
