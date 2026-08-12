// Rate-card money math, kept as pure functions so it can be unit-tested without a
// database or a live job — same reasoning as cargoLines.js and leadConversion.js.
// The route handlers own all reads/writes; this file only does arithmetic.
//
// The shapes here come from two real vendor cards (Quality Transport = Air,
// Cargohub = Sea). Between them they use five pricing patterns, all supported below:
//   1. weight/count bands where each band is a flat amount, and the top band may
//      switch to a per-unit rate  (Quality: 001-50kg -> $17 ... 1001+ -> $0.065/kg)
//   2. "min $X or $Y per unit, whichever is greater"  (Quality clearance: min $10 or $0.05/kg)
//   3. "whichever greater" across two metrics — chargeable weight (gross vs volumetric)
//      and revenue tonne (weight vs volume)  (Cargohub: per M3 or per RT)
//   4. flat conditional surcharges the coordinator ticks (Jurong Island, DG, tailgate...)
//   5. a minimum billable quantity  (Cargohub overtime: $60/hr, min 3 hours)

// IATA volumetric standard is 1:6000, i.e. 1 m^3 = 166.67 kg. Rounded to 167, which is
// what freight desks quote in practice. Overridable per card because sea/courier use
// different divisors (e.g. 1000 for road, 200 for courier).
const VOLUMETRIC_DIVISOR_DEFAULT = 167

// Bases whose quantity cannot be derived from the job and must be entered by the
// coordinator at pick time (how many hours of overtime, how many extra men, etc).
const QTY_BASES = ['per_pallet', 'per_carton', 'per_head', 'per_hour', 'per_unit']

// Bases that read a number straight off the job.
const METRIC_BY_BASIS = {
  per_kg: 'weight_kg',
  per_chargeable_kg: 'chargeable_kg',
  per_cbm: 'cbm',
  per_rt: 'revenue_tonne',
}

// Vendors write the same idea a dozen ways ("per job", "per trip", "per D/O",
// "per shipment"). They all mean "one flat charge", so collapse them rather than
// making the data-entry screen care about the distinction.
const BASIS_ALIASES = {
  per_job: 'flat',
  per_trip: 'flat',
  per_shipment: 'flat',
  per_do: 'flat',
  fixed: 'flat',
}

const METRIC_LABELS = {
  weight_kg: 'kg',
  chargeable_kg: 'kg chargeable',
  cbm: 'M3',
  revenue_tonne: 'RT',
  packages: 'pkg',
}

function num(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(v)
  return Number.isFinite(n) ? n : null
}

