import { describe, it, expect } from 'vitest'
import { autoFillSplit, computeEntityTotals, lineSplitStatus, jobSplitIssues } from './splitInvoicing'

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

  // Regression: money columns are NUMERIC, and a NUMERIC comes back from the database
  // driver as a STRING unless it is explicitly parsed. Summing those with `+` silently
  // concatenates ("0" + "120.50" + "80.25" = "0120.5080.25" -> NaN) and corrupted
  // on-screen totals and invoice PDFs in production. Every fixture above uses JS
  // numbers, so none of them caught it — this one uses strings, as the driver does.
  it('sums string amounts as numbers, not string concatenation', () => {
    const job = {
      billing_lines: [
        { splits: [{ entity_id: 1, amount: '120.50' }] },
        { splits: [{ entity_id: 1, amount: '80.25' }] },
      ],
      cost_lines: [
        { splits: [{ entity_id: 1, amount: '60.10' }] },
        { splits: [{ entity_id: 1, amount: '40.40' }] },
      ],
    }
    const totals = computeEntityTotals({ id: 1 }, job)
    expect(totals.sale).toBeCloseTo(200.75, 2)
    expect(totals.cost).toBeCloseTo(100.50, 2)
    expect(totals.profit).toBeCloseTo(100.25, 2)
    expect(Number.isNaN(totals.gp)).toBe(false)
  })

  it('splits a string line total without corrupting the reconciliation', () => {
    const entities = [{ id: 1, default_share: '0.6' }, { id: 2, default_share: '0.4' }]
    const out = autoFillSplit('100.00', entities)
    expect(out[0].amount + out[1].amount).toBeCloseTo(100, 2)
    expect(out.every(o => !Number.isNaN(o.amount))).toBe(true)
  })
})

// The sales manager's rule: "key in the split and it will total up to the whole amount
// which will reflect on overall invoice." Nothing checked it, so a $100 line split as
// 60 and 30 sent invoices out $10 short while the overall invoice still read $100.
describe('lineSplitStatus', () => {
  it('reports a shortfall as a positive remainder', () => {
    const s = lineSplitStatus({ rate: 100, qty: 1, splits: [
      { entity_id: 1, amount: 60 }, { entity_id: 2, amount: 30 },
    ] }, 'billing')
    expect(s.lineTotal).toBe(100)
    expect(s.splitSum).toBe(90)
    expect(s.remainder).toBe(10)
    expect(s.reconciled).toBe(false)
  })

  it('reports an over-allocation as a negative remainder', () => {
    const s = lineSplitStatus({ rate: 100, qty: 1, splits: [
      { entity_id: 1, amount: 70 }, { entity_id: 2, amount: 50 },
    ] }, 'billing')
    expect(s.remainder).toBe(-20)
    expect(s.reconciled).toBe(false)
  })

  it('accepts a split that adds up', () => {
    const s = lineSplitStatus({ rate: 250, qty: 2, splits: [
      { entity_id: 1, amount: 300 }, { entity_id: 2, amount: 200 },
    ] }, 'billing')
    expect(s.lineTotal).toBe(500)
    expect(s.reconciled).toBe(true)
    expect(s.remainder).toBe(0)
  })

  it('treats an unsplit line as fine, not as a problem', () => {
    const none = lineSplitStatus({ rate: 100, qty: 1, splits: [] }, 'billing')
    expect(none.hasSplits).toBe(false)
    // All zeroes is the same thing: the modal was opened and nothing was entered.
    const zeroed = lineSplitStatus({ rate: 100, qty: 1, splits: [
      { entity_id: 1, amount: 0 }, { entity_id: 2, amount: 0 },
    ] }, 'billing')
    expect(zeroed.hasSplits).toBe(false)
  })

  it('reads a cost line from amount rather than rate x qty', () => {
    const s = lineSplitStatus({ amount: 80, splits: [{ entity_id: 1, amount: 80 }] }, 'cost')
    expect(s.lineTotal).toBe(80)
    expect(s.reconciled).toBe(true)
  })

  it('handles NUMERIC values arriving as strings', () => {
    const s = lineSplitStatus({ rate: '33.33', qty: '3', splits: [
      { entity_id: 1, amount: '50.00' }, { entity_id: 2, amount: '49.99' },
    ] }, 'billing')
    expect(s.lineTotal).toBeCloseTo(99.99, 2)
    expect(s.reconciled).toBe(true)
  })

  it('tolerates a sub-cent rounding difference', () => {
    const s = lineSplitStatus({ rate: 10, qty: 3, splits: [
      { entity_id: 1, amount: 10 }, { entity_id: 2, amount: 10 }, { entity_id: 3, amount: 9.999 },
    ] }, 'billing')
    expect(s.reconciled).toBe(true)
  })

  it('defaults a missing qty to 1 rather than to zero', () => {
    expect(lineSplitStatus({ rate: 45, splits: [] }, 'billing').lineTotal).toBe(45)
  })
})

describe('jobSplitIssues', () => {
  const job = {
    billing_lines: [
      { id: 1, service: 'Freight', rate: 100, qty: 1, splits: [{ entity_id: 1, amount: 60 }, { entity_id: 2, amount: 30 }] }, // 10 short
      { id: 2, service: 'THC', rate: 200, qty: 1, splits: [{ entity_id: 1, amount: 200 }] },                                  // fine
      { id: 3, service: 'Docs', rate: 50, qty: 1, splits: [] },                                                               // unsplit
    ],
    cost_lines: [
      { id: 9, vendor: 'CargoHub', amount: 80, splits: [{ entity_id: 1, amount: 100 }] },                                     // 20 over
    ],
  }

  it('finds only the lines that do not add up', () => {
    const issues = jobSplitIssues(job)
    expect(issues.count).toBe(2)
    expect(issues.billing).toHaveLength(1)
    expect(issues.billing[0].line.id).toBe(1)
    expect(issues.cost).toHaveLength(1)
    expect(issues.cost[0].line.id).toBe(9)
  })

  it('nets the shortfall against the over-allocation', () => {
    expect(jobSplitIssues(job).netRemainder).toBe(-10) // +10 short, -20 over
  })

  it('reports nothing for a job with no splits at all', () => {
    const clean = jobSplitIssues({ billing_lines: [{ rate: 100, qty: 1, splits: [] }], cost_lines: [] })
    expect(clean.count).toBe(0)
    expect(clean.netRemainder).toBe(0)
  })

  it('survives a job with no lines', () => {
    expect(jobSplitIssues({}).count).toBe(0)
    expect(jobSplitIssues().count).toBe(0)
  })
})
