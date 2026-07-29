const test = require('node:test')
const assert = require('node:assert/strict')
const { parseCargoLinesFromNotes, extractCargoLines } = require('./cargoLines')

const REAL_WORLD_NOTES = `QUOTE Q-MS5FJF9E | RATE rate-manual-review | PRICE SGD 0 | BOOKING BR-MS5FJUJB
Declared value: SGD 1100
CARGO LINES (3):
  1. LCL × 14 — 1960kg — Banana Milk — HS 1050
  2. 40' container × 1 — 1000kg — Hungry Chicken
  3. 20' reefer × 1 — 10000kg — Birds flying
ORIGIN FACILITY: im testing
DEST FACILITY: im testing output`

test('parseCargoLinesFromNotes extracts all three lines from the real site format', () => {
  const lines = parseCargoLinesFromNotes(REAL_WORLD_NOTES)
  assert.equal(lines.length, 3)
  assert.deepEqual(lines[0], { cargoType: 'LCL', qty: 14, weightKg: 1960, commodity: 'Banana Milk', hsCode: '1050' })
  assert.deepEqual(lines[1], { cargoType: "40' container", qty: 1, weightKg: 1000, commodity: 'Hungry Chicken', hsCode: '' })
  assert.deepEqual(lines[2], { cargoType: "20' reefer", qty: 1, weightKg: 10000, commodity: 'Birds flying', hsCode: '' })
})

test('parseCargoLinesFromNotes returns an empty array for single-cargo notes with no CARGO LINES block', () => {
  const notes = 'MODE: SEA | ROUTE: Singapore → Jakarta\nSERVICE: Door-Door | INCOTERM: FOB | LOAD: FCL'
  assert.deepEqual(parseCargoLinesFromNotes(notes), [])
})

test('parseCargoLinesFromNotes returns an empty array for null/empty input', () => {
  assert.deepEqual(parseCargoLinesFromNotes(''), [])
  assert.deepEqual(parseCargoLinesFromNotes(null), [])
  assert.deepEqual(parseCargoLinesFromNotes(undefined), [])
})

test('parseCargoLinesFromNotes ignores unrelated lines mixed in with real cargo lines', () => {
  const notes = 'Some preamble text\n1. LCL × 2 — 500kg — Widgets\nORIGIN FACILITY: test\nnot a cargo line at all'
  const lines = parseCargoLinesFromNotes(notes)
  assert.equal(lines.length, 1)
  assert.equal(lines[0].commodity, 'Widgets')
})

test('extractCargoLines prefers a structured cargoLines array over text parsing', () => {
  const body = {
    cargoLines: [
      { cargoType: 'LCL', itemCount: 5, weightKg: 200, commodity: 'Toys', hsCode: '9503' },
    ],
    specialHandlingNotes: REAL_WORLD_NOTES, // should be ignored since structured data is present
  }
  const lines = extractCargoLines(body, body.specialHandlingNotes)
  assert.equal(lines.length, 1)
  assert.deepEqual(lines[0], { cargoType: 'LCL', qty: 5, weightKg: 200, commodity: 'Toys', hsCode: '9503' })
})

test('extractCargoLines accepts snake_case cargo_lines as an alternate structured field name', () => {
  const body = { cargo_lines: [{ type: 'FCL20', qty: 1, wt: 3000, commodity: 'Machinery' }] }
  const lines = extractCargoLines(body, '')
  assert.deepEqual(lines, [{ cargoType: 'FCL20', qty: 1, weightKg: 3000, commodity: 'Machinery', hsCode: '' }])
})

test('extractCargoLines falls back to text parsing when no structured field is present', () => {
  const lines = extractCargoLines({}, REAL_WORLD_NOTES)
  assert.equal(lines.length, 3)
  assert.equal(lines[0].commodity, 'Banana Milk')
})

test('extractCargoLines returns an empty array for a plain single-cargo RFQ (no cargo lines at all)', () => {
  assert.deepEqual(extractCargoLines({}, 'MODE: SEA | ROUTE: A → B'), [])
})
