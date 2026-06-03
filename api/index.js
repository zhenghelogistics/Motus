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
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS inventory_movement_id TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS inventory_movement_no TEXT DEFAULT NULL`);
  await pool.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS packing_list_items JSONB DEFAULT '[]'`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS next_follow_up TIMESTAMP`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS claimed_by TEXT`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_up_note TEXT`);
  await pool.query(`ALTER TABLE leads ADD COLUMN IF NOT EXISTS lost_reason TEXT`);
  await pool.query(`ALTER TABLE fx_rates ADD COLUMN IF NOT EXISTS is_manual BOOLEAN DEFAULT FALSE`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      email         TEXT PRIMARY KEY,
      display_name  TEXT DEFAULT '',
      designation   TEXT DEFAULT '',
      signature_data TEXT DEFAULT '',
      updated_at    TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS marketing_contacts (
      id            SERIAL PRIMARY KEY,
      email         TEXT NOT NULL,
      customer_name TEXT DEFAULT '',
      industry      TEXT DEFAULT '',
      source        TEXT DEFAULT '',
      lead_ref      TEXT DEFAULT '',
      archived_at   TIMESTAMP DEFAULT NOW(),
      UNIQUE(email)
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id            SERIAL PRIMARY KEY,
      ref           TEXT UNIQUE NOT NULL,
      customer_name TEXT DEFAULT '',
      customer_email TEXT DEFAULT '',
      quoted_price  REAL DEFAULT 0,
      industry      TEXT DEFAULT '',
      lead_score    INTEGER DEFAULT 5,
      status        TEXT DEFAULT '',
      stage         TEXT DEFAULT '',
      risk_level    TEXT DEFAULT '',
      source        TEXT DEFAULT '',
      notes         TEXT DEFAULT '',
      created_at    TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS fx_rates (
      currency TEXT PRIMARY KEY,
      rate REAL NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW(),
      updated_by TEXT DEFAULT ''
    )
  `);
  await pool.query(`
    INSERT INTO fx_rates (currency, rate) VALUES
      ('USD', 0.745), ('IDR', 11900), ('EUR', 0.688)
    ON CONFLICT (currency) DO NOTHING
  `);
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
  if (req.url === '/health' || req.url === '/dbtest' || req.url === '/fx-rates/sync' || req.url === '/rfq' || req.url === '/leads/purge-old') return next()
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
        date_out, date_delivered, agent, mode, status, customer_ref, deadline_date, commodity, notes, created_by, packing_list_items)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)
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
      req.user?.email || '',
      JSON.stringify(f.packing_list_items || [])
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
      'customer_name','customer_contact_name','customer_contact_number','customer_email','void_reason','zhl_invoice_no','created_by','inventory_movement_id','inventory_movement_no','packing_list_items'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    if (!Object.keys(updates).length) {
      const r = await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id]);
      return res.json(await enrichJob(r.rows[0]));
    }
    if (updates.packing_list_items !== undefined) {
      updates.packing_list_items = JSON.stringify(updates.packing_list_items)
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

// ─── INVENTORY INTEGRATION ───────────────────────────────────────────────────
app.post('/api/jobs/:id/inventory-link', async (req, res) => {
  try {
    await ensureDB()
    const job = (await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id])).rows[0]
    if (!job) return res.status(404).json({ error: 'Job not found' })
    if (job.mode !== 'Warehousing') return res.status(400).json({ error: 'Job is not a Warehousing job' })
    if (job.inventory_movement_id) {
      // Movement already exists — still push stock lines if there are any
      const items = job.packing_list_items || []
      if (Array.isArray(items) && items.length > 0) {
        const invUrl = process.env.INVENTORY_SUPABASE_URL
        const invKey = process.env.INVENTORY_SUPABASE_SERVICE_KEY
        if (invUrl && invKey) {
          try { await pushStockLines(invUrl, invKey, job.inventory_movement_id, job.job_number, items) } catch (_) {}
        }
      }
      return res.json({ inventory_movement_id: job.inventory_movement_id, inventory_movement_no: job.inventory_movement_no, already_linked: true })
    }

    const invUrl = process.env.INVENTORY_SUPABASE_URL
    const invKey = process.env.INVENTORY_SUPABASE_SERVICE_KEY
    if (!invUrl || !invKey) return res.status(500).json({ error: 'Inventory Supabase credentials not configured' })

    const payload = {
      type:         'Inbound',
      company_name: job.customer_name || job.shipper || job.consignee || '',
      contact_name: job.customer_contact_name || '',
      phone:        job.customer_contact_number || '',
      email:        job.customer_email || '',
      customer_ref: job.customer_ref || '',
      date_in:      job.date_out || new Date().toISOString().slice(0, 10),
      nexus_job_no: job.job_number,
      nexus_job_id: String(job.id),
    }

    const invRes = await fetch(`${invUrl}/rest/v1/movements`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${invKey}`,
        'apikey': invKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
      },
      body: JSON.stringify(payload),
    })

    if (!invRes.ok) {
      const err = await invRes.text()
      console.error('[ZHL] Inventory insert failed:', err)
      return res.status(502).json({ error: `Inventory insert failed: ${err}` })
    }

    const [movement] = await invRes.json()
    const movementId = String(movement.id)
    const movementNo = movement.movement_no ? String(movement.movement_no) : movementId

    await pool.query(
      'UPDATE jobs SET inventory_movement_id=$1, inventory_movement_no=$2 WHERE id=$3',
      [movementId, movementNo, job.id]
    )
    console.log(`[ZHL] Linked ${job.job_number} → Inventory movement ${movementNo} (id: ${movementId})`)

    // Push stock lines if packing list items exist
    const items = job.packing_list_items || []
    if (Array.isArray(items) && items.length > 0) {
      await pushStockLines(invUrl, invKey, movementId, job.job_number, items)
    }

    res.json({ inventory_movement_id: movementId, inventory_movement_no: movementNo })
  } catch (err) {
    console.error(`[ZHL] POST /api/jobs/:id/inventory-link`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

async function pushStockLines(invUrl, invKey, movementId, nexusJobNo, items) {
  // Replace all lines for this movement
  await fetch(`${invUrl}/rest/v1/stock_lines?movement_id=eq.${movementId}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${invKey}`, 'apikey': invKey },
  })
  const lines = items.map(item => ({
    movement_id:  movementId,
    nexus_job_no: nexusJobNo,
    line_type:    'Inbound',
    sku:          item.sku || null,
    description:  item.description || '',
    qty_actual:   item.qty_actual ? Number(item.qty_actual) : null,
    unit:         item.unit || null,
    num_packages: item.num_packages ? Number(item.num_packages) : null,
    length_cm:    item.length_cm ? Number(item.length_cm) : null,
    breadth_cm:   item.breadth_cm ? Number(item.breadth_cm) : null,
    height_cm:    item.height_cm ? Number(item.height_cm) : null,
  }))
  const linesRes = await fetch(`${invUrl}/rest/v1/stock_lines`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${invKey}`,
      'apikey': invKey,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(lines),
  })
  if (!linesRes.ok) {
    const err = await linesRes.text()
    console.error('[ZHL] Stock lines insert failed:', err)
    throw new Error(`Stock lines insert failed: ${err}`)
  }
  console.log(`[ZHL] Pushed ${lines.length} stock line(s) for movement ${movementId}`)
}

