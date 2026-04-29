require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { DatabaseSync } = require('node:sqlite');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Ensure uploads directory exists
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Database
const db = new DatabaseSync(path.join(__dirname, 'zhl.db'));
db.exec('PRAGMA journal_mode=WAL');
db.exec('PRAGMA foreign_keys=ON');

// Anthropic client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─── DB INIT ─────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_number TEXT UNIQUE NOT NULL,
    year INTEGER NOT NULL,
    sequence INTEGER NOT NULL,
    shipper TEXT DEFAULT '',
    consignee TEXT DEFAULT '',
    weight REAL,
    packages INTEGER,
    dimensions TEXT DEFAULT '',
    cbm REAL,
    pickup_address TEXT DEFAULT '',
    pickup_contact_name TEXT DEFAULT '',
    pickup_contact_number TEXT DEFAULT '',
    delivery_address TEXT DEFAULT '',
    delivery_contact_name TEXT DEFAULT '',
    delivery_contact_number TEXT DEFAULT '',
    date_out TEXT,
    date_delivered TEXT,
    agent TEXT DEFAULT '',
    mode TEXT DEFAULT 'Local Delivery',
    status TEXT DEFAULT 'New',
    customer_ref TEXT DEFAULT '',
    deadline_date TEXT,
    commodity TEXT DEFAULT '',
    notes TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS cost_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    vendor TEXT DEFAULT '',
    amount REAL DEFAULT 0,
    invoice_no TEXT DEFAULT '',
    invoice_date TEXT,
    service TEXT DEFAULT '',
    remarks TEXT DEFAULT '',
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS billing_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    service TEXT DEFAULT '',
    unit TEXT DEFAULT '',
    rate REAL DEFAULT 0,
    qty REAL DEFAULT 1,
    remarks TEXT DEFAULT '',
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    file_name TEXT NOT NULL,
    doc_type TEXT DEFAULT 'Other',
    upload_date TEXT DEFAULT (datetime('now')),
    file_path TEXT NOT NULL,
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE
  );
`);

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function enrichJob(job) {
  const costs = db.prepare('SELECT COALESCE(SUM(amount),0) as total FROM cost_lines WHERE job_id=?').get(job.id);
  const billing = db.prepare('SELECT COALESCE(SUM(rate*qty),0) as total FROM billing_lines WHERE job_id=?').get(job.id);
  const cost_sgd = parseFloat((costs.total || 0).toFixed(2));
  const sale_sgd = parseFloat((billing.total || 0).toFixed(2));
  const profit_sgd = parseFloat((sale_sgd - cost_sgd).toFixed(2));
  const computed_gp = sale_sgd > 0 ? parseFloat(((profit_sgd / sale_sgd) * 100).toFixed(1)) : 0;
  const gp_percent = job.gp_override != null ? parseFloat(Number(job.gp_override).toFixed(1)) : computed_gp;
  return { ...job, cost_sgd, sale_sgd, profit_sgd, gp_percent, computed_gp };
}

function generateJobNumber() {
  const year = new Date().getFullYear() % 100;
  const row = db.prepare('SELECT COALESCE(MAX(sequence),0) as max_seq FROM jobs WHERE year=?').get(year);
  const seq = (row.max_seq || 0) + 1;
  const job_number = `ZHL-${String(seq).padStart(3, '0')}/${String(year).padStart(2, '0')}`;
  return { job_number, year, sequence: seq };
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── JOBS ─────────────────────────────────────────────────────────────────────
app.get('/api/jobs', (req, res) => {
  const { search, status, mode, agent, date_from, date_to } = req.query;
  let q = 'SELECT * FROM jobs WHERE 1=1';
  const p = [];

  if (search) {
    const s = `%${search}%`;
    q += ' AND (job_number LIKE ? OR shipper LIKE ? OR consignee LIKE ? OR customer_ref LIKE ? OR agent LIKE ?)';
    p.push(s, s, s, s, s);
  }
  if (status) { q += ' AND status=?'; p.push(status); }
  if (mode) { q += ' AND mode=?'; p.push(mode); }
  if (agent) { q += ' AND agent LIKE ?'; p.push(`%${agent}%`); }
  if (date_from) { q += ' AND date_out >= ?'; p.push(date_from); }
  if (date_to) { q += ' AND date_out <= ?'; p.push(date_to); }

  q += ' ORDER BY id DESC';
  const jobs = db.prepare(q).all(...p);
  res.json(jobs.map(enrichJob));
});

app.post('/api/jobs', (req, res) => {
  const { job_number, year, sequence } = generateJobNumber();
  const f = req.body;
  const result = db.prepare(`
    INSERT INTO jobs (job_number, year, sequence, shipper, consignee, weight, packages,
      dimensions, cbm, pickup_address, pickup_contact_name, pickup_contact_number,
      delivery_address, delivery_contact_name, delivery_contact_number,
      date_out, date_delivered, agent, mode, status, customer_ref, deadline_date, commodity, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    job_number, year, sequence,
    f.shipper||'', f.consignee||'', f.weight||null, f.packages||null,
    f.dimensions||'', f.cbm||null,
    f.pickup_address||'', f.pickup_contact_name||'', f.pickup_contact_number||'',
    f.delivery_address||'', f.delivery_contact_name||'', f.delivery_contact_number||'',
    f.date_out||null, f.date_delivered||null,
    f.agent||'', f.mode||'Local Delivery', f.status||'New',
    f.customer_ref||'', f.deadline_date||null, f.commodity||'', f.notes||''
  );
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(result.lastInsertRowid);

  // Pre-populate billing lines if passed
  if (f.billing_lines && Array.isArray(f.billing_lines)) {
    const ins = db.prepare('INSERT INTO billing_lines (job_id, service, unit, rate, qty, remarks) VALUES (?,?,?,?,?,?)');
    for (const bl of f.billing_lines) {
      ins.run(job.id, bl.service||'', bl.unit||'', bl.rate||0, bl.qty||1, bl.remarks||'');
    }
  }

  res.status(201).json(enrichJob(job));
});

