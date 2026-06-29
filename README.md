# ZHL Job Movement — Operations Tool

Internal freight operations tool for Zhenghe Logistics ("Motus"). It tracks jobs end to
end, generates client-ready PDFs (quotations, delivery orders, accounts references), runs a
financial dashboard, manages sales leads, and uses AI to parse incoming emails and documents
into structured job data.

## Stack

- **Frontend** — React 18 + Vite, React Router, Recharts (charts), deployed on Vercel
- **Backend** — Node/Express, exposed as a single Vercel serverless function (`api/index.js`)
- **Database** — Supabase (PostgreSQL), accessed via `pg`
- **Auth** — Supabase Auth (magic link / email OTP); the API verifies the Supabase JWT
- **File storage** — Supabase Storage (`documents` bucket)
- **AI** — Anthropic Claude (`@anthropic-ai/sdk`) for email/invoice/DO/packing-list parsing and lead email drafting
- **FX rates** — Yahoo Finance (`yahoo-finance2`), synced daily via a Vercel cron
- **PDF export** — jsPDF + jspdf-autotable (client-side)

## Features

- **Dashboard** — KPI cards, GP% trend chart, revenue-share-by-mode pie chart, and a
  toggleable Job Status overview.
- **Movement Tracker** (`/jobs`) — the job list: create, search, filter, and open jobs;
  generate Quotation, Local/International Delivery Order, Release D/O, and Accounts Reference PDFs.
- **Job Detail** (`/jobs/:id`) — costing and billing lines, documents, dimension/CBM
  breakdown, and inventory linking/sync.
- **Quote Calculator** (`/quote`) — build a quote with markup, pick standard remarks, and
  export a branded Quotation PDF.
- **Email Intake** (`/intake`) — paste or upload an email/invoice/DO/packing list and let
  Claude extract structured fields to pre-fill a job.
- **Leads / CRM** (`/leads`) — capture leads, claim them, draft outreach emails with AI;
  old leads are auto-purged via a daily cron.
- **Company Stats** (`/stats`) — per-company performance breakdowns.
- **My Account** — set display name, job title, and a drawn/uploaded signature that is
  embedded into exported Quotation PDFs.
- **In-app Changelog** — a "What's New" feed sourced from `frontend/src/changelog.js`.

## Project layout

```
api/index.js        # Vercel serverless Express app — the entire backend API
package.json        # API dependencies (installed by Vercel)
frontend/           # React + Vite app
vercel.json         # Vercel build, routing, function, and cron config
```

## Development workflow

There is no local server — the app runs only on Vercel. To make changes:

1. Edit `api/index.js` (backend) and/or files under `frontend/src/`.
2. Commit and push to `main`.
3. Vercel auto-deploys; check the change on the live site.

## Environment variables

Set these in the Vercel project settings:

- `DATABASE_URL` — Supabase Postgres connection string
- `SUPABASE_URL` — Supabase project URL (storage)
- `SUPABASE_SERVICE_KEY` — Supabase service role key (storage + privileged DB access)
- `SUPABASE_JWT_SECRET` — base64 JWT secret used to verify auth tokens
- `ANTHROPIC_API_KEY` — Claude API key for AI parsing / drafting

The frontend needs the Supabase anon credentials (see `frontend/src/lib/supabase.js`),
configured via Vite env vars.

## Deployment

Push to `main` → Vercel auto-deploys the frontend and the `api/index.js` serverless function.

Scheduled jobs (Vercel cron, see `vercel.json`):
- `GET /api/fx-rates/sync` — daily at 16:00 (refresh FX rates)
- `GET /api/leads/purge-old` — daily at 02:00 (purge stale leads)

## Changelog

The maintained changelog lives in [`frontend/src/changelog.js`](frontend/src/changelog.js)
and is shown in-app under "What's New". Add new entries at the top of that file.
