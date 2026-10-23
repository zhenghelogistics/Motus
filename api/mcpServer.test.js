const test = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const {
  TOOLS, LATEST_PROTOCOL, parseTokens, identifyToken, handleRpc,
} = require('./mcpServer')

const noImpls = {}

// ─── DEPLOYMENT SHAPE ────────────────────────────────────────────────────────
// This one is here because it took production down.
//
// Vercel turns every file under /api into its own serverless function, named after the
// file. A helper called api/mcp.js therefore IS the route /api/mcp, it wins over the
// rewrite that sends /api/* to index.js, and Vercel invokes a module that exports a
// plain object instead of a handler. The result is FUNCTION_INVOCATION_FAILED on every
// request to that path, with the rest of the app looking perfectly healthy.
//
// Hence mcpServer.js rather than mcp.js. The existing helpers (rateCalc, movementReport,
// leadConversion) never hit this only because none of their names happen to match a route.
test('no helper module is named after a route it would then shadow', () => {
  const apiDir = __dirname
  const modules = fs.readdirSync(apiDir)
    .filter(f => f.endsWith('.js') && f !== 'index.js')
    .map(f => f.replace(/\.js$/, ''))

  const source = fs.readFileSync(path.join(apiDir, 'index.js'), 'utf8')
  const firstSegments = new Set()
  for (const m of source.matchAll(/app\.(?:get|post|put|delete|all|use)\(\s*'\/api\/([^'/\s]+)/g)) {
    firstSegments.add(m[1])
  }
  assert.ok(firstSegments.size > 10, 'route scan found almost nothing, so this test is not actually checking anything')

  for (const mod of modules) {
    assert.ok(
      !firstSegments.has(mod),
      `api/${mod}.js collides with the route /api/${mod}: Vercel would serve the module as the function and the route would 500. Rename the module.`
    )
  }
})

// ─── TOOL CATALOGUE ──────────────────────────────────────────────────────────

test('every tool has a name, a description and an object input schema', () => {
  for (const t of TOOLS) {
    assert.match(t.name, /^[a-z][a-z0-9_]*$/, `${t.name} is not a valid tool name`)
    assert.ok(t.description.length > 40, `${t.name} needs a description the model can act on`)
    assert.equal(t.inputSchema.type, 'object')
    assert.ok(t.inputSchema.properties, `${t.name} has no properties`)
    assert.ok(Array.isArray(t.inputSchema.required), `${t.name} must declare required[]`)
  }
})

test('tool names are unique', () => {
  const names = TOOLS.map(t => t.name)
  assert.equal(new Set(names).size, names.length)
})

test('no tool mutates — nothing named create, update or delete got in', () => {
  for (const t of TOOLS) {
    assert.ok(
      !/^(create|update|delete|add|remove|set|void|convert)_/.test(t.name),
      `${t.name} looks like a write tool; Motus has no role system, so this needs a deliberate decision`
    )
  }
})

// ─── TOKENS ──────────────────────────────────────────────────────────────────

test('parseTokens reads label:secret pairs', () => {
  assert.deepEqual(parseTokens('max:abc,director:def'), [
    { label: 'max', secret: 'abc' },
    { label: 'director', secret: 'def' },
  ])
})

test('parseTokens accepts a bare secret and tolerates whitespace and blanks', () => {
  assert.deepEqual(parseTokens(' abc , , max : def '), [
    { label: 'mcp', secret: 'abc' },
    { label: 'max', secret: 'def' },
  ])
})

test('parseTokens keeps colons inside the secret itself', () => {
  assert.deepEqual(parseTokens('max:a:b:c'), [{ label: 'max', secret: 'a:b:c' }])
})

test('parseTokens returns nothing for unset or empty config', () => {
  assert.deepEqual(parseTokens(undefined), [])
  assert.deepEqual(parseTokens(''), [])
  assert.deepEqual(parseTokens('  ,  '), [])
})

test('identifyToken matches the right label with or without the Bearer prefix', () => {
  const tokens = parseTokens('max:abc,director:def')
  assert.equal(identifyToken('Bearer def', tokens), 'director')
  assert.equal(identifyToken('bearer abc', tokens), 'max')
  assert.equal(identifyToken('abc', tokens), 'max')
})

test('identifyToken rejects a wrong, empty or near-miss token', () => {
  const tokens = parseTokens('max:abc')
  assert.equal(identifyToken('Bearer wrong', tokens), null)
  assert.equal(identifyToken('Bearer abcd', tokens), null)
  assert.equal(identifyToken('Bearer ab', tokens), null)
  assert.equal(identifyToken('', tokens), null)
  assert.equal(identifyToken(undefined, tokens), null)
})

test('identifyToken rejects everything when no tokens are configured', () => {
  assert.equal(identifyToken('Bearer anything', []), null)
})

// ─── HANDSHAKE ───────────────────────────────────────────────────────────────

test('initialize echoes a protocol version it supports', async () => {
  const res = await handleRpc(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } },
    noImpls
  )
  assert.equal(res.result.protocolVersion, '2024-11-05')
  assert.equal(res.result.serverInfo.name, 'motus')
  assert.ok(res.result.capabilities.tools)
})

