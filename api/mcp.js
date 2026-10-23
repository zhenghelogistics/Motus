// Model Context Protocol server for Motus.
//
// MCP is far less exotic than the name suggests. A client (Claude) asks "what can you
// do?", we hand back a list of tools with JSON schemas and descriptions written for a
// model to read; the client then says "run search_jobs with these arguments" and we run
// it. It is JSON-RPC 2.0, and over HTTP it is a single POST endpoint.
//
// This module holds the protocol envelope and the tool catalogue and nothing else — no
// database, no Express. The actual queries are injected as `impls` by index.js, which
// is what lets the whole thing be unit tested without a Postgres connection.
//
// EVERY TOOL HERE IS READ-ONLY, deliberately. Motus has no role system: any
// authenticated user can delete any job. That is tolerable when the only way in is a UI
// a human drives, and much less so when the caller is a model acting on an instruction
// it may have misread. Writes can come later, behind a permission column, and should
// never include deletes.

const crypto = require('crypto')

const SERVER_NAME = 'motus'
const SERVER_VERSION = '1.0.0'

// We answer with whichever revision the client asked for when we know it, and otherwise
// name our own. Clients are version-tolerant; this just avoids a needless handshake
// failure when a newer client talks to this server.
const LATEST_PROTOCOL = '2025-06-18'
const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05']

// ─── TOOL CATALOGUE ──────────────────────────────────────────────────────────
// The `description` fields are prompt text, not documentation. They are the only thing
// the model has to decide between tools, so they say when to reach for each one and
// what it costs, not just what it returns.

