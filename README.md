<div align="center">

# 🚢 Motus

### The freight operations platform that runs the Zhenghe Logistics desk.

From first enquiry to final delivery — track every job, watch every margin,
and generate every client-ready document in one place.

<br>

`React + Vite` · `Supabase` · `Express on Vercel` · `Claude AI` · `Live FX`

</div>

---

## Why Motus

Freight forwarding lives in spreadsheets, inboxes, and PDF templates scattered
across a dozen folders. Motus pulls all of it into a single, fast web app — so
the team spends less time copy-pasting and more time moving cargo.

Paste in an enquiry email and watch Claude turn it into a structured job.
Build a quote, see the margin live, and export a branded PDF in one click. Open
the dashboard and know exactly where every shipment — and every dollar — stands.

## ✨ Features

### 📊 Financial Dashboard
KPI cards, a GP% trend line, a revenue-share-by-mode pie chart, and a live job
status overview — your whole operation at a glance the moment you log in.

### 🚚 Movement Tracker
The command center for every job. Create, search, and filter shipments, then
generate any document you need on the spot.

### 🤖 AI Email & Document Intake
Paste or upload an email, invoice, delivery order, or packing list and let
Claude extract the fields and pre-fill a new job — no more manual re-typing.

### 🧮 Quote Calculator
Build line-by-line freight quotes with per-line and global markups, a GST
toggle, and SGD/USD support. Pick from standard remarks, see the final price
update live, and export a clean, branded quotation.

### 🧾 One-Click PDFs
Quotations, Local & International Delivery Orders, Release D/Os, Subsidiary
Export Certificates, and Accounts References — all branded, all client-ready,
all generated in the browser.

### 💱 Live FX Rates
Currency rates refresh automatically every day from Yahoo Finance, with a
manual override when you need to lock a rate.

### 👥 Leads / CRM
Capture and claim sales leads, draft outreach emails with AI, and never lose
track of a prospect — stale leads are auto-cleaned daily.

### 📈 Company Stats
Per-company performance, broken down monthly or yearly by mode of transport —
packages, weight, CBM, revenue, cost, profit, and GP%.

### ✍️ Personal Signatures
Each team member sets their own name, title, and signature (drawn or uploaded),
embedded automatically into the quotations they send.

## 🛠 Built With

| Layer | Tech |
|-------|------|
| Frontend | React 18, Vite, React Router, Recharts |
| Backend | Node/Express on Vercel serverless |
| Database | Supabase (PostgreSQL) |
| Auth & Storage | Supabase Auth + Storage |
| AI | Anthropic Claude |
| FX rates | Yahoo Finance |
| PDF export | jsPDF |

## 🚀 Deployment

Motus runs entirely on Vercel — push to `main` and it deploys itself, frontend
and API together. Scheduled crons keep FX rates fresh and the leads pipeline tidy.

## 📓 What's New

Recent updates live in the in-app **"What's New"** feed, sourced from
[`frontend/src/changelog.js`](frontend/src/changelog.js).

## 🧑‍💻 For Developers

Setup, architecture, environment variables, and the deploy workflow are
documented in **[DEVELOPMENT.md](DEVELOPMENT.md)**.

<div align="center">
<br>
Built for <strong>Zhenghe Logistics</strong> 🇸🇬
</div>
