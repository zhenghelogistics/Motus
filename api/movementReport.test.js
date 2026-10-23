const test = require('node:test')
const assert = require('node:assert')
const { periodWindow, deriveMovementMetrics, deriveTrend, asDay, REPORT_CURRENCY } = require('./movementReport')

// The report went to a reader that had to write "the tool doesn't state the currency,
// so I've assumed SGD". It guessed right, but a money report presented to leadership
// should never leave that to a guess.
test('the report states its currency rather than leaving it to be inferred', () => {
  assert.equal(REPORT_CURRENCY, 'SGD')
  assert.equal(deriveMovementMetrics([]).currency, 'SGD')
})

// A representative month of movements. Sale/cost arrive pre-summed from the query.
const JOBS = [
  { job_number:'ZHL-001/26', mode:'Sea FCL', status:'Completed', customer_name:'Amandari',
    weight:1200, cbm:14, packages:20, sale:9000, cost:6500,
    date_out:'2026-08-02', date_delivered:'2026-08-09', deadline_date:'2026-08-10',
    salesperson:'brandon@zhenghe.com.sg', created_at:'2026-08-01T00:00:00Z' },
  { job_number:'ZHL-002/26', mode:'Air Freight', status:'Completed', customer_name:'Jooyi',
    weight:300, cbm:2, packages:8, sale:6000, cost:4000,
    date_out:'2026-08-04', date_delivered:'2026-08-12', deadline_date:'2026-08-08',  // 4 days late
    salesperson:'brandon@zhenghe.com.sg', created_at:'2026-08-03T00:00:00Z' },
  { job_number:'ZHL-003/26', mode:'Sea FCL', status:'In Progress', customer_name:'Amandari',
    weight:800, cbm:9, packages:12, sale:5000, cost:0,                                // no costing yet
    created_at:'2026-08-10T00:00:00Z' },
  { job_number:'ZHL-004/26', mode:'Local Delivery', status:'Completed', customer_name:'Delta',
    weight:150, cbm:1, packages:4, sale:1000, cost:700,
    date_out:'2026-08-14', date_delivered:'2026-08-14', deadline_date:'2026-08-14',   // exactly on time
    salesperson:'ops@zhenghe.com.sg', created_at:'2026-08-13T00:00:00Z' },
  { job_number:'ZHL-005/26', mode:'Sea FCL', status:'Voided', customer_name:'Ghost',
    weight:9999, cbm:99, packages:99, sale:50000, cost:40000, created_at:'2026-08-15T00:00:00Z' },
]

// ── period resolution ─────────────────────────────────────────────────────────

test('resolves a month, quarter and year', () => {
  const m = periodWindow('2026-08')
  assert.strictEqual(m.kind, 'month')
  assert.strictEqual(m.label, 'August 2026')

  const q = periodWindow('2026-Q3')
  assert.strictEqual(q.kind, 'quarter')
  assert.strictEqual(q.label, 'Q3 2026')
  assert.strictEqual(q.start.getMonth(), 6)  // July
  assert.strictEqual(q.end.getMonth(), 9)    // exclusive October

  const y = periodWindow('2026')
  assert.strictEqual(y.kind, 'year')
  assert.strictEqual(y.label, '2026')
})

test('the comparison window matches the length of the period', () => {
  assert.strictEqual(periodWindow('2026-08').prevStart.getMonth(), 6)   // July
  assert.strictEqual(periodWindow('2026-Q3').prevStart.getMonth(), 3)   // April, i.e. Q2
  assert.strictEqual(periodWindow('2026').prevStart.getFullYear(), 2025)
})

test('an unrecognised period falls back to the current month rather than failing', () => {
  const p = periodWindow('nonsense', new Date(2026, 7, 15))
  assert.strictEqual(p.kind, 'month')
  assert.strictEqual(p.start.getMonth(), 7)
})

// ── volume and money ──────────────────────────────────────────────────────────

test('voided jobs are counted but excluded from revenue and volume', () => {
  const m = deriveMovementMetrics(JOBS)
  assert.strictEqual(m.volume.jobs, 4, 'the voided job is not counted as work done')
  assert.strictEqual(m.volume.voided, 1)
  assert.strictEqual(m.money.sale, 21000, 'the voided S$50,000 is excluded')
  assert.strictEqual(m.volume.weightKg, 2450, 'its 9,999kg is excluded too')
})

