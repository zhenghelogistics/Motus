require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const app = express();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 5000,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Memory storage — no disk in serverless
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// ─── AUTH MIDDLEWARE ─────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://wwaupgxlzardsrxikuvj.supabase.co'

async function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Unauthorized — no token' })
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': process.env.SUPABASE_SERVICE_KEY
      }
    })
    if (!r.ok) return res.status(401).json({ error: 'Unauthorized — invalid or expired session' })
    req.user = await r.json()
    next()
  } catch (e) {
    console.error('[ZHL] requireAuth error:', e.message)
    res.status(401).json({ error: 'Unauthorized' })
  }
}

// ─── DB INIT (lazy, once per cold start) ────────────────────────────────────
let _dbReady = false;
let _dbPromise = null;

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
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_name TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_contact_name TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_contact_number TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS customer_email TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS void_reason TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS zhl_invoice_no TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS created_by TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS salesperson TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE billing_lines ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'SGD'`);
  await pool.query(`ALTER TABLE billing_lines ADD COLUMN IF NOT EXISTS rate_local REAL`);
  await pool.query(`ALTER TABLE cost_lines ADD COLUMN IF NOT EXISTS currency TEXT DEFAULT 'SGD'`);
  await pool.query(`ALTER TABLE cost_lines ADD COLUMN IF NOT EXISTS amount_local REAL`);
  await pool.query(`ALTER TABLE cost_lines ADD COLUMN IF NOT EXISTS total_payable REAL`);
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
      file_url TEXT NOT NULL
    )
  `);
}

async function ensureDB() {
  if (_dbReady) return;
  if (!_dbPromise) _dbPromise = initDB().then(() => { _dbReady = true; });
  await _dbPromise;
}

// ─── HELPERS ────────────────────────────────────────────────────────────────
async function enrichJob(job) {
  const costs = await pool.query('SELECT COALESCE(SUM(amount),0) as total FROM cost_lines WHERE job_id=$1', [job.id]);
  const billing = await pool.query('SELECT COALESCE(SUM(rate*qty),0) as total FROM billing_lines WHERE job_id=$1', [job.id]);
  const cost_sgd = parseFloat(Number(costs.rows[0].total || 0).toFixed(2));
  const sale_sgd = parseFloat(Number(billing.rows[0].total || 0).toFixed(2));
  const profit_sgd = parseFloat((sale_sgd - cost_sgd).toFixed(2));
  const computed_gp = sale_sgd > 0 ? parseFloat(((profit_sgd / sale_sgd) * 100).toFixed(1)) : 0;
  const gp_percent = job.gp_override != null ? parseFloat(Number(job.gp_override).toFixed(1)) : computed_gp;
  return { ...job, cost_sgd, sale_sgd, profit_sgd, gp_percent, computed_gp };
}

async function generateJobNumber() {
  const year = new Date().getFullYear() % 100;
  const result = await pool.query('SELECT COALESCE(MAX(sequence),0) as max_seq FROM jobs WHERE year=$1', [year]);
  const seq = (parseInt(result.rows[0].max_seq) || 0) + 1;
  const job_number = `ZHL-${String(seq).padStart(3, '0')}/${String(year).padStart(2, '0')}`;
  return { job_number, year, sequence: seq };
}

let _bucketReady = false
async function ensureBucket() {
  if (_bucketReady) return
  const key = process.env.SUPABASE_SERVICE_KEY
  // Try to create the bucket — if it already exists Supabase returns a 409, which is fine
  await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'Documents', name: 'Documents', public: true })
  })
  _bucketReady = true
}

async function uploadToSupabaseStorage(buffer, filename, contentType) {
  const supabaseUrl = SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) throw new Error('SUPABASE_SERVICE_KEY not configured');
  await ensureBucket()

  const res = await fetch(`${supabaseUrl}/storage/v1/object/Documents/${filename}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      apikey: key,
      'Content-Type': contentType || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Storage upload failed: ${err}`);
  }
  return `${supabaseUrl}/storage/v1/object/public/Documents/${filename}`;
}