app.put('/api/jobs/:id/inventory-void', async (req, res) => {
  try {
    await ensureDB()
    const job = (await pool.query('SELECT inventory_movement_id FROM jobs WHERE id=$1', [req.params.id])).rows[0]
    if (!job) return res.status(404).json({ error: 'Job not found' })
    if (!job.inventory_movement_id) return res.status(400).json({ error: 'No linked inventory movement' })

    const invUrl = process.env.INVENTORY_SUPABASE_URL
    const invKey = process.env.INVENTORY_SUPABASE_SERVICE_KEY
    if (!invUrl || !invKey) return res.status(500).json({ error: 'Inventory Supabase credentials not configured' })

    const invRes = await fetch(`${invUrl}/rest/v1/movements?id=eq.${job.inventory_movement_id}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${invKey}`,
        'apikey': invKey,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({ status: 'Voided' }),
    })

    if (!invRes.ok) {
      const err = await invRes.text()
      console.error('[ZHL] Inventory void failed:', err)
      return res.status(502).json({ error: `Inventory void failed: ${err}` })
    }

    console.log(`[ZHL] Voided Inventory movement ${job.inventory_movement_id}`)
    res.json({ ok: true })
  } catch (err) {
    console.error(`[ZHL] PUT /api/jobs/:id/inventory-void`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

app.post('/api/jobs/:id/inventory-sync-lines', async (req, res) => {
  try {
    await ensureDB()
    const job = (await pool.query('SELECT * FROM jobs WHERE id=$1', [req.params.id])).rows[0]
    if (!job) return res.status(404).json({ error: 'Job not found' })
    if (!job.inventory_movement_id) return res.status(400).json({ error: 'No linked inventory movement' })
    const items = job.packing_list_items || []
    if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'No packing list items to sync' })

    const invUrl = process.env.INVENTORY_SUPABASE_URL
    const invKey = process.env.INVENTORY_SUPABASE_SERVICE_KEY
    if (!invUrl || !invKey) return res.status(500).json({ error: 'Inventory credentials not configured' })

    await pushStockLines(invUrl, invKey, job.inventory_movement_id, job.job_number, items)
    res.json({ ok: true, synced: items.length })
  } catch (err) {
    console.error(`[ZHL] POST /api/jobs/:id/inventory-sync-lines`, err.message)
    res.status(500).json({ error: err.message || 'Sync failed. Please try again.' })
  }
})

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

// ─── PARSE DELIVERY ORDER / PACKING LIST ────────────────────────────────────
app.post('/api/parse-do', upload.single('file'), async (req, res) => {
  const DO_PROMPT = `Extract job details from this delivery order or packing list. Return valid JSON only with these fields (null for missing):
{
  "shipper": "supplier/seller company name",
  "consignee": "buyer/recipient company name",
  "customer_name": "same as consignee",
  "customer_contact_name": "contact person name if present",
  "customer_contact_number": "contact phone if present",
  "pickup_address": "origin/seller address if present",
  "delivery_address": "full delivery address of recipient",
  "delivery_contact_name": "delivery contact name if present",
  "delivery_contact_number": "delivery contact number if present",
  "packages": <total number of cartons/packages as integer>,
  "weight": <total weight in KG as number>,
  "cbm": <total volume in CBM or M3 as number>,
  "dimensions": "carton measurements in format: LxWxH cm ×qty — comma-separated if multiple sizes, e.g. '59x34x38 cm ×16, 41x31x38 cm ×7'",
  "commodity": "short description of the goods",
  "customer_ref": "DO number or invoice number",
  "date_out": "delivery or invoice date as YYYY-MM-DD or null",
  "notes": "any special instructions or remarks",
  "mode": "Warehousing"
}
Return only the JSON object.`
  try {
    let msgContent

    if (req.body.text) {
      // Text extracted client-side — tiny payload, no size issues
      msgContent = [{ type: 'text', text: `${DO_PROMPT}\n\nDocument text:\n${req.body.text.substring(0, 8000)}` }]
    } else if (req.file) {
      // File upload fallback (scanned PDFs, must be <4.5MB due to Vercel limit)
      let extracted = ''
      try {
        const pdfParse = require('pdf-parse')
        const { text } = await pdfParse(req.file.buffer)
        if (text && text.trim().length > 100) extracted = text
      } catch (_) {}

      msgContent = extracted
        ? [{ type: 'text', text: `${DO_PROMPT}\n\nDocument text:\n${extracted.substring(0, 8000)}` }]
        : [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.file.buffer.toString('base64') } },
            { type: 'text', text: DO_PROMPT }
          ]
    } else {
      return res.status(400).json({ error: 'No file or text provided' })
    }

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: msgContent }]
    })
    const content = msg.content[0].text
    const match = content.match(/\{[\s\S]*\}/)
    if (!match) return res.status(422).json({ error: 'Could not parse document' })
    const parsed = JSON.parse(match[0])
    parsed.mode = 'Warehousing'
    res.json(parsed)
  } catch (err) {
    console.error('[ZHL] POST /api/parse-do', err.message)
    res.status(500).json({ error: 'Document parsing failed. Please try again.' })
  }
})

