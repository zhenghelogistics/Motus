const test = require('node:test')
const assert = require('node:assert')
const { deriveMetrics, computeRateAmount, normaliseBasis } = require('./rateCalc')

// Fixtures transcribed from the two real vendor cards, so these tests fail if the
// maths ever stops matching what the vendors actually invoice.

// Quality Transport (Air) — delivery, banded on gross weight, top band flips to per-kg.
const QUALITY_DELIVERY = {
  charge_name: 'Delivery',
  basis: 'banded',
  band_metric: 'weight_kg',
  bands: [
    { from: 1,    to: 50,   amount: 17.00, basis: 'flat' },
    { from: 51,   to: 100,  amount: 22.00, basis: 'flat' },
    { from: 101,  to: 200,  amount: 25.00, basis: 'flat' },
    { from: 201,  to: 300,  amount: 30.00, basis: 'flat' },
    { from: 301,  to: 400,  amount: 36.00, basis: 'flat' },
    { from: 401,  to: 500,  amount: 45.00, basis: 'flat' },
    { from: 501,  to: 750,  amount: 52.00, basis: 'flat' },
    { from: 751,  to: 1000, amount: 60.00, basis: 'flat' },
    { from: 1001, to: null, amount: 0.065, basis: 'per_kg' },
  ],
}

// Quality Transport (Air) — "Min S$10.00 or S$0.05 per kg".
const QUALITY_CLEARANCE = {
  charge_name: 'Import Terminal Clearance / Export Transfer',
  basis: 'per_kg',
  rate: 0.05,
  min_charge: 10.00,
}

// Cargohub (Sea) — "Transportation min $60.00 per job" + "$8.50 per M3".
const CARGOHUB_TRANSPORT = {
  charge_name: 'Transportation',
  basis: 'per_cbm',
  rate: 8.50,
  min_charge: 60.00,
}

// Cargohub (Sea) — "Over-time per hours $60.00 per job min 3 hours".
const CARGOHUB_OT = {
  charge_name: 'Over-time',
  basis: 'per_hour',
  rate: 60.00,
  min_qty: 3,
}

// ── Pattern 1: banded, flat per band ─────────────────────────────────────────

test('Quality delivery: 40 kg falls in the first band', () => {
  const r = computeRateAmount(QUALITY_DELIVERY, deriveMetrics({ weight: 40 }))
  assert.strictEqual(r.amount, 17.00)
})

test('Quality delivery: band edges are inclusive on both sides', () => {
  const at50 = computeRateAmount(QUALITY_DELIVERY, deriveMetrics({ weight: 50 }))
  const at51 = computeRateAmount(QUALITY_DELIVERY, deriveMetrics({ weight: 51 }))
  assert.strictEqual(at50.amount, 17.00, '50 kg is the top of the 001-50 band')
  assert.strictEqual(at51.amount, 22.00, '51 kg is the bottom of the 051-100 band')
})

test('Quality delivery: 1000 kg is still the last flat band', () => {
  const r = computeRateAmount(QUALITY_DELIVERY, deriveMetrics({ weight: 1000 }))
  assert.strictEqual(r.amount, 60.00)
})

test('Quality delivery: 1001 kg crosses into the open-ended per-kg band', () => {
  const r = computeRateAmount(QUALITY_DELIVERY, deriveMetrics({ weight: 1001 }))
  assert.strictEqual(r.amount, 65.07) // 1001 * 0.065
})

test('Quality delivery: a heavy shipment prices per kg, not flat', () => {
  const r = computeRateAmount(QUALITY_DELIVERY, deriveMetrics({ weight: 5000 }))
  assert.strictEqual(r.amount, 325.00) // 5000 * 0.065
  assert.match(r.workingNote, /0\.065/)
})

// ── Pattern 2: min charge vs per-unit, whichever is greater ──────────────────

test('Quality clearance: the minimum wins on a light shipment', () => {
  const r = computeRateAmount(QUALITY_CLEARANCE, deriveMetrics({ weight: 100 }))
  assert.strictEqual(r.amount, 10.00) // 100 * 0.05 = 5.00, below the 10.00 minimum
  assert.match(r.workingNote, /minimum/)
})

test('Quality clearance: the per-kg rate wins on a heavy shipment', () => {
  const r = computeRateAmount(QUALITY_CLEARANCE, deriveMetrics({ weight: 500 }))
  assert.strictEqual(r.amount, 25.00) // 500 * 0.05
  assert.doesNotMatch(r.workingNote, /minimum/)
})

test('Quality clearance: at the crossover the minimum still applies', () => {
  const r = computeRateAmount(QUALITY_CLEARANCE, deriveMetrics({ weight: 200 }))
  assert.strictEqual(r.amount, 10.00) // 200 * 0.05 = exactly 10.00
})

test('Cargohub transport: small volume falls back to the job minimum', () => {
  const r = computeRateAmount(CARGOHUB_TRANSPORT, deriveMetrics({ cbm: 4.2 }))
  assert.strictEqual(r.amount, 60.00) // 4.2 * 8.50 = 35.70, below the 60.00 minimum
})

test('Cargohub transport: larger volume prices per M3', () => {
  const r = computeRateAmount(CARGOHUB_TRANSPORT, deriveMetrics({ cbm: 20 }))
  assert.strictEqual(r.amount, 170.00) // 20 * 8.50
})

// ── Pattern 3: "whichever greater" across two metrics ────────────────────────