app.get('/api/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });
  const cost_lines = db.prepare('SELECT * FROM cost_lines WHERE job_id=? ORDER BY id').all(job.id);
  const billing_lines = db.prepare('SELECT * FROM billing_lines WHERE job_id=? ORDER BY id').all(job.id).map(b => ({
    ...b, total: parseFloat(((b.rate||0)*(b.qty||1)).toFixed(2))
  }));
  const documents = db.prepare('SELECT * FROM documents WHERE job_id=? ORDER BY upload_date DESC').all(job.id);
  res.json({ ...enrichJob(job), cost_lines, billing_lines, documents });
});

app.put('/api/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Not found' });

  const allowed = ['shipper','consignee','weight','packages','dimensions','cbm',
    'pickup_address','pickup_contact_name','pickup_contact_number',
    'delivery_address','delivery_contact_name','delivery_contact_number',
    'date_out','date_delivered','agent','mode','status','customer_ref',
    'deadline_date','commodity','notes','gp_override'];

  const updates = {};
  allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
  if (!Object.keys(updates).length) return res.json(enrichJob(job));

  const cols = Object.keys(updates).map(k => `${k}=?`).join(', ');
  db.prepare(`UPDATE jobs SET ${cols} WHERE id=?`).run(...Object.values(updates), req.params.id);
  res.json(enrichJob(db.prepare('SELECT * FROM jobs WHERE id=?').get(req.params.id)));
});

