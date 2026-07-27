const test = require('node:test')
const assert = require('node:assert/strict')
const { buildConversionNotes, mapLeadToJobFields } = require('./leadConversion')

test('buildConversionNotes includes the lead ref and company name', () => {
  const lead = { ref: 'ZL-123', customer_name: 'Amandari', quoted_price: 0, notes: '' }
  const notes = buildConversionNotes(lead)
  assert.match(notes, /Converted from Lead ZL-123 \(Amandari\)\./)
})

test('buildConversionNotes falls back to "unnamed" when there is no company name', () => {
  const notes = buildConversionNotes({ ref: 'ZL-1', customer_name: '', quoted_price: 0, notes: '' })
  assert.match(notes, /\(unnamed\)/)
})

test('buildConversionNotes includes the quoted price as a reference figure, not a charge', () => {
  const notes = buildConversionNotes({ ref: 'ZL-1', customer_name: 'Acme', quoted_price: 1234.5, notes: '' })
  assert.match(notes, /Estimator reference price \(not billed\): \$1234\.50/)
})

test('buildConversionNotes omits the price line entirely when there is no quote yet', () => {
  const notes = buildConversionNotes({ ref: 'ZL-1', customer_name: 'Acme', quoted_price: 0, notes: '' })
  assert.doesNotMatch(notes, /Estimator reference price/)
})

test('buildConversionNotes appends the original lead notes after a separator', () => {
  const notes = buildConversionNotes({ ref: 'ZL-1', customer_name: 'Acme', quoted_price: 0, notes: 'MODE: SEA | ROUTE: SG -> LA' })
  assert.match(notes, /---\nMODE: SEA \| ROUTE: SG -> LA$/)
})

test('mapLeadToJobFields leaves shipper/consignee out entirely (not part of the job field set)', () => {
  const fields = mapLeadToJobFields({ ref: 'ZL-1', customer_name: 'Acme', quoted_price: 0, notes: '' }, 'Sea FCL')
  assert.equal('shipper' in fields, false)
  assert.equal('consignee' in fields, false)
})

test('mapLeadToJobFields carries the contact/company fields onto the matching job columns', () => {
  const lead = {
    ref: 'ZL-1', customer_name: 'Acme', contact_person: 'Jane Tan', phone_number: '+65 9123 4567',
    customer_email: 'jane@acme.com', quoted_price: 0, notes: '',
  }
  const fields = mapLeadToJobFields(lead, 'Air Freight')
  assert.equal(fields.customer_name, 'Acme')
  assert.equal(fields.customer_contact_name, 'Jane Tan')
  assert.equal(fields.customer_contact_number, '+65 9123 4567')
  assert.equal(fields.customer_email, 'jane@acme.com')
  assert.equal(fields.mode, 'Air Freight')
  assert.equal(fields.status, 'New')
})

test('mapLeadToJobFields parses weight/packages from text fields, or null if not numeric', () => {
  const lead = { ref: 'ZL-1', customer_name: 'Acme', quoted_price: 0, notes: '', lead_weight: '450.5', lead_quantity: '12' }
  const fields = mapLeadToJobFields(lead, 'Sea LCL')
  assert.equal(fields.weight, 450.5)
  assert.equal(fields.packages, 12)

  const blank = mapLeadToJobFields({ ref: 'ZL-2', customer_name: 'Acme', quoted_price: 0, notes: '' }, 'Sea LCL')
  assert.equal(blank.weight, null)
  assert.equal(blank.packages, null)
})

test('mapLeadToJobFields prefers quote_ref for customer_ref, falling back to the lead ref', () => {
  const withQuoteRef = mapLeadToJobFields({ ref: 'ZL-1', quote_ref: 'Q-99', customer_name: 'Acme', quoted_price: 0, notes: '' }, 'Sea FCL')
  assert.equal(withQuoteRef.customer_ref, 'Q-99')

  const withoutQuoteRef = mapLeadToJobFields({ ref: 'ZL-1', customer_name: 'Acme', quoted_price: 0, notes: '' }, 'Sea FCL')
  assert.equal(withoutQuoteRef.customer_ref, 'ZL-1')
})