// ─── PARSE PACKING LIST ─────────────────────────────────────────────────────
app.post('/api/parse-packing-list', upload.single('file'), async (req, res) => {
  const PROMPT = `Extract all line items from this packing list. Return a JSON array only — no other text.
Each element must have these fields (use null for missing values):
[{
  "sku": "item code/SKU or null",
  "description": "product name or description",
  "qty_actual": <total quantity as number>,
  "unit": "pcs/cartons/boxes/sets/etc",
  "num_packages": <number of packages/cartons as integer or null>,
  "length_cm": <carton length in cm as number or null>,
  "breadth_cm": <carton width/breadth in cm as number or null>,
  "height_cm": <carton height in cm as number or null>
}]
If no items are found return [].`
  try {
    let msgContent
    if (req.body.text) {
      msgContent = [{ type: 'text', text: `${PROMPT}\n\nDocument text:\n${req.body.text.substring(0, 8000)}` }]
    } else if (req.file) {
      let extracted = ''
      try {
        const pdfParse = require('pdf-parse')
        const { text } = await pdfParse(req.file.buffer)
        if (text && text.trim().length > 50) extracted = text
      } catch (_) {}
      msgContent = extracted
        ? [{ type: 'text', text: `${PROMPT}\n\nDocument text:\n${extracted.substring(0, 8000)}` }]
        : [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.file.buffer.toString('base64') } },
            { type: 'text', text: PROMPT }
          ]
    } else {
      return res.status(400).json({ error: 'No file or text provided' })
    }
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{ role: 'user', content: msgContent }]
    })
    const content = msg.content[0].text
    const match = content.match(/\[[\s\S]*\]/)
    if (!match) return res.status(422).json({ error: 'Could not parse packing list' })
    res.json(JSON.parse(match[0]))
  } catch (err) {
    console.error('[ZHL] POST /api/parse-packing-list', err.message)
    res.status(500).json({ error: 'Packing list parsing failed. Please try again.' })
  }
})

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

// ─── FX RATES ────────────────────────────────────────────────────────────────
// Yahoo Finance tickers: 1 SGD = X [currency]
const FX_YAHOO_PAIRS = { USD: 'SGDUSD=X', EUR: 'SGDEUR=X', IDR: 'SGDIDR=X' }

// Returns the last Monday–Friday of the previous calendar month (UTC)
function getLastWorkingDayOfPrevMonth() {
  const now = new Date()
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)) // last day of prev month
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1)
  return d
}

// Fetch the closing price from Yahoo Finance for a specific date
async function fetchYahooClose(ticker, date) {
  const p1 = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - 1) / 1000)
  const p2 = Math.floor(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 3) / 1000)
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${p1}&period2=${p2}`
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    signal: AbortSignal.timeout(9000),
  })
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${ticker}`)
  const data = await res.json()
  const result = data?.chart?.result?.[0]
  if (!result) throw new Error('No data from Yahoo Finance')
  const targetTs = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000
  const timestamps = result.timestamp || []
  const closes = result.indicators?.quote?.[0]?.close || []
  let bestIdx = -1, bestDiff = Infinity
  for (let i = 0; i < timestamps.length; i++) {
    const diff = Math.abs(timestamps[i] - targetTs)
    if (diff < bestDiff && closes[i] != null) { bestDiff = diff; bestIdx = i }
  }
  if (bestIdx === -1) throw new Error(`No close price found for ${ticker} on ${date.toISOString().split('T')[0]}`)
  return { rate: parseFloat(closes[bestIdx]), date: new Date(timestamps[bestIdx] * 1000).toISOString().split('T')[0] }
}