app.delete('/api/jobs/:id', (req, res) => {
  // Clean up document files
  const docs = db.prepare('SELECT file_path FROM documents WHERE job_id=?').all(req.params.id);
  docs.forEach(d => { try { fs.unlinkSync(d.file_path); } catch (_) {} });
  db.prepare('DELETE FROM jobs WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ─── COST LINES ───────────────────────────────────────────────────────────────
app.post('/api/jobs/:id/costs', (req, res) => {
  const { vendor='', amount=0, invoice_no='', invoice_date=null, service='', remarks='' } = req.body;
  const r = db.prepare('INSERT INTO cost_lines (job_id,vendor,amount,invoice_no,invoice_date,service,remarks) VALUES (?,?,?,?,?,?,?)')
    .run(req.params.id, vendor, amount, invoice_no, invoice_date, service, remarks);
  res.status(201).json(db.prepare('SELECT * FROM cost_lines WHERE id=?').get(r.lastInsertRowid));
});

app.put('/api/jobs/:id/costs/:lid', (req, res) => {
  const { vendor='', amount=0, invoice_no='', invoice_date=null, service='', remarks='' } = req.body;
  db.prepare('UPDATE cost_lines SET vendor=?,amount=?,invoice_no=?,invoice_date=?,service=?,remarks=? WHERE id=? AND job_id=?')
    .run(vendor, amount, invoice_no, invoice_date, service, remarks, req.params.lid, req.params.id);
  res.json(db.prepare('SELECT * FROM cost_lines WHERE id=?').get(req.params.lid));
});

app.delete('/api/jobs/:id/costs/:lid', (req, res) => {
  db.prepare('DELETE FROM cost_lines WHERE id=? AND job_id=?').run(req.params.lid, req.params.id);
  res.json({ success: true });
});

// ─── BILLING LINES ────────────────────────────────────────────────────────────
app.post('/api/jobs/:id/billing', (req, res) => {
  const { service='', unit='', rate=0, qty=1, remarks='' } = req.body;
  const r = db.prepare('INSERT INTO billing_lines (job_id,service,unit,rate,qty,remarks) VALUES (?,?,?,?,?,?)')
    .run(req.params.id, service, unit, rate, qty, remarks);
  const line = db.prepare('SELECT * FROM billing_lines WHERE id=?').get(r.lastInsertRowid);
  res.status(201).json({ ...line, total: parseFloat(((line.rate||0)*(line.qty||1)).toFixed(2)) });
});

app.put('/api/jobs/:id/billing/:lid', (req, res) => {
  const { service='', unit='', rate=0, qty=1, remarks='' } = req.body;
  db.prepare('UPDATE billing_lines SET service=?,unit=?,rate=?,qty=?,remarks=? WHERE id=? AND job_id=?')
    .run(service, unit, rate, qty, remarks, req.params.lid, req.params.id);
  const line = db.prepare('SELECT * FROM billing_lines WHERE id=?').get(req.params.lid);
  res.json({ ...line, total: parseFloat(((line.rate||0)*(line.qty||1)).toFixed(2)) });
});

app.delete('/api/jobs/:id/billing/:lid', (req, res) => {
  db.prepare('DELETE FROM billing_lines WHERE id=? AND job_id=?').run(req.params.lid, req.params.id);
  res.json({ success: true });
});

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────
app.post('/api/jobs/:id/documents', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { doc_type = 'Other' } = req.body;
  const r = db.prepare('INSERT INTO documents (job_id,file_name,doc_type,file_path) VALUES (?,?,?,?)')
    .run(req.params.id, req.file.originalname, doc_type, req.file.path);
  res.status(201).json(db.prepare('SELECT * FROM documents WHERE id=?').get(r.lastInsertRowid));
});

app.delete('/api/jobs/:id/documents/:did', (req, res) => {
  const doc = db.prepare('SELECT * FROM documents WHERE id=? AND job_id=?').get(req.params.did, req.params.id);
  if (!doc) return res.status(404).json({ error: 'Not found' });
  try { fs.unlinkSync(doc.file_path); } catch (_) {}
  db.prepare('DELETE FROM documents WHERE id=?').run(req.params.did);
  res.json({ success: true });
});

// ─── PARSE EMAIL (Claude) ─────────────────────────────────────────────────────
app.post('/api/parse-email', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });

  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: `You are a freight forwarding operations assistant for Zhenghe Logistics (ZHL), Singapore.
Extract job details from emails and job orders. Always return valid JSON only, no other text.`,
      messages: [{
        role: 'user',
        content: `Parse this email/job order and return a JSON object with these exact fields (null for missing):

{
  "shipper": "shipper company name",
  "consignee": "consignee company name",
  "pickup_address": "full pickup address",
  "pickup_contact_name": "pickup contact person name",
  "pickup_contact_number": "pickup contact phone number",
  "delivery_address": "full delivery address",
  "delivery_contact_name": "delivery contact person name",
  "delivery_contact_number": "delivery contact phone number",
  "packages": <integer or null>,
  "dimensions": "e.g. 60x40x30 cm per box",
  "weight": <number in kg or null>,
  "cbm": <number or null>,
  "commodity": "description of goods",
  "mode": "one of: Air Express / Local Delivery / Local Clearance & Delivery / Sea FCL / Sea LCL",
  "agent": "agent name if mentioned",
  "deadline_date": "YYYY-MM-DD or null",
  "customer_ref": "customer reference number e.g. KPS1137",
  "notes": "any other relevant info",
  "billing_lines": [
    { "service": "Airfreight", "unit": "kg", "rate": 28, "qty": 136, "remarks": "min 20kg" }
  ]
}

Email/Job Order:
${text}`
      }]
    });

    const content = msg.content[0].text;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse AI response' });
    res.json(JSON.parse(match[0]));
  } catch (err) {
    console.error('Claude parse-email error:', err.message);
    res.status(500).json({ error: 'AI parsing failed: ' + err.message });
  }
});

