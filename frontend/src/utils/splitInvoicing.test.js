import { describe, it, expect } from 'vitest'
import { autoFillSplit, computeEntityTotals } from './splitInvoicing'

describe('autoFillSplit', () => {
  // Real example: two entities with shares 8 and 5 (Amandari / Amankila),
  // verified by hand against the client's original spreadsheet.
  const entities = [{ id: 1, default_share: 8 }, { id: 2, default_share: 5 }]

  it('splits a sale total to the cent (702.00 -> 432.00 / 270.00)', () => {
    const out = autoFillSplit(702.00, entities)
    expect(out).toEqual([
      { entity_id: 1, amount: 432.00 },
      { entity_id: 2, amount: 270.00 },
    ])
  })

  it('splits a cost line to the cent (498.00 -> 306.46 / 191.54)', () => {
    const out = autoFillSplit(498.00, entities)
    expect(out).toEqual([
      { entity_id: 1, amount: 306.46 },
      { entity_id: 2, amount: 191.54 },
    ])
  })

  it('splits a small cost line to the cent (11.00 -> 6.77 / 4.23)', () => {
    const out = autoFillSplit(11.00, entities)
    expect(out).toEqual([
      { entity_id: 1, amount: 6.77 },
      { entity_id: 2, amount: 4.23 },
    ])
  })

  it('splits an odd cost line to the cent (69.23 -> 42.60 / 26.63)', () => {
    const out = autoFillSplit(69.23, entities)
    expect(out).toEqual([
      { entity_id: 1, amount: 42.60 },
      { entity_id: 2, amount: 26.63 },
    ])
  })

  it('always reconciles exactly to the line total, even with 3-way rounding', () => {
    // $10 split three ways evenly (shares 1:1:1) -> 3.33 / 3.33 / 3.34 — the
    // last entity absorbs the leftover cent so the sum always matches exactly.
    const threeWay = [{ id: 1, default_share: 1 }, { id: 2, default_share: 1 }, { id: 3, default_share: 1 }]
    const out = autoFillSplit(10.00, threeWay)
    expect(out).toEqual([
      { entity_id: 1, amount: 3.33 },
      { entity_id: 2, amount: 3.33 },
      { entity_id: 3, amount: 3.34 },
    ])
    const sum = out.reduce((s, o) => s + o.amount, 0)
    expect(sum).toBeCloseTo(10.00, 2)
  })

  it('gives a single entity the full amount', () => {
    const out = autoFillSplit(500, [{ id: 1, default_share: 1 }])
    expect(out).toEqual([{ entity_id: 1, amount: 500 }])
  })

  it('returns all zeros when every entity has zero share (no divide-by-zero)', () => {
    const zeroShare = [{ id: 1, default_share: 0 }, { id: 2, default_share: 0 }]
    const out = autoFillSplit(100, zeroShare)
    expect(out).toEqual([
      { entity_id: 1, amount: 0 },
      { entity_id: 2, amount: 0 },
    ])
  })

  it('returns an empty array when there are no entities', () => {
    expect(autoFillSplit(100, [])).toEqual([])
  })
})

describe('computeEntityTotals', () => {
  it('sums only the target entity\'s splits across billing and cost lines', () => {
    const job = {
      billing_lines: [
        { id: 10, splits: [{ entity_id: 1, amount: 432.00 }, { entity_id: 2, amount: 270.00 }] },
      ],
      cost_lines: [
        { id: 20, splits: [{ entity_id: 1, amount: 306.46 }, { entity_id: 2, amount: 191.54 }] },
        { id: 21, splits: [{ entity_id: 1, amount: 6.77 }, { entity_id: 2, amount: 4.23 }] },
        { id: 22, splits: [{ entity_id: 1, amount: 42.60 }, { entity_id: 2, amount: 26.63 }] },
      ],
    }
    const totals = computeEntityTotals({ id: 1 }, job)
    expect(totals.sale).toBeCloseTo(432.00, 2)
    expect(totals.cost).toBeCloseTo(355.83, 2)
    expect(totals.profit).toBeCloseTo(76.17, 2)
    expect(totals.gp).toBeCloseTo(17.63, 1)

    // The other entity's numbers must not leak in.
    const other = computeEntityTotals({ id: 2 }, job)
    expect(other.sale).toBeCloseTo(270.00, 2)
    expect(other.cost).toBeCloseTo(222.40, 2)
  })

  it('returns all zeros (not NaN) for an entity with no splits assigned', () => {
    const job = { billing_lines: [{ id: 1, splits: [] }], cost_lines: [{ id: 2, splits: [] }] }
    const totals = computeEntityTotals({ id: 99 }, job)
    expect(totals).toEqual({ sale: 0, cost: 0, profit: 0, gp: 0 })
  })

  it('does not divide by zero when sale is 0 but cost is not', () => {
    const job = {
      billing_lines: [],
      cost_lines: [{ id: 1, splits: [{ entity_id: 1, amount: 50 }] }],
    }
    const totals = computeEntityTotals({ id: 1 }, job)
    expect(totals.sale).toBe(0)
    expect(totals.cost).toBe(50)
    expect(totals.profit).toBe(-50)
    expect(totals.gp).toBe(0) // guarded, not -Infinity or NaN
  })

  it('handles missing billing_lines/cost_lines gracefully', () => {
    const totals = computeEntityTotals({ id: 1 }, {})
    expect(totals).toEqual({ sale: 0, cost: 0, profit: 0, gp: 0 })
  })
})