test('reports profit and margin off live jobs only', () => {
  const m = deriveMovementMetrics(JOBS)
  assert.strictEqual(m.money.cost, 11200)
  assert.strictEqual(m.money.profit, 9800)
  // 46.7% is what the raw sums give, but ZHL-003 carries S$5,000 of revenue with no
  // supplier cost entered yet, so that figure is flattered. The headline is the margin
  // on jobs where both sides are known: 4,800 / 16,000.
  assert.strictEqual(m.money.gpPercentAll, 46.7)
  assert.strictEqual(m.money.gpPercent, 30)
  assert.strictEqual(m.money.settledJobs, 3)
})

test('average job value ignores voided work', () => {
  const m = deriveMovementMetrics(JOBS)
  assert.strictEqual(m.money.avgJobValue, 5250) // 21000 / 4
})

// ── pricing state ─────────────────────────────────────────────────────────────
// A Motus job is a workspace: salespeople open one when the enquiry lands and fill it
// in over the following days. So the month always contains a mix of finished facts and
// work still being negotiated, and the report has to tell them apart.

// Deliberately separate from JOBS so these cases do not disturb the totals the other
// tests assert against.
const MIXED = [
  { job_number:'A', status:'Completed',   mode:'Air',  sale:1000, cost:600 },  // settled
  { job_number:'B', status:'Completed',   mode:'Air',  sale:2000, cost:1000 }, // settled
  { job_number:'C', status:'In Progress', mode:'Air',  sale:4000, cost:0 },    // billed, not costed
  { job_number:'D', status:'In Progress', mode:'Sea',  sale:0,    cost:300 },  // cost in, nothing billed
  { job_number:'E', status:'In Progress', mode:'Sea',  sale:0,    cost:0 },    // being negotiated
  { job_number:'F', status:'New',         mode:'Sea',  sale:0,    cost:0 },    // being negotiated
  { job_number:'G', status:'Completed',   mode:'Sea',  sale:0,    cost:0 },    // shipped, never billed
]

test('classifies every job by how far through pricing it is', () => {
  const p = deriveMovementMetrics(MIXED).pipeline
  assert.strictEqual(p.settled, 2)
  assert.strictEqual(p.uncosted, 1)
  assert.strictEqual(p.unbilled, 1)
  assert.strictEqual(p.beingPriced, 2, 'E and F only; G is completed, so it is not in negotiation')
})

test('a job still being negotiated is not reported as a data fault', () => {
  const m = deriveMovementMetrics(MIXED)
  // E and F have nothing on them, and that is normal. Only G, which is finished with
  // nothing billed, is an actual problem.
  assert.strictEqual(m.risk.completedUnbilled, 1)
  assert.strictEqual(m.risk.missingCosting, 1, 'C alone: revenue recorded, cost not')
})

test('the headline margin excludes jobs that are only half entered', () => {
  const m = deriveMovementMetrics(MIXED)
  // Raw: sale 7000, cost 1900, profit 5100 -> 72.9%, flattered by C's uncosted 4,000.
  assert.strictEqual(m.money.gpPercentAll, 72.9)
  // Settled: A and B only. sale 3000, cost 1600, profit 1400 -> 46.7%.
  assert.strictEqual(m.money.gpPercent, 46.7)
  assert.strictEqual(m.pipeline.settledSale, 3000)
  assert.strictEqual(m.pipeline.settledProfit, 1400)
})

test('averages are taken over jobs that carry a figure, not over every job', () => {
  const m = deriveMovementMetrics(MIXED)
  // 4 of the 7 have a figure. Dividing 7,000 by all 7 would report 1,000 and describe
  // nobody; the jobs that have actually been priced average 1,750.
  assert.strictEqual(m.money.pricedJobs, 4)
  assert.strictEqual(m.money.avgJobValue, 1750)
})

test('a month where nothing has been costed yet reports no margin rather than a fake one', () => {
  const m = deriveMovementMetrics([
    { job_number:'X', status:'New', sale:5000, cost:0 },
    { job_number:'Y', status:'New', sale:3000, cost:0 },
  ])
  assert.strictEqual(m.money.gpPercent, 0, 'nothing is settled, so there is no honest margin to quote')
  assert.strictEqual(m.money.gpPercentAll, 100, 'the raw figure would claim a 100% margin')
  assert.strictEqual(m.money.settledJobs, 0)
  assert.strictEqual(m.risk.missingCosting, 2)
})

