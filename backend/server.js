require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3001;

// Uploads directory
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// PostgreSQL pool (Supabase)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Anthropic client
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + Math.round(Math.random()*1e9) + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 20*1024*1024 } });

// ─── DB INIT ──────────────────────────────────────────────────────────────────
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS jobs (
      id SERIAL PRIMARY KEY,
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
      gp_override REAL,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `);
  // Add columns added after initial schema
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_name TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_contact_name TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_contact_number TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_email TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS void_reason TEXT DEFAULT ''`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cost_lines (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      vendor TEXT DEFAULT '',
      amount REAL DEFAULT 0,
      invoice_no TEXT DEFAULT '',
      invoice_date TEXT,
      service TEXT DEFAULT '',
      remarks TEXT DEFAULT ''
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS billing_lines (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      service TEXT DEFAULT '',
      unit TEXT DEFAULT '',
      rate REAL DEFAULT 0,
      qty REAL DEFAULT 1,
      remarks TEXT DEFAULT ''
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      file_name TEXT NOT NULL,
      doc_type TEXT DEFAULT 'Other',
      upload_date TIMESTAMP DEFAULT NOW(),
      file_path TEXT NOT NULL
    )
  `);
  console.log('Database ready');
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
async function enrichJob(job) {
  const costs = await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM cost_lines WHERE job_id=$1', [job.id]);
  const billing = await pool.query('SELECT COALESCE(SUM(rate*qty),0) as total FROM billing_lines WHERE job_id=$1', [job.id]);
  const cost_sgd = parseFloat(Number(costs.rows[0].total||0).toFixed(2));
  const sale_sgd = parseFloat(Number(billing.rows[0].total||0).toFixed(2));
  const profit_sgd = parseFloat((sale_sgd - cost_sgd).toFixed(2));
  const computed_gp = sale_sgd > 0 ? parseFloat(((profit_sgd/sale_sgd)*100).toFixed(1)) : 0;
  const gp_percent = job.gp_override != null ? parseFloat(Number(job.gp_override).toFixed(1)) : computed_gp;
  return { ...job, cost_sgd, sale_sgd, profit_sgd, gp_percent, computed_gp };
}

async function generateJobNumber() {
  const year = new Date().getFullYear() % 100;
  const result = await pool.query('SELECT COALESCE(MAX(sequence),0) as max_seq FROM jobs WHERE year=$1', [year]);
  const seq = (parseInt(result.rows[0].max_seq)||0) + 1;
  const job_number = `ZHL-${String(seq).padStart(3,'0')}/${String(year).padStart(2,'0')}`;
  return { job_number, year, sequence: seq };
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

// ─── JOBS ─────────────────────────────────────────────────────────────────────
app.get('/api/jobs', async (req, res) => {
  try {
    const { search, status, mode, agent } = req.query;
    let q = 'SELECT * FROM jobs WHERE 1=1';
    const p = [];
    let i = 1;

    if (search) {
      const s = `%${search}%`;
      q += ` AND (job_number ILIKE $${i} OR shipper ILIKE $${i+1} OR consignee ILIKE $${i+2} OR customer_ref ILIKE $${i+3} OR agent ILIKE $${i+4})`;
      p.push(s, s, s, s, s); i += 5;
    }
    if (status) { q += ` AND status=$${i}`; p.push(status); i++; }
    if (mode) { q += ` AND mode=$${i}`; p.push(mode); i++; }
    if (agent) { q += ` AND agent ILIKE $${i}`; p.push(`%${agent}%`); i++; }

    q += ' ORDER BY id DESC';
    const result = await pool.query(q, p);
    const jobs = await Promise.all(result.rows.map(enrichJob));
    res.json(jobs);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/jobs', async (req, res) => {
  try {
    const { job_number, year, sequence } = await generateJobNumber();
    const f = req.body;
    const result = await pool.query(`
      INSERT INTO jobs (job_number, year, sequence, shipper, consignee, weight, packages,
        dimensions, cbm, pickup_address, pickup_contact_name, pickup_contact_number,
        delivery_address, delivery_contact_name, delivery_contact_number,
        date_out, date_delivered, agent, mode, status, customer_ref, deadline_date, commodity, notes,
        customer_name, customer_contact_name, customer_contact_number, customer_email)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
      RETURNING *
    `, [
      job_number, year, sequence,
      f.shipper||'', f.consignee||'', f.weight||null, f.packages||null,
      f.dimensions||'', f.cbm||null,
      f.pickup_address||'', f.pickup_contact_name||'', f.pickup_contact_number||'',
      f.delivery_address||'', f.delivery_contact_name||'', f.delivery_contact_number||'',
      f.date_out||null, f.date_delivered||null,
      f.agent||'', f.mode||'Local Delivery', f.status||'New',
      f.customer_ref||'', f.deadline_date||null, f.commodity||'', f.notes||'',
      f.customer_name||'', f.customer_contact_name||'', f.customer_contact_number||'', f.customer_email||''
    ]);
    const job = result.rows[0];

    // Pre-populate billing lines
    if (f.billing_lines && Array.isArray(f.billing_lines)) {
      for (const bl of f.billing_lines) {
        await pool.query(
          'INSERT INTO billing_lines (job_id, service, unit, rate, qty, remarks) VALUES ($1,$2,$3,$4,$5,$6)',
          [job.id, bl.service||'', bl.unit||'', bl.rate||0, bl.qty||1, bl.remarks||'']
        );
      }
    }
    res.status(201).json(await enrichJob(job));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    const job = result.rows[0];
    const cost_lines = (await pool.query('SELECT * FROM cost_lines WHERE job_id=$1 ORDER BY id', [job.id])).rows;
    const billing_raw = (await pool.query('SELECT * FROM billing_lines WHERE job_id=$1 ORDER BY id', [job.id])).rows;
    const billing_lines = billing_raw.map(b => ({ ...b, total: parseFloat(((b.rate||0)*(b.qty||1)).toFixed(2)) }));
    const docRows = (await pool.query('SELECT * FROM documents WHERE job_id=$1 ORDER BY upload_date DESC', [job.id])).rows;
    const documents = docRows.map(d => ({ ...d, file_url: `/uploads/${path.basename(d.file_path)}` }));
    res.json({ ...await enrichJob(job), cost_lines, billing_lines, documents });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/jobs/:id', async (req, res) => {
  try {
    const allowed = ['shipper','consignee','weight','packages','dimensions','cbm',
      'pickup_address','pickup_contact_name','pickup_contact_number',
      'delivery_address','delivery_contact_name','delivery_contact_number',
      'date_out','date_delivered','agent','mode','status','customer_ref',
      'deadline_date','commodity','notes','gp_override',
      'customer_name','customer_contact_name','customer_contact_number','customer_email',
      'void_reason'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    if (!Object.keys(updates).length) {
      const r = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
      return res.json(await enrichJob(r.rows[0]));
    }
    const cols = Object.keys(updates).map((k, i) => `${k}=$${i+1}`).join(', ');
    const vals = [...Object.values(updates), req.params.id];
    await pool.query(`UPDATE jobs SET ${cols} WHERE id=$${vals.length}`, vals);
    const updated = (await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id])).rows[0];
    res.json(await enrichJob(updated));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/jobs/:id', async (req, res) => {
  try {
    const docs = (await pool.query('SELECT file_path FROM documents WHERE job_id=$1', [req.params.id])).rows;
    docs.forEach(d => { try { fs.unlinkSync(d.file_path); } catch (_) {} });
    await pool.query('DELETE FROM jobs WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── COST LINES ───────────────────────────────────────────────────────────────
app.post('/api/jobs/:id/costs', async (req, res) => {
  try {
    const { vendor='', amount=0, invoice_no='', invoice_date=null, service='', remarks='' } = req.body;
    const r = await pool.query(
      'INSERT INTO cost_lines (job_id,vendor,amount,invoice_no,invoice_date,service,remarks) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.params.id, vendor, amount, invoice_no, invoice_date, service, remarks]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/jobs/:id/costs/:lid', async (req, res) => {
  try {
    const { vendor='', amount=0, invoice_no='', invoice_date=null, service='', remarks='' } = req.body;
    const r = await pool.query(
      'UPDATE cost_lines SET vendor=$1,amount=$2,invoice_no=$3,invoice_date=$4,service=$5,remarks=$6 WHERE id=$7 AND job_id=$8 RETURNING *',
      [vendor, amount, invoice_no, invoice_date, service, remarks, req.params.lid, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/jobs/:id/costs/:lid', async (req, res) => {
  try {
    await pool.query('DELETE FROM cost_lines WHERE id=$1 AND job_id=$2', [req.params.lid, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── BILLING LINES ────────────────────────────────────────────────────────────
app.post('/api/jobs/:id/billing', async (req, res) => {
  try {
    const { service='', unit='', rate=0, qty=1, remarks='' } = req.body;
    const r = await pool.query(
      'INSERT INTO billing_lines (job_id,service,unit,rate,qty,remarks) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.id, service, unit, rate, qty, remarks]
    );
    const line = r.rows[0];
    res.status(201).json({ ...line, total: parseFloat(((line.rate||0)*(line.qty||1)).toFixed(2)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.put('/api/jobs/:id/billing/:lid', async (req, res) => {
  try {
    const { service='', unit='', rate=0, qty=1, remarks='' } = req.body;
    const r = await pool.query(
      'UPDATE billing_lines SET service=$1,unit=$2,rate=$3,qty=$4,remarks=$5 WHERE id=$6 AND job_id=$7 RETURNING *',
      [service, unit, rate, qty, remarks, req.params.lid, req.params.id]
    );
    const line = r.rows[0];
    res.json({ ...line, total: parseFloat(((line.rate||0)*(line.qty||1)).toFixed(2)) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/jobs/:id/billing/:lid', async (req, res) => {
  try {
    await pool.query('DELETE FROM billing_lines WHERE id=$1 AND job_id=$2', [req.params.lid, req.params.id]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── DOCUMENTS ────────────────────────────────────────────────────────────────
app.post('/api/jobs/:id/documents', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { doc_type='Other' } = req.body;
    const r = await pool.query(
      'INSERT INTO documents (job_id,file_name,doc_type,file_path) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.id, req.file.originalname, doc_type, req.file.path]
    );
    const doc = r.rows[0];
    res.status(201).json({ ...doc, file_url: `/uploads/${path.basename(doc.file_path)}` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.delete('/api/jobs/:id/documents/:did', async (req, res) => {
  try {
    const doc = (await pool.query('SELECT * FROM documents WHERE id=$1 AND job_id=$2', [req.params.did, req.params.id])).rows[0];
    if (!doc) return res.status(404).json({ error: 'Not found' });
    try { fs.unlinkSync(doc.file_path); } catch (_) {}
    await pool.query('DELETE FROM documents WHERE id=$1', [req.params.did]);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── PARSE EMAIL ──────────────────────────────────────────────────────────────
app.post('/api/parse-email', async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'No text provided' });
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: 'You are a freight forwarding operations assistant for Zhenghe Logistics (ZHL), Singapore. Extract job details from emails and job orders. Always return valid JSON only, no other text.',
      messages: [{ role: 'user', content: `Parse this email/job order and return a JSON object with these exact fields (null for missing):
{
  "shipper": "shipper company name",
  "consignee": "consignee company name",
  "customer_name": "billing customer company name if different from shipper",
  "customer_contact_name": "customer contact person",
  "customer_contact_number": "customer phone number",
  "customer_email": "customer email address",
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
  "mode": "one of: Air Express / LCL Express / Local Delivery / Local Clearance & Delivery / Sea FCL / Sea LCL",
  "agent": "agent name if mentioned",
  "deadline_date": "YYYY-MM-DD or null",
  "customer_ref": "customer reference number e.g. KPS1137",
  "notes": "any other relevant info",
  "billing_lines": [{ "service": "Airfreight", "unit": "kg", "rate": 28, "qty": 136, "remarks": "min 20kg" }]
}
Email/Job Order:\n${text}` }]
    });
    const content = msg.content[0].text;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse AI response' });
    res.json(JSON.parse(match[0]));
  } catch (err) {
    console.error('Claude error:', err.message);
    res.status(500).json({ error: 'AI parsing failed: ' + err.message });
  }
});

// ─── PARSE EMAIL FILE (PDF / .eml / .txt) ────────────────────────────────────
app.post('/api/parse-email-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    let text = '';
    const ext = path.extname(req.file.originalname).toLowerCase();
    if (ext === '.pdf') {
      const pdfParse = require('pdf-parse');
      const dataBuffer = fs.readFileSync(req.file.path);
      const data = await pdfParse(dataBuffer);
      text = data.text;
    } else {
      text = fs.readFileSync(req.file.path, 'utf8');
    }
    try { fs.unlinkSync(req.file.path); } catch (_) {}

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: 'You are a freight forwarding operations assistant for Zhenghe Logistics (ZHL), Singapore. Extract job details from emails and job orders. Always return valid JSON only, no other text.',
      messages: [{ role: 'user', content: `Parse this email/job order and return a JSON object with these exact fields (null for missing):
{
  "shipper": "shipper company name",
  "consignee": "consignee company name",
  "customer_name": "billing customer company name if different from shipper",
  "customer_contact_name": "customer contact person",
  "customer_contact_number": "customer phone number",
  "customer_email": "customer email address",
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
  "mode": "one of: Air Express / LCL Express / Local Delivery / Local Clearance & Delivery / Sea FCL / Sea LCL",
  "agent": "agent name if mentioned",
  "deadline_date": "YYYY-MM-DD or null",
  "customer_ref": "customer reference number e.g. KPS1137",
  "notes": "any other relevant info",
  "billing_lines": [{ "service": "Airfreight", "unit": "kg", "rate": 28, "qty": 136, "remarks": "min 20kg" }]
}
Email/Job Order:\n${text.substring(0, 8000)}` }]
    });
    const content = msg.content[0].text;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse AI response' });
    res.json(JSON.parse(match[0]));
  } catch (err) {
    console.error('Email file parse error:', err.message);
    res.status(500).json({ error: 'File parsing failed: ' + err.message });
  }
});

// ─── PARSE INVOICE ────────────────────────────────────────────────────────────
app.post('/api/parse-invoice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const pdfParse = require('pdf-parse');
    const dataBuffer = fs.readFileSync(req.file.path);
    const data = await pdfParse(dataBuffer);
    try { fs.unlinkSync(req.file.path); } catch (_) {}

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 800,
      system: 'You are a freight forwarding assistant. Extract invoice details and return valid JSON only.',
      messages: [{ role: 'user', content: `Extract cost line details from this vendor invoice and return JSON:
{
  "vendor": "vendor/supplier name",
  "amount": <total amount as number>,
  "invoice_no": "invoice number",
  "invoice_date": "YYYY-MM-DD or null",
  "service": "service description",
  "remarks": "any notes"
}
Invoice text:\n${data.text.substring(0,4000)}` }]
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
app.get('/api/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = now.toISOString().split('T')[0];
    const in7days = new Date(now.getTime() + 7*24*60*60*1000).toISOString().split('T')[0];

    const monthJobsResult = await pool.query('SELECT id FROM jobs WHERE created_at >= $1', [monthStart]);
    const monthIds = monthJobsResult.rows.map(j => j.id);

    let monthRevenue = 0, monthCost = 0;
    for (const id of monthIds) {
      const c = await pool.query('SELECT COALESCE(SUM(amount),0) as t FROM cost_lines WHERE job_id=$1', [id]);
      const b = await pool.query('SELECT COALESCE(SUM(rate*qty),0) as t FROM billing_lines WHERE job_id=$1', [id]);
      monthCost += parseFloat(c.rows[0].t);
      monthRevenue += parseFloat(b.rows[0].t);
    }
    const monthProfit = monthRevenue - monthCost;
    const monthGP = monthRevenue > 0 ? (monthProfit/monthRevenue)*100 : 0;

    // By mode
    const allJobs = (await pool.query('SELECT id, mode FROM jobs')).rows;
    const modeMap = {};
    for (const j of allJobs) {
      if (!modeMap[j.mode]) modeMap[j.mode] = { count: 0, revenue: 0 };
      modeMap[j.mode].count++;
      const b = await pool.query('SELECT COALESCE(SUM(rate*qty),0) as t FROM billing_lines WHERE job_id=$1', [j.id]);
      modeMap[j.mode].revenue += parseFloat(b.rows[0].t);
    }
    const by_mode = Object.entries(modeMap).map(([mode, data]) => ({ mode, ...data }));

    // GP% trend (6 months)
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth()+1, 1);
      const ids = (await pool.query('SELECT id FROM jobs WHERE created_at >= $1 AND created_at < $2', [start, end])).rows.map(j=>j.id);
      let rev = 0, cost = 0;
      for (const id of ids) {
        const c = await pool.query('SELECT COALESCE(SUM(amount),0) as t FROM cost_lines WHERE job_id=$1', [id]);
        const b = await pool.query('SELECT COALESCE(SUM(rate*qty),0) as t FROM billing_lines WHERE job_id=$1', [id]);
        cost += parseFloat(c.rows[0].t); rev += parseFloat(b.rows[0].t);
      }
      const profit = rev - cost;
      const gp = rev > 0 ? parseFloat(((profit/rev)*100).toFixed(1)) : 0;
      trend.push({ month: d.toLocaleString('default',{month:'short',year:'2-digit'}), gp_percent: gp, revenue: parseFloat(rev.toFixed(2)) });
    }

    const upcoming = (await pool.query(
      "SELECT id,job_number,shipper,consignee,deadline_date,status FROM jobs WHERE deadline_date >= $1 AND deadline_date <= $2 AND status != 'Completed' ORDER BY deadline_date",
      [today, in7days]
    )).rows;

    const flagged = (await pool.query(
      'SELECT j.id,j.job_number,j.shipper,j.status FROM jobs j WHERE NOT EXISTS (SELECT 1 FROM billing_lines b WHERE b.job_id=j.id) ORDER BY j.id DESC LIMIT 10'
    )).rows;

    res.json({
      this_month: {
        jobs: monthIds.length,
        revenue: parseFloat(monthRevenue.toFixed(2)),
        cost: parseFloat(monthCost.toFixed(2)),
        profit: parseFloat(monthProfit.toFixed(2)),
        gp_percent: parseFloat(monthGP.toFixed(1))
      },
      by_mode, trend,
      upcoming_deadlines: upcoming,
      flagged_jobs: flagged
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── START ────────────────────────────────────────────────────────────────────
initDB()
  .then(() => app.listen(PORT, () => console.log(`ZHL backend running on port ${PORT}`)))
  .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