const TOOLS = [
  {
    name: 'search_jobs',
    description:
      'Find freight jobs by free text, status or transport mode. Returns a compact summary of each match (job number, customer, mode, status, dates, revenue, cost, profit and GP%), not the full job. Use this to locate jobs or to answer "how many" and "which ones" questions; follow up with get_job when the detail of one specific job matters.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text matched against job number, shipper, consignee, customer reference and agent.' },
        status: { type: 'string', description: 'Exact job status, e.g. New, In Progress, Completed, Voided.' },
        mode: { type: 'string', description: 'Transport mode, e.g. Air Freight, Sea Freight, Local Delivery.' },
        customer: { type: 'string', description: 'Customer or shipper name, matched as a substring.' },
        limit: { type: 'integer', description: 'Maximum rows to return. Default 25, maximum 100.' },
      },
      required: [],
    },
  },
  {
    name: 'get_job',
    description:
      'Fetch one job in full: every cost line, every billing line, the split-invoicing entities and their shares, and the attached documents. Give either job_number or job_id. This is the expensive one — use search_jobs first unless the job is already identified.',
    inputSchema: {
      type: 'object',
      properties: {
        job_number: { type: 'string', description: 'The job number as staff refer to it, e.g. ZHL25-0412.' },
        job_id: { type: 'integer', description: 'The internal numeric id, if known.' },
      },
      required: [],
    },
  },
  {
    name: 'search_leads',
    description:
      'Search the sales pipeline: enquiries that have not necessarily become jobs. Returns customer, contact, origin and destination, quoted price, stage, status, who claimed it, and the free-text loss reason where one was recorded. Use this for questions about quoting, win rates and why business was lost.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text matched against customer name, email, contact person, reference, origin, destination and commodity.' },
        status: { type: 'string', description: 'Exact status, e.g. Won, Lost, Quoted.' },
        stage: { type: 'string', description: 'Exact pipeline stage.' },
        include_archived: { type: 'boolean', description: 'Include dormant/archived leads. Default false.' },
        limit: { type: 'integer', description: 'Maximum rows to return. Default 25, maximum 100.' },
      },
      required: [],
    },
  },
  {
    name: 'movement_report',
    description:
      'The performance report for a month, quarter or year: jobs moved, tonnage and volume, revenue, cost, gross profit, on-time delivery rate, breakdowns by transport mode and by customer, and a like-for-like comparison against the preceding period showing which customers and service lines moved. This is the single best tool for "how did we do" questions. All figures are computed in the database, so treat them as authoritative and do not recalculate them.',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: "The period: 'YYYY-MM' for a month, 'YYYY-Qn' for a quarter, 'YYYY' for a year. Defaults to the current month." },
      },
      required: [],
    },
  },
  {
    name: 'pipeline_report',
    description:
      'The monthly business-development report: enquiries received, won, lost and still open, win rate, value won, response times, per-salesperson performance, and the reasons recorded for losses. Covers what might come in. For what the business actually moved and earned, use movement_report instead.',
    inputSchema: {
      type: 'object',
      properties: {
        month: { type: 'string', description: "Month as 'YYYY-MM'. Defaults to the current month." },
      },
      required: [],
    },
  },
  {
    name: 'company_stats',
    description:
      'Volume and revenue for one customer over a year or a single month: job count, packages, weight, CBM, revenue, cost, profit, plus a breakdown by transport mode and a month-by-month trend. The company name must match exactly, so call list_companies first if you are working from a name a human typed.',
    inputSchema: {
      type: 'object',
      properties: {
        company: { type: 'string', description: "Exact customer name as it appears in list_companies. Omit, or pass '__all__', for the whole book of business." },
        year: { type: 'integer', description: 'Four-digit year. Defaults to the current year.' },
        month: { type: 'integer', description: 'Month number 1-12. Omit for the full year.' },
        mode: { type: 'string', description: 'Restrict to one transport mode.' },
      },
      required: [],
    },
  },
  {
    name: 'list_companies',
    description:
      'List every customer Motus has jobs for, with how many jobs each has, plus the transport modes in use. Cheap. Call it to resolve a half-remembered or misspelled customer name into the exact string company_stats needs.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'list_rate_cards',
    description:
      'The negotiated rate cards held for freight partners and vendors, with every charge line (service, unit, rate, currency, minimum, break points and validity dates). Use this to answer what a lane or service should cost before quoting. These are buying rates from vendors, not selling rates to customers.',
    inputSchema: {
      type: 'object',
      properties: {
        vendor: { type: 'string', description: 'Vendor name, matched as a substring.' },
        mode: { type: 'string', description: 'Transport mode the card covers, e.g. Air Freight, Sea Freight.' },
        active_only: { type: 'boolean', description: 'Only cards still marked active. Default true.' },
      },
      required: [],
    },
  },
]

// ─── AUTH ────────────────────────────────────────────────────────────────────
// Tokens are configured as MCP_TOKENS="max:s3cret,director:0ther". The label is not a
// security boundary, it is so the request log says who called rather than just "someone
// with a valid token" — which matters more here than in the app, because these calls
// arrive without a browser session behind them.

function parseTokens(raw) {
  return String(raw || '')
    .split(',')
    .map(part => {
      const entry = part.trim()
      if (!entry) return null
      const sep = entry.indexOf(':')
      if (sep > 0) return { label: entry.slice(0, sep).trim(), secret: entry.slice(sep + 1).trim() }
      return { label: 'mcp', secret: entry }
    })
    .filter(t => t && t.secret)
}

// Digests rather than the raw strings, so the comparison is both constant-time AND
// length-safe: timingSafeEqual throws on a length mismatch, which would otherwise leak
// the token length through an exception.
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest()

function identifyToken(authHeader, tokens) {
  const presented = String(authHeader || '').replace(/^Bearer\s+/i, '').trim()
  if (!presented || !tokens.length) return null
  const given = sha256(presented)
  let match = null
  // No early return: every configured token is checked on every call so the time taken
  // does not reveal which position matched.
  for (const t of tokens) {
    if (crypto.timingSafeEqual(given, sha256(t.secret))) match = match || t.label
  }
  return match
}

// ─── JSON-RPC ────────────────────────────────────────────────────────────────