app.get('/api/fx-rates/sync', async (req, res) => {
  const auth = req.headers.authorization
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    await ensureDB()
    const targetDate = getLastWorkingDayOfPrevMonth()
    const results = []

    for (const [currency, ticker] of Object.entries(FX_YAHOO_PAIRS)) {
      const lockRow = await pool.query('SELECT is_manual FROM fx_rates WHERE currency=$1', [currency])
      if (lockRow.rows[0]?.is_manual) {
        results.push({ currency, skipped: true, reason: 'manually locked' })
        continue
      }
      try {
        const { rate, date } = await fetchYahooClose(ticker, targetDate)
        const updatedBy = `auto-sync (Yahoo close ${date})`
        await pool.query(
          `INSERT INTO fx_rates (currency, rate, updated_at, updated_by, is_manual)
           VALUES ($1,$2,NOW(),$3,FALSE)
           ON CONFLICT (currency) DO UPDATE SET rate=$2, updated_at=NOW(), updated_by=$3, is_manual=FALSE`,
          [currency, rate, updatedBy]
        )
        console.log(`[ZHL] FX sync: 1 SGD = ${rate} ${currency} (close ${date})`)
        results.push({ currency, rate, date, updated: true })
      } catch (e) {
        console.error(`[ZHL] FX sync failed for ${currency}:`, e.message)
        results.push({ currency, error: e.message })
      }
    }

    res.json({ success: true, target_date: targetDate.toISOString().split('T')[0], results, synced_at: new Date() })
  } catch (err) {
    console.error('[ZHL] FX auto-sync error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// Release manual lock (and immediately fetch live rate)
app.put('/api/fx-rates/:currency/unlock', requireAuth, async (req, res) => {
  try {
    await ensureDB()
    const { currency } = req.params
    const ticker = FX_YAHOO_PAIRS[currency]
    let rate = null

    if (ticker) {
      try {
        const targetDate = getLastWorkingDayOfPrevMonth()
        const result = await fetchYahooClose(ticker, targetDate)
        rate = result.rate
      } catch {}
    }

    if (rate) {
      const targetDate = getLastWorkingDayOfPrevMonth()
      const dateStr = targetDate.toISOString().split('T')[0]
      await pool.query(
        `UPDATE fx_rates SET is_manual=FALSE, rate=$1, updated_at=NOW(), updated_by=$3 WHERE currency=$2`,
        [rate, currency, `auto-sync (Yahoo close ${dateStr})`]
      )
      res.json({ success: true, currency, rate, is_manual: false })
    } else {
      await pool.query('UPDATE fx_rates SET is_manual=FALSE WHERE currency=$1', [currency])
      const row = await pool.query('SELECT rate FROM fx_rates WHERE currency=$1', [currency])
      res.json({ success: true, currency, rate: row.rows[0]?.rate, is_manual: false })
    }
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

app.get('/api/fx-rates', async (req, res) => {
  try {
    await ensureDB();
    const r = await pool.query('SELECT * FROM fx_rates ORDER BY currency');
    const rates = {}, is_manual = {};
    let updated_at = null, updated_by = '';
    r.rows.forEach(row => {
      rates[row.currency] = row.rate;
      is_manual[row.currency] = !!row.is_manual;
      if (!updated_at || new Date(row.updated_at) > new Date(updated_at)) {
        updated_at = row.updated_at;
        updated_by = row.updated_by;
      }
    });
    res.json({ rates, is_manual, updated_at, updated_by });
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

app.put('/api/fx-rates', requireAuth, async (req, res) => {
  try {
    await ensureDB();
    const { rates } = req.body;
    const updatedBy = req.user?.email || '';
    const now = new Date();
    await Promise.all(Object.entries(rates).map(([currency, rate]) =>
      pool.query(
        `INSERT INTO fx_rates (currency, rate, updated_at, updated_by, is_manual)
         VALUES ($1,$2,$3,$4,TRUE)
         ON CONFLICT (currency) DO UPDATE SET rate=$2, updated_at=$3, updated_by=$4, is_manual=TRUE`,
        [currency, parseFloat(rate), now, updatedBy]
      )
    ));
    res.json({ success: true, updated_at: now, updated_by: updatedBy });
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ─── COMPANY STATS ───────────────────────────────────────────────────────────
app.get('/api/stats/companies', async (req, res) => {
  try {
    const [companiesRes, modesRes] = await Promise.all([
      pool.query(`
        SELECT COALESCE(NULLIF(TRIM(customer_name),''), NULLIF(TRIM(shipper),'')) AS name, COUNT(*) AS jobs
        FROM jobs
        WHERE COALESCE(NULLIF(TRIM(customer_name),''), NULLIF(TRIM(shipper),'')) IS NOT NULL
        GROUP BY 1 ORDER BY jobs DESC, name
      `),
      pool.query(`SELECT DISTINCT UPPER(TRIM(mode)) AS mode FROM jobs WHERE mode IS NOT NULL AND TRIM(mode) != '' ORDER BY 1`)
    ])
    res.json({
      companies: companiesRes.rows.filter(r => r.name).map(r => ({ name: r.name, jobs: parseInt(r.jobs) })),
      modes: modesRes.rows.map(r => r.mode)
    })
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

app.get('/api/stats/company', async (req, res) => {
  try {
    const { company, year, month, mode } = req.query
    const y = parseInt(year) || new Date().getFullYear()
    const m = month ? parseInt(month) : null
    const start = m ? new Date(y, m - 1, 1) : new Date(y, 0, 1)
    const end   = m ? new Date(y, m, 1)     : new Date(y + 1, 0, 1)

    const params = [start, end]
    const conditions = [`j.created_at >= $1 AND j.created_at < $2`]
    if (company && company !== '__all__') {
      params.push(`%${company}%`)
      conditions.push(`(COALESCE(NULLIF(j.customer_name,''), j.shipper) ILIKE $${params.length})`)
    }
    if (mode && mode !== '__all__') {
      params.push(mode)
      conditions.push(`UPPER(TRIM(j.mode)) = UPPER(TRIM($${params.length}))`)
    }
    const baseWhere = `WHERE ${conditions.join(' AND ')}`

    const [summaryRes, byModeRes, trendRes] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(j.id) AS jobs,
          COALESCE(SUM(j.packages), 0) AS packages,
          COALESCE(SUM(j.weight),   0) AS weight,
          COALESCE(SUM(j.cbm),      0) AS cbm,
          COALESCE(SUM(b.total),    0) AS revenue,
          COALESCE(SUM(c.total),    0) AS cost
        FROM jobs j
        LEFT JOIN (SELECT job_id, SUM(rate*qty) AS total FROM billing_lines GROUP BY job_id) b ON b.job_id = j.id
        LEFT JOIN (SELECT job_id, SUM(amount)   AS total FROM cost_lines    GROUP BY job_id) c ON c.job_id = j.id
        ${baseWhere}
      `, params),

      pool.query(`
        SELECT
          j.mode,
          COUNT(j.id) AS jobs,
          COALESCE(SUM(j.packages), 0) AS packages,
          COALESCE(SUM(j.weight),   0) AS weight,
          COALESCE(SUM(j.cbm),      0) AS cbm,
          COALESCE(SUM(b.total),    0) AS revenue,
          COALESCE(SUM(c.total),    0) AS cost
        FROM jobs j
        LEFT JOIN (SELECT job_id, SUM(rate*qty) AS total FROM billing_lines GROUP BY job_id) b ON b.job_id = j.id
        LEFT JOIN (SELECT job_id, SUM(amount)   AS total FROM cost_lines    GROUP BY job_id) c ON c.job_id = j.id
        ${baseWhere}
        GROUP BY j.mode
        ORDER BY revenue DESC
      `, params),

      m ? Promise.resolve({ rows: [] }) : pool.query(`
        SELECT
          DATE_TRUNC('month', j.created_at) AS month,
          COUNT(j.id) AS jobs,
          COALESCE(SUM(b.total), 0) AS revenue,
          COALESCE(SUM(c.total), 0) AS cost
        FROM jobs j
        LEFT JOIN (SELECT job_id, SUM(rate*qty) AS total FROM billing_lines GROUP BY job_id) b ON b.job_id = j.id
        LEFT JOIN (SELECT job_id, SUM(amount)   AS total FROM cost_lines    GROUP BY job_id) c ON c.job_id = j.id
        ${baseWhere}
        GROUP BY DATE_TRUNC('month', j.created_at)
        ORDER BY month
      `, params),
    ])

    const s = summaryRes.rows[0]
    const rev = parseFloat(s.revenue), cst = parseFloat(s.cost), pft = parseFloat(s.revenue) - parseFloat(s.cost)
    const gp  = rev > 0 ? parseFloat(((pft / rev) * 100).toFixed(1)) : 0

    const by_mode = byModeRes.rows.map(r => {
      const rv = parseFloat(r.revenue), ct = parseFloat(r.cost), pt = parseFloat(r.revenue) - parseFloat(r.cost)
      return {
        mode: r.mode, jobs: parseInt(r.jobs),
        packages: parseFloat(r.packages) || 0,
        weight:   parseFloat(r.weight)   || 0,
        cbm:      parseFloat(r.cbm)      || 0,
        revenue:  parseFloat(rv.toFixed(2)),
        cost:     parseFloat(ct.toFixed(2)),
        profit:   parseFloat(pt.toFixed(2)),
        gp_percent: rv > 0 ? parseFloat(((pt / rv) * 100).toFixed(1)) : 0
      }
    })

    const monthly_trend = trendRes.rows.map(r => {
      const rv = parseFloat(r.revenue), ct = parseFloat(r.cost), pt = parseFloat(r.revenue) - parseFloat(r.cost)
      return {
        month: new Date(r.month).toISOString().slice(0, 7),
        jobs: parseInt(r.jobs),
        revenue: parseFloat(rv.toFixed(2)),
        cost:    parseFloat(ct.toFixed(2)),
        profit:  parseFloat(pt.toFixed(2)),
        gp_percent: rv > 0 ? parseFloat(((pt / rv) * 100).toFixed(1)) : 0
      }
    })

    res.json({
      company, year: y, month: m,
      summary: {
        jobs: parseInt(s.jobs),
        packages: parseFloat(s.packages) || 0,
        weight:   parseFloat(s.weight)   || 0,
        cbm:      parseFloat(s.cbm)      || 0,
        revenue:  parseFloat(rev.toFixed(2)),
        cost:     parseFloat(cst.toFixed(2)),
        profit:   parseFloat(pft.toFixed(2)),
        gp_percent: gp
      },
      by_mode,
      monthly_trend
    })
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

// ─── LEADS ───────────────────────────────────────────────────────────────────
app.get('/api/leads/stats', async (req, res) => {
  try {
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
    const [activeRes, wonRes, industryRes, statusRes] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(quoted_price),0) AS pipeline_value
                  FROM leads WHERE (is_archived IS NULL OR is_archived=FALSE) AND status NOT IN ('Won','Lost')`),
      pool.query(`SELECT COUNT(*) AS count, COALESCE(SUM(quoted_price),0) AS value
                  FROM leads WHERE status='Won' AND created_at>=$1`, [monthStart]),
      pool.query(`SELECT industry, COUNT(*) AS count FROM leads
                  WHERE (is_archived IS NULL OR is_archived=FALSE) GROUP BY industry ORDER BY count DESC`),
      pool.query(`SELECT status, COUNT(*) AS count FROM leads
                  WHERE (is_archived IS NULL OR is_archived=FALSE) GROUP BY status`),
    ])
    res.json({
      total_active:     parseInt(activeRes.rows[0].total),
      pipeline_value:   parseFloat(activeRes.rows[0].pipeline_value),
      won_this_month:   { count: parseInt(wonRes.rows[0].count), value: parseFloat(wonRes.rows[0].value) },
      by_industry:      industryRes.rows.map(r => ({ industry: r.industry, count: parseInt(r.count) })),
      by_status:        Object.fromEntries(statusRes.rows.map(r => [r.status, parseInt(r.count)])),
    })
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

// ── User Profile ─────────────────────────────────────────────────────────────
app.get('/api/profile', async (req, res) => {
  try {
    const email = req.user.email
    const r = await pool.query('SELECT * FROM user_profiles WHERE email=$1', [email])
    res.json(r.rows[0] || { email, display_name: '', designation: '', signature_data: '' })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.put('/api/profile', async (req, res) => {
  try {
    const email = req.user.email
    const { display_name, designation, signature_data } = req.body
    await pool.query(`
      INSERT INTO user_profiles (email, display_name, designation, signature_data, updated_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (email) DO UPDATE SET
        display_name=$2, designation=$3, signature_data=$4, updated_at=NOW()
    `, [email, display_name || '', designation || '', signature_data || ''])
    res.json({ ok: true })
  } catch (err) { res.status(500).json({ error: err.message }) }
})

app.get('/api/leads/new-count', async (req, res) => {
  try {
    const since = req.query.since ? new Date(req.query.since) : new Date(0)
    const r = await pool.query(
      `SELECT COUNT(*) as count FROM leads WHERE created_at > $1 AND (is_archived IS NULL OR is_archived = FALSE)`,
      [since]
    )
    res.json({ count: parseInt(r.rows[0].count) })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/leads', async (req, res) => {
  try {
    const archived = req.query.archived === 'true'
    const where = archived ? `WHERE is_archived=TRUE` : `WHERE (is_archived IS NULL OR is_archived=FALSE)`
    const r = await pool.query(
      `SELECT id, ref, customer_name, customer_email, quoted_price, industry, lead_score,
              status, stage, risk_level, source, notes, created_at, next_follow_up, is_archived,
              claimed_by, claimed_at, follow_up_note, lost_reason
       FROM leads ${where} ORDER BY created_at DESC`
    )
    res.json(r.rows)
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

app.post('/api/leads', async (req, res) => {
  try {
    const f = req.body || {}
    const ref = `ZL-${Date.now()}`
    const r = await pool.query(
      `INSERT INTO leads (ref, customer_name, customer_email, quoted_price, industry,
         lead_score, status, stage, risk_level, source, notes, next_follow_up)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [ ref, f.customer_name||'', f.customer_email||'',
        parseFloat(f.quoted_price)||0, f.industry||'General',
        parseInt(f.lead_score)||5, f.status||'New Lead', f.stage||'',
        f.risk_level||'Medium', f.source||'manual', f.notes||'',
        f.next_follow_up||null ]
    )
    res.status(201).json(r.rows[0])
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

app.put('/api/leads/:id', async (req, res) => {
  try {
    const allowed = ['customer_name','customer_email','quoted_price','industry',
                     'status','stage','risk_level','source','notes','next_follow_up','is_archived',
                     'follow_up_note','lost_reason','claimed_by']
    const updates = {}
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f] })
    if (Object.keys(updates).length) {
      const cols = Object.keys(updates).map((k,i) => `${k}=$${i+1}`).join(', ')
      const vals = [...Object.values(updates), req.params.id]
      await pool.query(`UPDATE leads SET ${cols} WHERE id=$${vals.length}`, vals)
    }
    const updated = (await pool.query('SELECT * FROM leads WHERE id=$1', [req.params.id])).rows[0]
    res.json(updated)
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

app.delete('/api/leads/:id', async (req, res) => {
  try {
    const lead = (await pool.query('SELECT customer_email, customer_name, industry, source, ref FROM leads WHERE id=$1', [req.params.id])).rows[0]
    if (!lead) return res.status(404).json({ error: 'Lead not found' })
    if (lead.customer_email) {
      await pool.query(
        `INSERT INTO marketing_contacts (email, customer_name, industry, source, lead_ref, archived_at)
         VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT (email) DO NOTHING`,
        [lead.customer_email, lead.customer_name, lead.industry, lead.source, lead.ref]
      )
    }
    await pool.query('DELETE FROM leads WHERE id=$1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

app.put('/api/leads/:id/claim', async (req, res) => {
  try {
    const existing = await pool.query('SELECT claimed_by FROM leads WHERE id=$1', [req.params.id])
    if (!existing.rows.length) return res.status(404).json({ error: 'Lead not found' })
    if (existing.rows[0].claimed_by) {
      return res.status(409).json({ error: 'Already claimed', claimed_by: existing.rows[0].claimed_by })
    }
    const claimedBy = req.user?.email || req.user?.id || 'Unknown'
    const r = await pool.query(
      'UPDATE leads SET claimed_by=$1, claimed_at=NOW() WHERE id=$2 RETURNING *',
      [claimedBy, req.params.id]
    )
    res.json(r.rows[0])
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

// ─── AI EMAIL GENERATOR ──────────────────────────────────────────────────────
app.post('/api/leads/:id/generate-email', async (req, res) => {
  try {
    const lead = (await pool.query('SELECT * FROM leads WHERE id=$1', [req.params.id])).rows[0]
    if (!lead) return res.status(404).json({ error: 'Lead not found' })

    const { email_type, options = {} } = req.body
    const clientName = lead.customer_name || 'there'

    let userPrompt = ''
    if (email_type === 'info_request') {
      const fields = (options.fields || []).join(', ') || 'missing shipment details'
      const custom = options.custom_questions ? ` Also ask: ${options.custom_questions}` : ''
      userPrompt = `Write an email to ${clientName} (${lead.customer_email || 'the client'}) requesting the following missing information for their freight enquiry: ${fields}.${custom} Freight context from their enquiry: ${lead.notes || 'No additional notes.'}`
    } else if (email_type === 'quote_confirmation') {
      const price = lead.quoted_price > 0 ? `SGD ${Number(lead.quoted_price).toLocaleString()}` : 'as per our discussion'
      const includes = (options.include || []).join(', ') || 'standard terms'
      userPrompt = `Write a quote confirmation email to ${clientName} confirming their freight quote of ${price}. Include in the email: ${includes}. Freight context: ${lead.notes || 'Standard shipment.'}`
    } else if (email_type === 'introduction') {
      const services = (options.services || []).join(', ') || 'freight forwarding services'
      const angle = options.angle || 'competitive rates and reliable service across Asia'
      userPrompt = `Write a concise cold introduction email to ${clientName} at their company. Highlight these freight services: ${services}. Key value proposition: ${angle}. Do not use their email address in the body.`
    } else {
      return res.status(400).json({ error: 'Invalid email_type' })
    }

    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: 'You are a professional logistics sales representative at Zhenghe Logistics, a freight forwarding company based in Singapore. Write concise, professional emails in English. Be warm but efficient. Use the client\'s name naturally. Never invent rates, prices, or terms not provided to you. Always sign off as "Zhenghe Logistics Team".',
      tools: [{
        name: 'compose_email',
        description: 'Compose a professional logistics email',
        input_schema: {
          type: 'object',
          properties: {
            subject: { type: 'string', description: 'Concise email subject line' },
            body:    { type: 'string', description: 'Full email body with greeting and sign-off' }
          },
          required: ['subject', 'body']
        }
      }],
      tool_choice: { type: 'tool', name: 'compose_email' },
      messages: [{ role: 'user', content: userPrompt }]
    })

    const toolBlock = msg.content.find(c => c.type === 'tool_use' && c.name === 'compose_email')
    if (!toolBlock) return res.status(422).json({ error: 'AI did not return a structured email' })
    res.json(toolBlock.input)
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Email generation failed. Please try again.' })
  }
})

// ─── RFQ WEBHOOK (public — no auth) ─────────────────────────────────────────
function rfqCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

app.options('/api/rfq', (req, res) => {
  rfqCors(res)
  res.status(200).end()
})

function inferIndustry(commodity) {
  const c = (commodity || '').toLowerCase()
  if (/electron|server|computing|software|hardware|semiconductor|component/.test(c)) return 'Tech'
  if (/pharma|medical|clinical|vaccine|biotech|chemical/.test(c)) return 'Pharmaceuticals'
  if (/textile|polyester|machinery|parts|industrial|factory|steel|metal/.test(c)) return 'Manufacturing'
  if (/food|agri|coconut|palm|grain|timber|mineral|commodity/.test(c)) return 'Commodities'
  if (/retail|garment|apparel|consumer|fashion|footwear/.test(c)) return 'Retail'
  return 'General'
}

function buildRfqNotes(b, mode, addons) {
  const s = (v) => v || '—'
  const lines = [
    `MODE: ${mode} | ROUTE: ${s(b.origin)} → ${s(b.destination)}`,
    `SERVICE: ${s(b.serviceType)} | INCOTERM: ${s(b.incoterm)} | LOAD: ${s(b.loadType)}`,
  ]
  if (b.containerSize) lines.push(`CONTAINER: ${b.containerSize}`)
  lines.push('---', 'CARGO')
  if (b.commodityName)      lines.push(`  Commodity: ${b.commodityName}`)
  if (b.hsCode)             lines.push(`  HS Code: ${b.hsCode}`)
  if (b.quantity)           lines.push(`  Quantity: ${b.quantity}`)
  if (b.weight)             lines.push(`  Weight: ${b.weight}`)
  if (b.packagingType)      lines.push(`  Packaging: ${b.packagingType}`)
  if (b.dimensions)         lines.push(`  Dimensions: ${b.dimensions}`)
  lines.push('---', 'CONTACT')
  lines.push(`  Company: ${s(b.companyName)}`)
  lines.push(`  Person: ${s(b.contactPerson)}`)
  lines.push(`  Email: ${s(b.emailAddress)}`)
  lines.push(`  Phone: ${s(b.phoneNumber)}`)
  if (b.pickupAddress || b.deliveryAddress) {
    lines.push('---', 'ADDRESSES')
    if (b.pickupAddress)   lines.push(`  Pickup: ${b.pickupAddress}`)
    if (b.deliveryAddress) lines.push(`  Delivery: ${b.deliveryAddress}`)
  }
  if (addons || b.specialHandlingNotes) {
    lines.push('---')
    if (addons)                  lines.push(`ADDONS: ${addons}`)
    if (b.specialHandlingNotes)  lines.push(`SPECIAL HANDLING: ${b.specialHandlingNotes}`)
  }
  lines.push('---', `Submitted: ${new Date().toISOString()}`)
  return lines.join('\n')
}

app.post('/api/rfq', async (req, res) => {
  rfqCors(res)
  try {
    const b = req.body || {}
    const str = (v) => (v == null ? '' : String(v))

    const companyName        = str(b.companyName)
    const contactPerson      = str(b.contactPerson)
    const emailAddress       = str(b.emailAddress)
    const phoneNumber        = str(b.phoneNumber)
    const mode               = (str(b.mode) || 'SEA').toUpperCase()
    const origin             = str(b.origin)
    const destination        = str(b.destination)
    const serviceType        = str(b.serviceType)
    const incoterm           = str(b.incoterm)
    const loadType           = str(b.loadType)
    const containerSize      = str(b.containerSize)
    const dimensions         = str(b.dimensions)
    const commodityName      = str(b.commodityName)
    const hsCode             = str(b.hsCode)
    const quantity           = str(b.quantity)
    const weight             = str(b.weight)
    const packagingType      = str(b.packagingType)
    const pickupAddress      = str(b.pickupAddress)
    const deliveryAddress    = str(b.deliveryAddress)
    const specialHandlingNotes = str(b.specialHandlingNotes)
    const addons = Array.isArray(b.addons) ? b.addons.join(', ') : str(b.addons)

    const ref      = `ZL-${Date.now()}`
    const industry = inferIndustry(commodityName)
    const notes    = buildRfqNotes(
      { companyName, contactPerson, emailAddress, phoneNumber, origin, destination,
        serviceType, incoterm, loadType, containerSize, dimensions, commodityName,
        hsCode, quantity, weight, packagingType, pickupAddress, deliveryAddress, specialHandlingNotes },
      mode, addons
    )

    const r = await pool.query(
      `INSERT INTO leads
         (ref, customer_name, customer_email, quoted_price, industry,
          lead_score, status, stage, risk_level, source, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id`,
      [ref, companyName || contactPerson, emailAddress, 0, industry,
       5, 'RFQ Received', 'RFQ Received', 'High', 'website', notes]
    )

    const leadId = r.rows[0].id
    console.log(`[ZHL] RFQ saved: ${ref} | ${companyName || contactPerson || '(anonymous)'} | ${industry}`)
    res.status(201).json({ success: true, leadId, ref })
  } catch (err) {
    console.error('[ZHL] POST /api/rfq', err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

// ─── LEADS PURGE CRON ────────────────────────────────────────────────────────
// Called by Vercel cron daily. Copies email of leads >30 days old to
// marketing_contacts, then deletes those lead records.
app.get('/api/leads/purge-old', async (req, res) => {
  const auth = req.headers.authorization
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    await ensureDB()
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - 30)

    const oldLeads = await pool.query(
      `SELECT id, ref, customer_name, customer_email, industry, source
       FROM leads WHERE created_at < $1 AND (customer_email IS NOT NULL AND customer_email <> '')`,
      [cutoff]
    )

    let archived = 0, skipped = 0, deleted = 0
    for (const lead of oldLeads.rows) {
      try {
        await pool.query(
          `INSERT INTO marketing_contacts (email, customer_name, industry, source, lead_ref, archived_at)
           VALUES ($1,$2,$3,$4,$5,NOW())
           ON CONFLICT (email) DO NOTHING`,
          [lead.customer_email, lead.customer_name, lead.industry, lead.source, lead.ref]
        )
        archived++
      } catch { skipped++ }
    }

    const del = await pool.query(`DELETE FROM leads WHERE created_at < $1`, [cutoff])
    deleted = del.rowCount

    console.log(`[ZHL] Leads purge: ${deleted} deleted, ${archived} emails archived, ${skipped} skipped`)
    res.json({ success: true, deleted, archived, skipped, cutoff })
  } catch (err) {
    console.error('[ZHL] leads purge error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ─── MARKETING CONTACTS ──────────────────────────────────────────────────────
app.get('/api/marketing-contacts', async (req, res) => {
  try {
    await ensureDB()
    const r = await pool.query(
      `SELECT id, email, customer_name, industry, source, lead_ref, archived_at
       FROM marketing_contacts ORDER BY archived_at DESC`
    )
    res.json(r.rows)
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

app.delete('/api/marketing-contacts/:id', async (req, res) => {
  try {
    await ensureDB()
    await pool.query('DELETE FROM marketing_contacts WHERE id=$1', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    console.error(`[ZHL] ${req.method} ${req.url}`, err.message)
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

module.exports = app;