// Money is rounded to cents at the very end only — rounding mid-calculation is how
// banded rates drift a cent away from what the vendor invoices.
function money(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

function fmt(n) {
  return money(n).toFixed(2)
}

function normaliseBasis(basis) {
  // Fold spaces and hyphens to underscores so "per job", "PER JOB" and "per-job"
  // all land on the same key — vendor cards are not consistent about this.
  const b = String(basis || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  return BASIS_ALIASES[b] || b
}

/**
 * Turn a job row into the numbers a rate line can be priced against.
 * Accepts a raw job (weight / cbm / packages may be strings from Postgres NUMERIC).
 */
function deriveMetrics(job, opts = {}) {
  const divisor = num(opts.volumetricDivisor) || VOLUMETRIC_DIVISOR_DEFAULT
  const weight_kg = num(job && job.weight)
  const cbm = num(job && job.cbm)
  const packages = num(job && job.packages)

  // Pattern 3. Both are "whichever is greater" comparisons, and both need BOTH
  // inputs to be meaningful — if only one is known, that one stands in, which
  // matches how a forwarder would price it off an incomplete booking.
  let chargeable_kg = null
  if (weight_kg !== null || cbm !== null) {
    chargeable_kg = Math.max(weight_kg || 0, (cbm || 0) * divisor)
  }
  let revenue_tonne = null
  if (weight_kg !== null || cbm !== null) {
    revenue_tonne = Math.max((weight_kg || 0) / 1000, cbm || 0)
  }

  return { weight_kg, cbm, packages, chargeable_kg, revenue_tonne }
}

// Bands are inclusive at both ends; `to: null` means the top band is open-ended.
function findBand(bands, metric) {
  if (!Array.isArray(bands)) return null
  for (const b of bands) {
    const from = num(b.from)
    const to = num(b.to)
    const lowOk = from === null || metric >= from
    const highOk = to === null || b.to === null || b.to === undefined || metric <= to
    if (lowOk && highOk) return b
  }
  return null
}

/**
 * Price a single rate line against a job.
 *
 * @param  line    a rate_lines row
 * @param  metrics output of deriveMetrics()
 * @param  opts    { qty } — required for QTY_BASES (per_hour, per_head, ...)
 * @return { amount, workingNote }  on success
 *         { amount: null, reason } when the job/input lacks what the basis needs,
 *         so the caller can say "job weight not set" instead of inserting a silent 0
 */
function computeRateAmount(line, metrics = {}, opts = {}) {
  const basis = normaliseBasis(line && line.basis)
  if (!basis) return { amount: null, reason: 'No pricing basis set on this rate.' }

  const rate = num(line.rate)
  const minCharge = num(line.min_charge)
  const minQty = num(line.min_qty)

  let gross
  let note

  if (basis === 'flat') {
    if (rate === null) return { amount: null, reason: 'No rate set.' }
    gross = rate
    note = `Flat ${fmt(rate)}`

  } else if (basis === 'banded') {
    const metricKey = line.band_metric || 'weight_kg'
    const metric = num(metrics[metricKey])
    if (metric === null || metric <= 0) {
      return { amount: null, reason: `Job ${METRIC_LABELS[metricKey] || metricKey} is not set.` }
    }
    const band = findBand(line.bands, metric)
    if (!band) {
      return { amount: null, reason: `${metric} ${METRIC_LABELS[metricKey] || metricKey} falls outside every band on this rate.` }
    }
    const bandAmount = num(band.amount)
    if (bandAmount === null) return { amount: null, reason: 'Matched band has no amount.' }

    const label = `${num(band.from) ?? 0}${band.to === null || band.to === undefined ? '+' : `-${band.to}`}`
    const unit = METRIC_LABELS[metricKey] || metricKey
    // Pattern 1: a band carries its own basis, so the top band can switch to per-unit.
    if (normaliseBasis(band.basis) === 'flat' || !band.basis) {
      gross = bandAmount
      note = `${metric} ${unit} → band ${label} → ${fmt(bandAmount)}`
    } else {
      gross = bandAmount * metric
      note = `${metric} ${unit} → band ${label} @ ${bandAmount}/${unit} = ${fmt(gross)}`
    }

  } else if (QTY_BASES.includes(basis)) {
    if (rate === null) return { amount: null, reason: 'No rate set.' }
    let qty = num(opts.qty)
    if (qty === null || qty <= 0) {
      return { amount: null, reason: 'Enter a quantity for this charge.' }
    }
    // Pattern 5: a minimum billable quantity (e.g. overtime charged at 3 hours minimum).
    let minNote = ''
    if (minQty !== null && qty < minQty) {
      minNote = ` (${qty} entered, ${minQty} minimum)`
      qty = minQty
    }
    gross = rate * qty
    note = `${fmt(rate)} × ${qty}${minNote} = ${fmt(gross)}`

  } else if (METRIC_BY_BASIS[basis]) {
    if (rate === null) return { amount: null, reason: 'No rate set.' }
    const metricKey = METRIC_BY_BASIS[basis]
    const metric = num(metrics[metricKey])
    if (metric === null || metric <= 0) {
      return { amount: null, reason: `Job ${METRIC_LABELS[metricKey] || metricKey} is not set.` }
    }
    gross = rate * metric
    note = `${rate} × ${metric} ${METRIC_LABELS[metricKey]} = ${fmt(gross)}`

  } else {
    return { amount: null, reason: `Unknown pricing basis "${line.basis}".` }
  }

  // Pattern 2, applied last: the vendor bills the greater of the computed figure and
  // the stated minimum ("Min $10.00 or $0.05 per kg").
  if (minCharge !== null && gross < minCharge) {
    return {
      amount: money(minCharge),
      workingNote: `${note} → minimum ${fmt(minCharge)} applied`,
    }
  }

  return { amount: money(gross), workingNote: note }
}

module.exports = {
  VOLUMETRIC_DIVISOR_DEFAULT,
  QTY_BASES,
  METRIC_BY_BASIS,
  deriveMetrics,
  computeRateAmount,
  normaliseBasis,
}