test('voided jobs stay out of the pricing counts', () => {
  const m = deriveMovementMetrics([
    ...MIXED,
    { job_number:'V', status:'Voided', sale:99999, cost:11111 },
  ])
  assert.strictEqual(m.pipeline.settled, 2, 'the voided job is not a settled job')
  assert.strictEqual(m.money.gpPercent, 46.7, 'and it does not move the headline margin')
})

// ── delivery performance ──────────────────────────────────────────────────────

test('scores on-time delivery only where both dates exist', () => {
  const m = deriveMovementMetrics(JOBS)
  assert.strictEqual(m.delivery.judged, 3, 'the in-progress job has no delivery date')
  assert.strictEqual(m.delivery.onTime, 2)
  assert.strictEqual(m.delivery.late, 1)
  assert.strictEqual(m.delivery.onTimeRate, 66.7)
})

test('delivery on the deadline itself counts as on time', () => {
  // ZHL-004 was delivered on its deadline. Treating that as late would be wrong, and
  // is exactly what a UTC-parsed comparison would do from a UTC+8 machine.
  const m = deriveMovementMetrics([JOBS[3]])
  assert.strictEqual(m.delivery.onTime, 1)
  assert.strictEqual(m.delivery.onTimeRate, 100)
})

test('measures how late the late ones were, and transit time', () => {
  const m = deriveMovementMetrics(JOBS)
  assert.strictEqual(m.delivery.avgDaysLate, 4)
  assert.strictEqual(m.delivery.avgTransitDays, 5) // (7 + 8 + 0) / 3
})

test('says nothing rather than 100% when no job can be judged', () => {
  const m = deriveMovementMetrics([{ job_number:'X', status:'New', sale:100, cost:50 }])
  assert.strictEqual(m.delivery.judged, 0)
  assert.strictEqual(m.delivery.onTimeRate, 0)
  assert.strictEqual(m.delivery.avgTransitDays, null)
})

// ── risk ──────────────────────────────────────────────────────────────────────

test('flags customer concentration', () => {
  const m = deriveMovementMetrics(JOBS)
  assert.strictEqual(m.risk.topCustomerName, 'Amandari')
  assert.strictEqual(m.risk.topCustomerShare, 66.7) // 14000 of 21000
})

test('flags revenue with no cost recorded against it', () => {
  const m = deriveMovementMetrics(JOBS)
  assert.strictEqual(m.risk.missingCosting, 1)
  assert.strictEqual(m.risk.missingCostingValue, 5000)
})

// ── breakdowns ────────────────────────────────────────────────────────────────

test('breaks revenue down by mode with its own margin', () => {
  const m = deriveMovementMetrics(JOBS)
  const fcl = m.byMode.find(x => x.key === 'Sea FCL')
  assert.strictEqual(fcl.jobs, 2, 'the voided FCL job is excluded')
  assert.strictEqual(fcl.value, 14000)
  // (14000 - 6500) / 14000. Inflated by ZHL-003 carrying revenue with no cost yet,
  // which is exactly what the missingCosting figure exists to warn about.
  assert.strictEqual(fcl.gpPercent, 53.6)
})

test('attributes jobs to salesperson, falling back to unassigned', () => {
  const m = deriveMovementMetrics(JOBS)
  assert.strictEqual(m.byTeam[0].key, 'brandon@zhenghe.com.sg')
  assert.ok(m.byTeam.some(t => t.key === 'Unassigned'))
})

test('top jobs are ordered by revenue', () => {
  const m = deriveMovementMetrics(JOBS)
  assert.strictEqual(m.topJobs[0].job_number, 'ZHL-001/26')
  assert.ok(!m.topJobs.some(j => j.job_number === 'ZHL-005/26'), 'voided job never appears')
})

// ── trend ─────────────────────────────────────────────────────────────────────

test('buckets a longer period into months in order', () => {
  const t = deriveTrend([
    { status:'Completed', sale:100, cost:60, created_at:'2026-07-05T00:00:00Z' },
    { status:'Completed', sale:200, cost:100, created_at:'2026-08-05T00:00:00Z' },
    { status:'Completed', sale:300, cost:150, created_at:'2026-08-20T00:00:00Z' },
    { status:'Voided',    sale:999, cost:0,   created_at:'2026-08-21T00:00:00Z' },
  ])
  assert.deepStrictEqual(t.map(x => x.month), ['2026-07', '2026-08'])
  assert.strictEqual(t[1].jobs, 2, 'voided excluded from the trend too')
  assert.strictEqual(t[1].sale, 500)
  assert.strictEqual(t[1].gpPercent, 50)
})