test('chargeable weight: volumetric beats gross for light, bulky cargo', () => {
  const m = deriveMetrics({ weight: 50, cbm: 1 })
  assert.strictEqual(m.chargeable_kg, 167) // 1 CBM * 167 > 50 kg gross
})

test('chargeable weight: gross beats volumetric for dense cargo', () => {
  const m = deriveMetrics({ weight: 800, cbm: 1 })
  assert.strictEqual(m.chargeable_kg, 800)
})

test('chargeable weight: the divisor is overridable per card', () => {
  const m = deriveMetrics({ weight: 50, cbm: 1 }, { volumetricDivisor: 1000 })
  assert.strictEqual(m.chargeable_kg, 1000)
})

test('revenue tonne: takes the greater of weight-in-tonnes and volume', () => {
  assert.strictEqual(deriveMetrics({ weight: 500, cbm: 2 }).revenue_tonne, 2)   // 0.5 t vs 2 M3
  assert.strictEqual(deriveMetrics({ weight: 3000, cbm: 2 }).revenue_tonne, 3)  // 3 t vs 2 M3
})

test('per_chargeable_kg prices off the derived figure, not gross weight', () => {
  const line = { basis: 'per_chargeable_kg', rate: 0.05 }
  const r = computeRateAmount(line, deriveMetrics({ weight: 50, cbm: 1 }))
  assert.strictEqual(r.amount, 8.35) // 167 * 0.05, not 50 * 0.05
})

// ── Pattern 5: minimum billable quantity ─────────────────────────────────────

test('Cargohub overtime: 1 hour is billed at the 3-hour minimum', () => {
  const r = computeRateAmount(CARGOHUB_OT, {}, { qty: 1 })
  assert.strictEqual(r.amount, 180.00) // 3 * 60.00
  assert.match(r.workingNote, /minimum/)
})

test('Cargohub overtime: above the minimum, actual hours are billed', () => {
  const r = computeRateAmount(CARGOHUB_OT, {}, { qty: 5 })
  assert.strictEqual(r.amount, 300.00) // 5 * 60.00
})

test('quantity-based charges require a quantity', () => {
  const r = computeRateAmount(CARGOHUB_OT, {}, {})
  assert.strictEqual(r.amount, null)
  assert.match(r.reason, /quantity/i)
})

// ── Pattern 4 + basis aliases ────────────────────────────────────────────────

test('flat surcharges ignore job metrics entirely', () => {
  const line = { charge_name: 'Jurong Island Surcharge', basis: 'flat', rate: 100 }
  assert.strictEqual(computeRateAmount(line, {}).amount, 100)
  assert.strictEqual(computeRateAmount(line, deriveMetrics({ weight: 9000 })).amount, 100)
})

test('vendor wordings for a flat charge all collapse to flat', () => {
  for (const b of ['per_job', 'per_trip', 'per_shipment', 'per_do', 'PER JOB']) {
    assert.strictEqual(normaliseBasis(b), 'flat', `${b} should normalise to flat`)
  }
  const r = computeRateAmount({ basis: 'per_trip', rate: 13 }, {})
  assert.strictEqual(r.amount, 13)
})

// ── Missing / degenerate input ───────────────────────────────────────────────

test('a metric-based rate reports what is missing instead of returning 0', () => {
  const r = computeRateAmount(QUALITY_CLEARANCE, deriveMetrics({}))
  assert.strictEqual(r.amount, null)
  assert.match(r.reason, /not set/)
})

test('a banded rate reports a missing metric instead of returning 0', () => {
  const r = computeRateAmount(QUALITY_DELIVERY, deriveMetrics({ cbm: 5 }))
  assert.strictEqual(r.amount, null)
  assert.match(r.reason, /not set/)
})

test('a weight below every band is reported, not silently priced', () => {
  const line = { basis: 'banded', band_metric: 'weight_kg', bands: [{ from: 100, to: 200, amount: 5 }] }
  const r = computeRateAmount(line, deriveMetrics({ weight: 10 }))
  assert.strictEqual(r.amount, null)
  assert.match(r.reason, /outside every band/)
})

test('no result is ever NaN', () => {
  const cases = [
    [{ basis: 'per_kg', rate: null }, deriveMetrics({ weight: 100 }), {}],
    [{ basis: 'flat', rate: null }, {}, {}],
    [{ basis: 'banded', band_metric: 'weight_kg', bands: null }, deriveMetrics({ weight: 100 }), {}],
    [{ basis: '' }, {}, {}],
    [{ basis: 'nonsense_basis', rate: 5 }, {}, {}],
  ]
  for (const [line, metrics, opts] of cases) {
    const r = computeRateAmount(line, metrics, opts)
    assert.strictEqual(r.amount, null, `${JSON.stringify(line)} should not produce a number`)
    assert.ok(r.reason, 'a null amount must always carry a reason')
  }
})

test('Postgres NUMERIC strings are handled as numbers', () => {
  // pg returns NUMERIC columns as strings unless a type parser is installed; the job
  // fields can arrive that way too, so the maths must not depend on it.
  const r = computeRateAmount({ basis: 'per_cbm', rate: '8.50', min_charge: '60.00' }, deriveMetrics({ cbm: '20' }))
  assert.strictEqual(r.amount, 170.00)
})

test('a zero rate is priced as zero rather than rejected', () => {
  // Cargohub lists "Uncrating ... $0.00 Please request for Quotation" as a placeholder.
  const r = computeRateAmount({ basis: 'flat', rate: 0 }, {})
  assert.strictEqual(r.amount, 0)
})