// ─── PARSE INVOICE PDF (Claude) ───────────────────────────────────────────────
app.post('/api/parse-invoice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    let textContent = '';
    if (req.file.mimetype === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(req.file.path);
      const data = await pdfParse(dataBuffer);
      textContent = data.text;
    } else {
      return res.status(400).json({ error: 'Please upload a PDF file' });
    }

    // Clean up temp file
    try { fs.unlinkSync(req.file.path); } catch (_) {}

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: 'You are a freight forwarding assistant. Extract invoice details and return valid JSON only.',
      messages: [{
        role: 'user',
        content: `Extract cost line details from this vendor invoice and return JSON:

{
  "vendor": "vendor/supplier name",
  "amount": <total amount as number>,
  "invoice_no": "invoice number",
  "invoice_date": "YYYY-MM-DD or null",
  "service": "service description",
  "remarks": "any notes"
}

Invoice text:
${textContent.substring(0, 4000)}`
      }]
    });

    const content = msg.content[0].text;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse invoice' });
    res.json(JSON.parse(match[0]));
  } catch (err) {
    console.error('Invoice parse error:', err.message);
    res.status(500).json({ error: 'Invoice parsing failed: ' + err.message });
  }
});

// ─── DASHBOARD ────────────────────────────────────────────────────────────────
app.get('/api/dashboard', (req, res) => {
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
  const today = now.toISOString().split('T')[0];
  const in7days = new Date(now.getTime() + 7*24*60*60*1000).toISOString().split('T')[0];

  // Monthly jobs
  const monthJobs = db.prepare('SELECT id FROM jobs WHERE created_at >= ?').all(monthStart);
  const monthIds = monthJobs.map(j => j.id);

  let monthRevenue = 0, monthCost = 0;
  monthIds.forEach(id => {
    const c = db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM cost_lines WHERE job_id=?').get(id);
    const b = db.prepare('SELECT COALESCE(SUM(rate*qty),0) as t FROM billing_lines WHERE job_id=?').get(id);
    monthCost += c.t;
    monthRevenue += b.t;
  });

  const monthProfit = monthRevenue - monthCost;
  const monthGP = monthRevenue > 0 ? (monthProfit/monthRevenue)*100 : 0;

  // By mode (all time)
  const allJobs = db.prepare('SELECT id, mode FROM jobs').all();
  const modeMap = {};
  allJobs.forEach(j => {
    if (!modeMap[j.mode]) modeMap[j.mode] = { count: 0, revenue: 0 };
    modeMap[j.mode].count++;
    const b = db.prepare('SELECT COALESCE(SUM(rate*qty),0) as t FROM billing_lines WHERE job_id=?').get(j.id);
    modeMap[j.mode].revenue += b.t;
  });
  const by_mode = Object.entries(modeMap).map(([mode, data]) => ({ mode, ...data }));

  // GP% trend (last 6 months)
  const trend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`;
    const end = new Date(d.getFullYear(), d.getMonth()+1, 1).toISOString().split('T')[0];
    const ids = db.prepare('SELECT id FROM jobs WHERE created_at >= ? AND created_at < ?').all(start, end).map(j=>j.id);
    let rev = 0, cost = 0;
    ids.forEach(id => {
      const c = db.prepare('SELECT COALESCE(SUM(amount),0) as t FROM cost_lines WHERE job_id=?').get(id);
      const b = db.prepare('SELECT COALESCE(SUM(rate*qty),0) as t FROM billing_lines WHERE job_id=?').get(id);
      cost += c.t; rev += b.t;
    });
    const profit = rev - cost;
    const gp = rev > 0 ? parseFloat(((profit/rev)*100).toFixed(1)) : 0;
    trend.push({
      month: d.toLocaleString('default', { month: 'short', year: '2-digit' }),
      gp_percent: gp,
      revenue: parseFloat(rev.toFixed(2))
    });
  }

  // Upcoming deadlines (next 7 days)
  const upcoming = db.prepare(
    "SELECT id, job_number, shipper, consignee, deadline_date, status FROM jobs WHERE deadline_date >= ? AND deadline_date <= ? AND status != 'Completed' ORDER BY deadline_date"
  ).all(today, in7days);

  // Flagged jobs (no billing lines = missing costing)
  const flagged = db.prepare('SELECT j.id, j.job_number, j.shipper, j.status FROM jobs j WHERE NOT EXISTS (SELECT 1 FROM billing_lines b WHERE b.job_id=j.id) ORDER BY j.id DESC LIMIT 10').all();

  res.json({
    this_month: {
      jobs: monthIds.length,
      revenue: parseFloat(monthRevenue.toFixed(2)),
      cost: parseFloat(monthCost.toFixed(2)),
      profit: parseFloat(monthProfit.toFixed(2)),
      gp_percent: parseFloat(monthGP.toFixed(1))
    },
    by_mode,
    trend,
    upcoming_deadlines: upcoming,
    flagged_jobs: flagged
  });
});

// ─── START ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => console.log(`ZHL backend running on http://localhost:${PORT}`));