// ── degenerate input ──────────────────────────────────────────────────────────

test('an empty period produces zeros, never NaN', () => {
  const m = deriveMovementMetrics([])
  assert.strictEqual(m.volume.jobs, 0)
  assert.strictEqual(m.money.gpPercent, 0)
  assert.strictEqual(m.risk.topCustomerName, null)
  for (const v of Object.values(m.money)) assert.ok(!Number.isNaN(v))
})

test('NUMERIC values arriving as strings still add up', () => {
  const m = deriveMovementMetrics([
    { job_number:'A', status:'Completed', sale:'1500.50', cost:'500.25', weight:'100.5', cbm:'2.5' },
  ])
  assert.strictEqual(m.money.sale, 1500.5)
  assert.strictEqual(m.money.profit, 1000.25)
  assert.strictEqual(m.volume.weightKg, 100.5)
})

test('asDay ignores a time component and rejects junk', () => {
  assert.strictEqual(asDay('2026-08-14'), asDay('2026-08-14T18:30:00Z'))
  assert.strictEqual(asDay(''), null)
  assert.strictEqual(asDay('not-a-date'), null)
})

// ── period-over-period comparison ─────────────────────────────────────────────
const { compareBreakdown, compareMargins } = require('./movementReport')

const PREV = [
  { key: 'Amandari', jobs: 6, value: 40000 },
  { key: 'Jooyi',    jobs: 3, value: 12000 },
  { key: 'Delta',    jobs: 2, value: 8000 },
  { key: 'Tiny Co',  jobs: 1, value: 200 },
]
const CUR = [
  { key: 'Jooyi',    jobs: 5, value: 21000 },  // grew 75%
  { key: 'Delta',    jobs: 2, value: 7600 },   // -5%, within noise
  { key: 'Newcomer', jobs: 2, value: 9000 },   // appeared
  { key: 'Tiny Co',  jobs: 1, value: 100 },    // too small to matter
]

test('spots a customer that stopped spending entirely', () => {
  const c = compareBreakdown(CUR, PREV)
  assert.deepStrictEqual(c.vanished.map(v => v.key), ['Amandari'])
  assert.strictEqual(c.vanished[0].was, 40000)
})

test('spots a customer that is new this period', () => {
  const c = compareBreakdown(CUR, PREV)
  assert.deepStrictEqual(c.appeared.map(v => v.key), ['Newcomer'])
})

test('reports meaningful growth and ignores noise', () => {
  const c = compareBreakdown(CUR, PREV)
  assert.deepStrictEqual(c.grew.map(v => v.key), ['Jooyi'])
  assert.strictEqual(c.grew[0].changePct, 75)
  assert.strictEqual(c.shrank.length, 0, 'a 5% dip is not a story')
})

test('trivial amounts are excluded from both directions', () => {
  const c = compareBreakdown(CUR, PREV)
  const mentioned = [...c.appeared, ...c.vanished, ...c.grew, ...c.shrank].map(x => x.key)
  assert.ok(!mentioned.includes('Tiny Co'), 'a S$200 job should not appear as a movement')
})

test('a real decline is reported', () => {
  const c = compareBreakdown(
    [{ key: 'Acme', jobs: 2, value: 6000 }],
    [{ key: 'Acme', jobs: 8, value: 30000 }],
  )
  assert.strictEqual(c.shrank[0].key, 'Acme')
  assert.strictEqual(c.shrank[0].changePct, -80)
})

test('margin movement is surfaced per service line', () => {
  const m = compareMargins(
    [{ key: 'Sea FCL', value: 40000, gpPercent: 14.0 }, { key: 'Air', value: 20000, gpPercent: 22.3 }],
    [{ key: 'Sea FCL', value: 35000, gpPercent: 24.0 }, { key: 'Air', value: 18000, gpPercent: 22.0 }],
  )
  // Sea FCL lost 10 points of margin while growing revenue: exactly the thing a single
  // blended GP% would hide.
  assert.strictEqual(m[0].key, 'Sea FCL')
  assert.strictEqual(m[0].gpChange, -10)
  assert.strictEqual(m.length, 1, 'Air moved 0.3 points and is not worth a slide')
})

test('comparison handles an empty previous period', () => {
  const c = compareBreakdown(CUR, [])
  assert.strictEqual(c.vanished.length, 0)
  assert.ok(c.appeared.length > 0)
  assert.deepStrictEqual(compareMargins(CUR, []), [])
})