// ─── MIDDLEWARE ──────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// Vercel rewrites /api/foo → /api/index?path=foo — restore the original path
app.use((req, res, next) => {
  if (req.query.path !== undefined) {
    const slug = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
    const rest = { ...req.query };
    delete rest.path;
    const qs = new URLSearchParams(rest).toString();
    req.url = '/api/' + slug + (qs ? '?' + qs : '');
  }
  console.log(`[ZHL] ${req.method} ${req.url}`);
  next();
});

app.use(async (req, res, next) => {
  try { await ensureDB(); next(); }
  catch (err) {
    console.error('[ZHL] DB init error:', err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── AUTH GUARD (all /api/* except health checks) ───────────────────────────
app.use('/api', (req, res, next) => {
  if (req.url === '/health' || req.url === '/dbtest') return next()
  requireAuth(req, res, next)
})

// ─── HEALTH ─────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', db_url_set: !!process.env.DATABASE_URL });
});

app.get('/api/dbtest', async (req, res) => {
  try {
    const r = await pool.query('SELECT NOW() as time');
    res.json({ ok: true, time: r.rows[0].time });
  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

// ─── JOBS ───────────────────────────────────────────────────────────────────
app.get('/api/jobs', async (req, res) => {
  try {
    const { search, status, mode, agent, created_by } = req.query;
    // Single query with aggregated cost/billing via subquery joins — no N+1
    let where = 'WHERE 1=1';
    const p = [];
    let i = 1;
    if (search) {
      const s = `%${search}%`;
      where += ` AND (j.job_number ILIKE $${i} OR j.shipper ILIKE $${i+1} OR j.consignee ILIKE $${i+2} OR j.customer_ref ILIKE $${i+3} OR j.agent ILIKE $${i+4} OR j.created_by ILIKE $${i+5})`;
      p.push(s, s, s, s, s, s); i += 6;
    }
    if (status)     { where += ` AND j.status=$${i}`;          p.push(status);            i++; }
    if (mode)       { where += ` AND j.mode=$${i}`;            p.push(mode);              i++; }
    if (agent)      { where += ` AND j.agent ILIKE $${i}`;     p.push(`%${agent}%`);      i++; }
    if (created_by)   { where += ` AND j.created_by=$${i}`;      p.push(created_by);        i++; }

    const limitVal = req.query.limit ? Math.min(Math.max(parseInt(req.query.limit) || 200, 1), 500) : null
    const limitClause = limitVal ? `LIMIT ${limitVal}` : ''
    const q = `
      SELECT j.*,
        ROUND(COALESCE(c.total,0)::numeric, 2) AS cost_sgd,
        ROUND(COALESCE(b.total,0)::numeric, 2) AS sale_sgd,
        ROUND((COALESCE(b.total,0) - COALESCE(c.total,0))::numeric, 2) AS profit_sgd,
        CASE
          WHEN j.gp_override IS NOT NULL THEN ROUND(j.gp_override::numeric, 1)
          WHEN COALESCE(b.total,0) > 0   THEN ROUND(((COALESCE(b.total,0) - COALESCE(c.total,0)) / b.total * 100)::numeric, 1)
          ELSE 0
        END AS gp_percent,
        COALESCE(j.gp_override, NULL) AS computed_gp
      FROM jobs j
      LEFT JOIN (SELECT job_id, SUM(amount)    AS total FROM cost_lines    GROUP BY job_id) c ON c.job_id = j.id
      LEFT JOIN (SELECT job_id, SUM(rate*qty)  AS total FROM billing_lines GROUP BY job_id) b ON b.job_id = j.id
      ${where}
      ORDER BY j.id DESC
      ${limitClause}
    `;
    const result = await pool.query(q, p);
    res.json(result.rows.map(r => ({
      ...r,
      cost_sgd:   parseFloat(r.cost_sgd)   || 0,
      sale_sgd:   parseFloat(r.sale_sgd)   || 0,
      profit_sgd: parseFloat(r.profit_sgd) || 0,
      gp_percent: parseFloat(r.gp_percent) || 0,
    })));
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.post('/api/jobs', async (req, res) => {
  try {
    const { job_number, year, sequence } = await generateJobNumber();
    const f = req.body;
    const result = await pool.query(`
      INSERT INTO jobs (job_number, year, sequence, shipper, consignee, weight, packages,
        dimensions, cbm, pickup_address, pickup_contact_name, pickup_contact_number,
        delivery_address, delivery_contact_name, delivery_contact_number,
        date_out, date_delivered, agent, mode, status, customer_ref, deadline_date, commodity, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
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
      req.user?.email || ''
    ]);
    const job = result.rows[0];
    if (f.billing_lines && Array.isArray(f.billing_lines)) {
      for (const bl of f.billing_lines) {
        await pool.query(
          'INSERT INTO billing_lines (job_id,service,unit,rate,qty,remarks) VALUES ($1,$2,$3,$4,$5,$6)',
          [job.id, bl.service||'', bl.unit||'', bl.rate||0, bl.qty||1, bl.remarks||'']
        );
      }
    }
    res.status(201).json(await enrichJob(job));
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.get('/api/jobs/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Not found' });
    const job = result.rows[0];
    const cost_lines = (await pool.query('SELECT * FROM cost_lines WHERE job_id=$1 ORDER BY id', [job.id])).rows;
    const billing_raw = (await pool.query('SELECT * FROM billing_lines WHERE job_id=$1 ORDER BY id', [job.id])).rows;
    const billing_lines = billing_raw.map(b => ({ ...b, total: parseFloat(((b.rate||0)*(b.qty||1)).toFixed(2)) }));
    const documents = (await pool.query('SELECT * FROM documents WHERE job_id=$1 ORDER BY upload_date DESC', [job.id])).rows;
    res.json({ ...await enrichJob(job), cost_lines, billing_lines, documents });
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.put('/api/jobs/:id', async (req, res) => {
  try {
    const allowed = ['shipper','consignee','weight','packages','dimensions','cbm',
      'pickup_address','pickup_contact_name','pickup_contact_number',
      'delivery_address','delivery_contact_name','delivery_contact_number',
      'date_out','date_delivered','agent','mode','status','customer_ref',
      'deadline_date','commodity','notes','gp_override',
      'customer_name','customer_contact_name','customer_contact_number','customer_email','void_reason','zhl_invoice_no','created_by'];
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
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/jobs/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM jobs WHERE id=$1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── COST LINES ─────────────────────────────────────────────────────────────
app.post('/api/jobs/:id/costs', async (req, res) => {
  try {
    const { vendor='', amount=0, invoice_no='', invoice_date=null, service='', remarks='', currency='SGD', amount_local=null, total_payable=null } = req.body;
    const r = await pool.query(
      'INSERT INTO cost_lines (job_id,vendor,amount,invoice_no,invoice_date,service,remarks,currency,amount_local,total_payable) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [req.params.id, vendor, amount, invoice_no, invoice_date, service, remarks, currency, amount_local, total_payable]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.put('/api/jobs/:id/costs/:lid', async (req, res) => {
  try {
    const { vendor='', amount=0, invoice_no='', invoice_date=null, service='', remarks='', currency='SGD', amount_local=null, total_payable=null } = req.body;
    const r = await pool.query(
      'UPDATE cost_lines SET vendor=$1,amount=$2,invoice_no=$3,invoice_date=$4,service=$5,remarks=$6,currency=$7,amount_local=$8,total_payable=$9 WHERE id=$10 AND job_id=$11 RETURNING *',
      [vendor, amount, invoice_no, invoice_date, service, remarks, currency, amount_local, total_payable, req.params.lid, req.params.id]
    );
    res.json(r.rows[0]);
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/jobs/:id/costs/:lid', async (req, res) => {
  try {
    await pool.query('DELETE FROM cost_lines WHERE id=$1 AND job_id=$2', [req.params.lid, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── BILLING LINES ──────────────────────────────────────────────────────────
app.post('/api/jobs/:id/billing', async (req, res) => {
  try {
    const { service='', unit='', rate=0, qty=1, remarks='', currency='SGD', rate_local=null } = req.body;
    const r = await pool.query(
      'INSERT INTO billing_lines (job_id,service,unit,rate,qty,remarks,currency,rate_local) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.params.id, service, unit, rate, qty, remarks, currency, rate_local]
    );
    const line = r.rows[0];
    res.status(201).json({ ...line, total: parseFloat(((line.rate||0)*(line.qty||1)).toFixed(2)) });
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.put('/api/jobs/:id/billing/:lid', async (req, res) => {
  try {
    const { service='', unit='', rate=0, qty=1, remarks='', currency='SGD', rate_local=null } = req.body;
    const r = await pool.query(
      'UPDATE billing_lines SET service=$1,unit=$2,rate=$3,qty=$4,remarks=$5,currency=$6,rate_local=$7 WHERE id=$8 AND job_id=$9 RETURNING *',
      [service, unit, rate, qty, remarks, currency, rate_local, req.params.lid, req.params.id]
    );
    const line = r.rows[0];
    res.json({ ...line, total: parseFloat(((line.rate||0)*(line.qty||1)).toFixed(2)) });
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/jobs/:id/billing/:lid', async (req, res) => {
  try {
    await pool.query('DELETE FROM billing_lines WHERE id=$1 AND job_id=$2', [req.params.lid, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── DOCUMENTS ──────────────────────────────────────────────────────────────
app.post('/api/jobs/:id/documents', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const { doc_type = 'Other' } = req.body;
    const filename = `${Date.now()}-${Math.round(Math.random()*1e9)}-${req.file.originalname}`;
    const file_url = await uploadToSupabaseStorage(req.file.buffer, filename, req.file.mimetype);
    const r = await pool.query(
      'INSERT INTO documents (job_id,file_name,doc_type,file_url) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.params.id, req.file.originalname, doc_type, file_url]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.delete('/api/jobs/:id/documents/:did', async (req, res) => {
  try {
    await pool.query('DELETE FROM documents WHERE id=$1 AND job_id=$2', [req.params.did, req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── CUSTOMERS ──────────────────────────────────────────────────────────────
app.get('/api/staff', async (req, res) => {
  try {
    const r = await pool.query(`SELECT DISTINCT created_by FROM jobs WHERE created_by != '' ORDER BY created_by`)
    res.json(r.rows.map(r => r.created_by))
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
});

app.get('/api/customers', async (req, res) => {
  try {
    const { search } = req.query
    const p = search ? [`%${search}%`] : []
    const whereExtra = search
      ? `AND (COALESCE(NULLIF(j.customer_name,''), j.shipper) ILIKE $1)`
      : ''
    const r = await pool.query(`
      SELECT DISTINCT ON (COALESCE(NULLIF(j.customer_name,''), j.shipper))
        j.customer_name, j.customer_email, j.customer_contact_name, j.customer_contact_number,
        COALESCE(NULLIF(j.customer_name,''), j.shipper) AS display_name
      FROM jobs j
      WHERE COALESCE(NULLIF(j.customer_name,''), j.shipper) IS NOT NULL
        AND COALESCE(NULLIF(j.customer_name,''), j.shipper) != ''
        ${whereExtra}
      ORDER BY COALESCE(NULLIF(j.customer_name,''), j.shipper), j.id DESC
      LIMIT 15
    `, p)
    res.json(r.rows)
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
})

// ─── PARSE EMAIL ────────────────────────────────────────────────────────────
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
  "mode": "one of: Air Express / Air Freight / LCL Express / LCL / Local Delivery / Local Clearance & Delivery / Sea FCL / Sea LCL",
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
    console.error('[ZHL] POST /api/parse-email', err.message);
    res.status(500).json({ error: 'AI parsing failed. Please try again.' });
  }
});

// ─── PARSE EMAIL FILE ───────────────────────────────────────────────────────
app.post('/api/parse-email-file', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    let text = '';
    const name = req.file.originalname.toLowerCase();
    if (name.endsWith('.pdf')) {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(req.file.buffer);
      text = data.text;
    } else {
      text = req.file.buffer.toString('utf-8');
    }
    if (!text.trim()) return res.status(422).json({ error: 'Could not extract text from file' });

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      system: 'You are a freight forwarding operations assistant for Zhenghe Logistics (ZHL), Singapore. Extract job details from emails and job orders. Always return valid JSON only, no other text.',
      messages: [{ role: 'user', content: `Parse this email/job order and return a JSON object with these exact fields (null for missing):
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
  "mode": "one of: Air Express / Air Freight / LCL Express / LCL / Local Delivery / Local Clearance & Delivery / Sea FCL / Sea LCL",
  "agent": "agent name if mentioned",
  "deadline_date": "YYYY-MM-DD or null",
  "customer_ref": "customer reference number",
  "notes": "any other relevant info",
  "billing_lines": [{ "service": "Airfreight", "unit": "kg", "rate": 28, "qty": 136, "remarks": "" }]
}
Email/Job Order:\n${text.substring(0, 8000)}` }]
    });
    const content = msg.content[0].text;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse AI response' });
    res.json(JSON.parse(match[0]));
  } catch (err) {
    console.error('[ZHL] POST /api/parse-email-file', err.message);
    res.status(500).json({ error: 'File parsing failed. Please try again.' });
  }
});

// ─── PARSE INVOICE ──────────────────────────────────────────────────────────
app.post('/api/parse-invoice', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(req.file.buffer);

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
Invoice text:\n${data.text.substring(0, 4000)}` }]
    });
    const content = msg.content[0].text;
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return res.status(422).json({ error: 'Could not parse invoice' });
    res.json(JSON.parse(match[0]));
  } catch (err) {
    console.error('[ZHL] POST /api/parse-invoice', err.message);
    res.status(500).json({ error: 'Invoice parsing failed. Please try again.' });
  }
});

// ─── DASHBOARD ──────────────────────────────────────────────────────────────
app.get('/api/dashboard', async (req, res) => {
  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const today = now.toISOString().split('T')[0];
    const in7days = new Date(now.getTime() + 7*24*60*60*1000).toISOString().split('T')[0];

    // All queries run in parallel — no loops, no N+1
    const [monthRes, byModeRes, trendRes, upcomingRes, flaggedRes, statusRes, missingCountRes] = await Promise.all([
      // This month KPIs
      pool.query(`
        SELECT COUNT(DISTINCT j.id) AS jobs,
          COALESCE(SUM(b.total),0) AS revenue,
          COALESCE(SUM(c.total),0) AS cost
        FROM jobs j
        LEFT JOIN (SELECT job_id, SUM(rate*qty) AS total FROM billing_lines GROUP BY job_id) b ON b.job_id = j.id
        LEFT JOIN (SELECT job_id, SUM(amount)   AS total FROM cost_lines    GROUP BY job_id) c ON c.job_id = j.id
        WHERE j.created_at >= $1
      `, [monthStart]),

      // Jobs by mode
      pool.query(`
        SELECT j.mode,
          COUNT(j.id) AS count,
          COALESCE(SUM(b.total),0) AS revenue
        FROM jobs j
        LEFT JOIN (SELECT job_id, SUM(rate*qty) AS total FROM billing_lines GROUP BY job_id) b ON b.job_id = j.id
        GROUP BY j.mode
        ORDER BY count DESC
      `),

      // 6-month GP% trend
      pool.query(`
        SELECT DATE_TRUNC('month', j.created_at) AS month,
          COALESCE(SUM(b.total),0) AS revenue,
          COALESCE(SUM(c.total),0) AS cost
        FROM jobs j
        LEFT JOIN (SELECT job_id, SUM(rate*qty) AS total FROM billing_lines GROUP BY job_id) b ON b.job_id = j.id
        LEFT JOIN (SELECT job_id, SUM(amount)   AS total FROM cost_lines    GROUP BY job_id) c ON c.job_id = j.id
        WHERE j.created_at >= $1
        GROUP BY DATE_TRUNC('month', j.created_at)
        ORDER BY month
      `, [sixMonthsAgo]),

      // Upcoming deadlines
      pool.query(
        "SELECT id,job_number,shipper,consignee,deadline_date,status FROM jobs WHERE deadline_date >= $1 AND deadline_date <= $2 AND status != 'Completed' ORDER BY deadline_date",
        [today, in7days]
      ),

      // Flagged — no billing lines
      pool.query(
        'SELECT j.id,j.job_number,j.shipper,j.status FROM jobs j WHERE NOT EXISTS (SELECT 1 FROM billing_lines b WHERE b.job_id=j.id) ORDER BY j.id DESC LIMIT 10'
      ),

      // Status counts (for status overview widget)
      pool.query(`
        SELECT status, COUNT(id) AS count
        FROM jobs
        WHERE status != 'Voided'
        GROUP BY status
      `),

      // Total missing costing count (not limited to 10)
      pool.query(`
        SELECT COUNT(j.id) AS count
        FROM jobs j
        WHERE NOT EXISTS (SELECT 1 FROM billing_lines b WHERE b.job_id=j.id)
          AND j.status != 'Voided'
      `),
    ]);

    const m = monthRes.rows[0];
    const monthRevenue = parseFloat(m.revenue);
    const monthCost    = parseFloat(m.cost);
    const monthProfit  = monthRevenue - monthCost;
    const monthGP      = monthRevenue > 0 ? (monthProfit / monthRevenue) * 100 : 0;

    // Build full 6-month array, filling zeros for months with no jobs
    const trendMap = {};
    for (const r of trendRes.rows) {
      const key = new Date(r.month).toISOString().slice(0, 7); // "2026-04"
      trendMap[key] = { revenue: parseFloat(r.revenue), cost: parseFloat(r.cost) };
    }
    const trend = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      const { revenue: rev = 0, cost = 0 } = trendMap[key] || {};
      const profit = rev - cost;
      const gp = rev > 0 ? parseFloat(((profit / rev) * 100).toFixed(1)) : 0;
      trend.push({ month: d.toLocaleString('default', { month: 'short', year: '2-digit' }), gp_percent: gp, revenue: parseFloat(rev.toFixed(2)) });
    }

    res.json({
      this_month: {
        jobs: parseInt(m.jobs),
        revenue: parseFloat(monthRevenue.toFixed(2)),
        cost: parseFloat(monthCost.toFixed(2)),
        profit: parseFloat(monthProfit.toFixed(2)),
        gp_percent: parseFloat(monthGP.toFixed(1))
      },
      by_mode: byModeRes.rows.map(r => ({ mode: r.mode, count: parseInt(r.count), revenue: parseFloat(r.revenue) })),
      trend,
      upcoming_deadlines: upcomingRes.rows,
      flagged_jobs: flaggedRes.rows,
      status_counts: Object.fromEntries(statusRes.rows.map(r => [r.status, parseInt(r.count)])),
      missing_costing_count: parseInt(missingCountRes.rows[0].count)
    });
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = app;
