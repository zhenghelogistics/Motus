# ZHL Job Movement — Operations Tool

Internal freight operations tool for Zhenghe Logistics. Tracks jobs, generates PDFs (quotations, delivery orders, accounts references), and provides a financial dashboard.

## Stack

- **Frontend** — React + Vite, deployed on Vercel
- **Backend** — Node/Express API routes via Vercel serverless functions
- **Database** — Supabase (PostgreSQL)
- **Auth** — Supabase Auth (magic link / email OTP)
- **PDF export** — jsPDF + html2canvas (client-side)

## Local development

```bash
# Install all dependencies
npm install

# Start frontend (port 5173) + backend API (port 3001) together
npm run dev
```

The frontend proxies `/api/*` to the local backend during development.

## Deployment

Push to `main` → Vercel auto-deploys frontend + API routes.

Environment variables required in Vercel:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` (for AI email/invoice parsing)

---

## Changelog

### 2026-05-05
- **Job Status Overview on Dashboard** — Toggleable status pills (New, In Progress, On Hold, Completed, Missing Costing) with live counts. Click any pill to see the jobs in that bucket.
- **Copy from Previous Job** — New job form can prefill shipper, consignee, addresses and mode from any past job.
- **Customer Autocomplete** — Customer name field in new job searches past jobs as you type.
- **Dimension Boxes with CBM Auto-Calc** — Per-box L×W×H grid replaces flat dimension input; CBM and volumetric weight calculated automatically.
- **Delivery Order Modal** — DO button opens an edit modal; choose Local DO, International DO, or both before generating.

### 2026-05-04
- **Air Freight & LCL modes** — Added Air Freight and LCL as selectable job modes.
- **Local & International Delivery Orders** — DO split into two separate templates; both can be generated from a single job.
- **Performance** — Fixed N+1 query on jobs list; dashboard runs 7 queries in parallel.
- **KPI cards** — Fixed NaN display when PostgreSQL returns numeric strings.
- **GP% trend chart** — Zero-fills missing months so the 6-month chart always renders correctly.

### 2026-04-30
- **Logo on all PDFs** — Zhenghe Logistics logo added to Quotation, Accounts Reference, Local DO, International DO.
- **Notes section on all PDFs** — Job notes now appear on every export.
- **Dimension input redesign** — Vertical layout with add/remove box buttons and a CBM breakdown panel.
