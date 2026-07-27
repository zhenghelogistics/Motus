// Pure mapping/formatting logic for turning a Won lead into a job, pulled out
// of the /api/leads/:id/convert-to-job route handler so it's testable without
// a live database. The route handler still owns the DB reads/writes; this
// module only decides what values a job should be created with.

function buildConversionNotes(lead) {
  const parts = [`Converted from Lead ${lead.ref} (${lead.customer_name || 'unnamed'}).`]
  if (Number(lead.quoted_price) > 0) {
    parts.push(`Estimator reference price (not billed): $${Number(lead.quoted_price).toFixed(2)}`)
  }
  if (lead.notes) parts.push('---', lead.notes)
  return parts.join('\n')
}

// Shipper and consignee are intentionally omitted — the RFQ form only
// captures one company and one pickup/delivery address, not a clean
// shipper-vs-consignee split, so those stay blank for staff to fill in.
// quoted_price never becomes a billing line; it only ever appears inside
// the notes text via buildConversionNotes, as an unreviewed reference figure.
function mapLeadToJobFields(lead, mode) {
  const weight = parseFloat(lead.lead_weight)
  const packages = parseInt(lead.lead_quantity, 10)
  return {
    mode,
    status: 'New',
    notes: buildConversionNotes(lead),
    customer_name: lead.customer_name || '',
    customer_contact_name: lead.contact_person || '',
    customer_contact_number: lead.phone_number || '',
    customer_email: lead.customer_email || '',
    pickup_address: lead.pickup_address || '',
    delivery_address: lead.delivery_address || '',
    commodity: lead.commodity_name || '',
    dimensions: lead.lead_dimensions || '',
    weight: Number.isFinite(weight) ? weight : null,
    packages: Number.isFinite(packages) ? packages : null,
    customer_ref: lead.quote_ref || lead.ref,
  }
}

module.exports = { buildConversionNotes, mapLeadToJobFields }