const NO_RESPONSE = Symbol('no-response')

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id, code, message) {
  return { jsonrpc: '2.0', id: id === undefined ? null : id, error: { code, message } }
}

function rpcFail(code, message) {
  const e = new Error(message)
  e.rpcCode = code
  return e
}

// Tool output is serialised compactly rather than pretty-printed: indentation is
// perfectly readable to a model and costs real tokens in its context window.
function toolText(data) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data) }] }
}

// A tool that fails is reported INSIDE a successful result with isError set, not as a
// JSON-RPC error. That is the spec's intent and it is also more useful: the model sees
// the message and can correct itself, where a protocol error just aborts the turn.
function toolError(message) {
  return { content: [{ type: 'text', text: message }], isError: true }
}

function initializeResult(params) {
  const asked = params && params.protocolVersion
  return {
    protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : LATEST_PROTOCOL,
    capabilities: { tools: { listChanged: false } },
    serverInfo: { name: SERVER_NAME, title: 'Motus', version: SERVER_VERSION },
    instructions:
      'Motus is Zhenghe Logistics\' freight forwarding operations system. It holds jobs (shipments with their cost and billing lines), leads (the sales pipeline) and vendor rate cards. All figures are in SGD unless a line states its own currency. Every tool here reads; nothing you call can change or delete anything. Figures returned by the report tools are computed in the database and are already correct, so quote them rather than recomputing them.',
  }
}

async function callTool(params, impls) {
  const name = params && params.name
  const tool = TOOLS.find(t => t.name === name)
  if (!tool) throw rpcFail(-32602, `Unknown tool: ${name}`)

  const impl = impls[name]
  if (typeof impl !== 'function') throw rpcFail(-32603, `Tool ${name} is not implemented`)

  const args = (params && params.arguments) || {}
  const missing = (tool.inputSchema.required || []).filter(k => args[k] === undefined || args[k] === '')
  if (missing.length) return toolError(`Missing required argument(s): ${missing.join(', ')}`)

  try {
    return toolText(await impl(args))
  } catch (err) {
    return toolError(err.message || 'The tool failed.')
  }
}

async function dispatch(msg, impls) {
  switch (msg.method) {
    case 'initialize': return initializeResult(msg.params)
    case 'ping': return {}
    case 'tools/list': return { tools: TOOLS }
    // We advertise neither resources nor prompts, but well-behaved clients still probe
    // for them. An empty list is quieter than a "method not found" in the logs.
    case 'resources/list': return { resources: [] }
    case 'resources/templates/list': return { resourceTemplates: [] }
    case 'prompts/list': return { prompts: [] }
    case 'tools/call': return await callTool(msg.params, impls)
    default:
      if (typeof msg.method === 'string' && msg.method.startsWith('notifications/')) return NO_RESPONSE
      throw rpcFail(-32601, `Unknown method: ${msg.method}`)
  }
}

// Returns the response object, or null when nothing should be sent back (a
// notification, which by definition carries no id and expects no reply).
async function handleRpc(msg, impls) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return rpcError(null, -32600, 'Invalid request: expected a JSON-RPC object')
  }
  if (msg.jsonrpc !== '2.0') {
    return rpcError(msg.id, -32600, 'Invalid request: jsonrpc must be "2.0"')
  }
  if (typeof msg.method !== 'string') {
    return rpcError(msg.id, -32600, 'Invalid request: method is required')
  }

  const isNotification = !('id' in msg)
  try {
    const result = await dispatch(msg, impls)
    if (result === NO_RESPONSE || isNotification) return null
    return rpcResult(msg.id, result)
  } catch (err) {
    if (isNotification) return null
    return rpcError(msg.id, err.rpcCode || -32603, err.message || 'Internal error')
  }
}

module.exports = {
  TOOLS,
  SERVER_NAME,
  SERVER_VERSION,
  LATEST_PROTOCOL,
  SUPPORTED_PROTOCOLS,
  parseTokens,
  identifyToken,
  handleRpc,
  toolText,
  toolError,
}
