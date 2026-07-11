# Development & Operations

Technical reference for working on Motus (the ZHL Job Movement tool). For a
high-level overview of what the product does, see the [README](README.md).

## Stack

- **Frontend** — React 18 + Vite, React Router, Recharts (charts), deployed on Vercel
- **Backend** — Node/Express, exposed as a single Vercel serverless function (`api/index.js`)
- **Database** — Supabase (PostgreSQL), accessed via `pg`
- **Auth** — Supabase Auth (magic link / email OTP); the API verifies the Supabase JWT
- **File storage** — Supabase Storage (`documents` bucket)
- **AI** — Anthropic Claude (`@anthropic-ai/sdk`) for email/invoice/DO/packing-list parsing and lead email drafting
- **FX rates** — Yahoo Finance (`yahoo-finance2`), synced daily via a Vercel cron
- **PDF export** — jsPDF + jspdf-autotable (client-side)

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
- `RFQ_SHARED_SECRET` — optional. When set, `POST /api/rfq` requires a matching `x-rfq-secret` header (the Zhenghe site sends it server-side). Leave unset to keep `/rfq` fully public.
- `TRACKING_API_SECRET` — optional. When set, `GET /api/track` (public shipment tracking for the Zhenghe site) requires `Authorization: Bearer <secret>`. Leave unset to keep tracking open.
- `CUSTOMER_API_SECRET` — **required** to enable `GET /api/customer/documents` and `GET /api/customer/invoices` (Zhenghe site customer portal). Unlike the two above, these are unset-by-default *disabled* (503), not unset-by-default open — they return billing amounts and document links scoped only by an email string, so there's no safe fully-public mode.

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
</content>