test('initialize falls back to our own version for one we do not know', async () => {
  const res = await handleRpc(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '1999-01-01' } },
    noImpls
  )
  assert.equal(res.result.protocolVersion, LATEST_PROTOCOL)
})

test('initialize survives params being absent', async () => {
  const res = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, noImpls)
  assert.equal(res.result.protocolVersion, LATEST_PROTOCOL)
})

test('tools/list returns the catalogue', async () => {
  const res = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, noImpls)
  assert.equal(res.result.tools.length, TOOLS.length)
  assert.equal(res.id, 2)
})

test('ping answers empty', async () => {
  const res = await handleRpc({ jsonrpc: '2.0', id: 3, method: 'ping' }, noImpls)
  assert.deepEqual(res.result, {})
})

test('resources and prompts answer with empty lists rather than errors', async () => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 4, method: 'resources/list' }, noImpls)
  const p = await handleRpc({ jsonrpc: '2.0', id: 5, method: 'prompts/list' }, noImpls)
  assert.deepEqual(r.result, { resources: [] })
  assert.deepEqual(p.result, { prompts: [] })
})

// ─── ENVELOPE ────────────────────────────────────────────────────────────────

test('a notification gets no response at all', async () => {
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, noImpls), null)
})

test('an unknown notification is still silently accepted', async () => {
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'notifications/cancelled' }, noImpls), null)
})

test('an id-less call to a real method still gets no response', async () => {
  assert.equal(await handleRpc({ jsonrpc: '2.0', method: 'tools/list' }, noImpls), null)
})

test('an unknown method is a method-not-found error', async () => {
  const res = await handleRpc({ jsonrpc: '2.0', id: 9, method: 'nope' }, noImpls)
  assert.equal(res.error.code, -32601)
})

test('a malformed envelope is an invalid-request error', async () => {
  assert.equal((await handleRpc(null, noImpls)).error.code, -32600)
  assert.equal((await handleRpc('hello', noImpls)).error.code, -32600)
  assert.equal((await handleRpc({ id: 1, method: 'ping' }, noImpls)).error.code, -32600)
  assert.equal((await handleRpc({ jsonrpc: '2.0', id: 1 }, noImpls)).error.code, -32600)
})

test('an error on a request with no id still reports id null', async () => {
  const res = await handleRpc({ jsonrpc: '1.0', method: 'ping' }, noImpls)
  assert.equal(res.id, null)
})

// ─── TOOL CALLS ──────────────────────────────────────────────────────────────

test('tools/call runs the implementation and returns its JSON as text', async () => {
  const res = await handleRpc(
    { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'search_jobs', arguments: { query: 'ACME' } } },
    { search_jobs: async (args) => ({ echoed: args.query, rows: [] }) }
  )
  assert.equal(res.result.content[0].type, 'text')
  assert.deepEqual(JSON.parse(res.result.content[0].text), { echoed: 'ACME', rows: [] })
  assert.ok(!res.result.isError)
})

test('tools/call defaults arguments to an empty object', async () => {
  const res = await handleRpc(
    { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'list_companies' } },
    { list_companies: async (args) => ({ got: Object.keys(args).length }) }
  )
  assert.deepEqual(JSON.parse(res.result.content[0].text), { got: 0 })
})

test('an unknown tool is a protocol error, not a tool error', async () => {
  const res = await handleRpc(
    { jsonrpc: '2.0', id: 12, method: 'tools/call', params: { name: 'drop_everything' } },
    noImpls
  )
  assert.equal(res.error.code, -32602)
})

test('a tool that throws is reported as an error result the model can read', async () => {
  const res = await handleRpc(
    { jsonrpc: '2.0', id: 13, method: 'tools/call', params: { name: 'get_job', arguments: {} } },
    { get_job: async () => { throw new Error('Give either job_number or job_id.') } }
  )
  assert.equal(res.error, undefined, 'a failing tool must not abort the turn with a protocol error')
  assert.equal(res.result.isError, true)
  assert.match(res.result.content[0].text, /job_number or job_id/)
})

test('a tool returning a plain string is passed through unquoted', async () => {
  const res = await handleRpc(
    { jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'list_companies' } },
    { list_companies: async () => 'No customers yet.' }
  )
  assert.equal(res.result.content[0].text, 'No customers yet.')
})

test('a declared-but-unimplemented tool is an internal error', async () => {
  const res = await handleRpc(
    { jsonrpc: '2.0', id: 15, method: 'tools/call', params: { name: 'search_jobs' } },
    noImpls
  )
  assert.equal(res.error.code, -32603)
})

test('every catalogued tool is reachable through tools/call', async () => {
  const impls = {}
  for (const t of TOOLS) impls[t.name] = async () => ({ ok: t.name })
  for (const t of TOOLS) {
    const res = await handleRpc(
      { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: t.name, arguments: {} } },
      impls
    )
    assert.deepEqual(JSON.parse(res.result.content[0].text), { ok: t.name })
  }
})
