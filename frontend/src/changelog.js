// Add new entries at the TOP. Each entry needs: id, date (YYYY-MM-DD), title, description.
// Optional: route (app path) + routeLabel (button text) to let users jump straight to the feature.

export const CHANGELOG = [
  {
    id: 'remarks-selector',
    date: '2026-05-28',
    title: 'Remarks Selector in Quote Calculator',
    description:
      '20 standard freight remarks are now selectable from the Quote Calculator. Tick the ones relevant to your quote — they appear in the Quotation PDF and in the copied quote text. Add your own custom remarks for anything not on the list. Defaults to the most universally applicable clauses.',
    route: '/quote',
    routeLabel: 'Open Quote Calculator',
  },
  {
    id: 'release-do',
    date: '2026-05-28',
    title: 'Release D/O PDF',
    description:
      'A "Release D/O" button is now on every job. Click it, confirm the collecting company (pre-filled from consignee), enter the vehicle number, and adjust the description and package count if needed. Generates a Release Delivery Order PDF with a cargo description table, item breakdown (if a packing list exists), and an acknowledgement block for the collector\'s signature and company stamp.',
    route: '/jobs',
    routeLabel: 'Open Movement Tracker',
  },
  {
    id: 'quotation-pdf',
    date: '2026-05-27',
    title: 'Quotation PDF Generator',
    description:
      'Generate a branded, client-ready Quotation PDF straight from the Quote Calculator. Fill in the recipient details (company, address, contact, validity), hit Generate — the PDF includes the ZHL header, a charges table with your markup hidden from the client, selected remarks, and a two-column signature block with your signature on the left and an acknowledgement space for the customer on the right. File is named CompanyName_DDMmmYYYY_Quotation.pdf automatically.',
    route: '/quote',
    routeLabel: 'Open Quote Calculator',
  },
  {
    id: 'account-settings',
    date: '2026-05-27',
    title: 'My Account — Signature & Profile',
    description:
      'Click "My Account" at the bottom of the sidebar to set your display name, job title, and signature. Draw directly on the canvas or upload a PNG/JPG. Your signature is stored per user and embedded automatically in all exported Quotation PDFs.',
    route: null,
    routeLabel: null,
  },
  {
    id: 'leads-badge',
    date: '2026-05-26',
    title: 'New Leads Badge',
    description:
      'A red badge on the Leads Pipeline tab shows how many new leads have come in since you last visited. Each user\'s count is tracked independently — the badge clears when you open the page. Updates every 60 seconds automatically.',
    route: '/leads',
    routeLabel: 'Open Leads Pipeline',
  },
  {
    id: 'quote-calculator',
    date: '2026-05-12',
    title: 'Quote Calculator',
    description:
      'New Quote Calculator page for sales reps. Build line-by-line freight breakdowns with per-line markups, a global markup %, optional GST 9% toggle, and a live final price. Generates a clean monospace client quote you can copy in one click. Supports SGD / USD, route + mode details, and quick-add buttons for common charges.',
    route: '/quote',
    routeLabel: 'Open Quote Calculator',
  },
  {
    id: 'company-stats-noa-mirror',
    date: '2026-05-12',
    title: 'Company Stats Dashboard + NOA/GST Auto-Mirror',
    description:
      'New "Company Stats" page: search any company and view monthly or yearly breakdowns by mode of transport (packages, weight, CBM, revenue, cost, profit, GP%). Also: saving a cost line with "NOA", "Notice of Arrival", "GST", or "Goods and Services Tax" in the service field now automatically creates a matching billing line if one doesn\'t already exist.',
    route: '/stats',
    routeLabel: 'Open Company Stats',
  },
  {
    id: 'subcert-export',
    date: '2026-05-05',
    title: 'Subsidiary Export Certificate PDF',
    description:
      'A "Sub Cert" button is now on every job. Click it, enter ETD Singapore, Outward Permit No, and Destination — everything else (exporter, consignee, invoice details, weight) is pre-filled from the job. Generates a properly formatted Subsidiary Export Certificate PDF for GST claims.',
    route: '/jobs',
    routeLabel: 'Open Movement Tracker',
  },
  {
    id: 'job-status-widget',
    date: '2026-05-05',
    title: 'Job Status Overview on Dashboard',
    description:
      'The dashboard now shows a live breakdown of jobs by status. Click New, In Progress, On Hold, Completed, or ⚠ Missing Costing to see the actual jobs in that bucket — with deadlines and clickable links.',
    route: '/',
    routeLabel: 'Open Dashboard',
  },
  {
    id: 'copy-job-customer-dims-do-modal',
    date: '2026-05-05',
    title: 'Copy Previous Job · Customer Autocomplete · Dimension Boxes · DO Modal',
    description:
      'New job form: "Copy from previous job" pre-fills shipper, consignee, addresses and mode from any past job. Customer name now autocompletes from previous jobs. Dimensions use a per-box L×W×H grid with automatic CBM calculation. The Delivery Order button now opens a modal to edit details and choose Local DO, International DO, or both.',
    route: '/intake',
    routeLabel: 'Try New Job',
  },
  {
    id: 'air-lcl-modes',
    date: '2026-05-04',
    title: 'Air Freight & LCL Shipping Modes',
    description:
      'Air Freight and LCL (Less than Container Load) are now selectable job modes alongside FCL and Road. Delivery Order templates are adjusted for each mode.',
    route: '/intake',
    routeLabel: 'New Job',
  },
  {
    id: 'local-intl-do',
    date: '2026-05-04',
    title: 'Local & International Delivery Orders',
    description:
      'Delivery Orders are now split into Local DO (Singapore deliveries) and International DO (cross-border shipments). Both can be generated from a single job in one go.',
    route: null,
    routeLabel: null,
  },
  {
    id: 'pdf-logo-notes',
    date: '2026-04-30',
    title: 'Logo & Notes on All PDFs',
    description:
      'All exported PDFs — Quotation, Accounts Reference, Local DO, International DO — now include the Zhenghe Logistics logo, updated contact details, and a Notes section.',
    route: null,
    routeLabel: null,
  },
]
