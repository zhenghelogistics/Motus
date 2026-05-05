// Add new entries at the TOP. Each entry needs: id, date (YYYY-MM-DD), title, description.
// Optional: route (app path) + routeLabel (button text) to let users jump straight to the feature.

export const CHANGELOG = [
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
