const test = require('node:test')
const assert = require('node:assert')
const crypto = require('crypto')
const {
  SCOPE, randomToken, hashToken, isUsableRedirectUri, isRegisteredRedirectUri,
  verifyPkce, validateRegistration, validateAuthorizeParams, buildRedirect,
  signAccessToken, verifyAccessToken, authServerMetadata, protectedResourceMetadata,
} = require('./oauthServer')

const ISSUER = 'https://zhlmotus.vercel.app'
const SECRET = 'test-signing-secret'

const pkcePair = () => {
  const verifier = crypto.randomBytes(32).toString('base64url')
  return { verifier, challenge: crypto.createHash('sha256').update(verifier).digest('base64url') }
}

// ─── REDIRECT URIS ───────────────────────────────────────────────────────────

test('https redirect URIs are accepted', () => {
  assert.equal(isUsableRedirectUri('https://claude.ai/api/mcp/auth_callback'), true)
})

test('loopback http is accepted, other http is not', () => {
  assert.equal(isUsableRedirectUri('http://127.0.0.1:33418/callback'), true)
  assert.equal(isUsableRedirectUri('http://localhost:8080/cb'), true)
  assert.equal(isUsableRedirectUri('http://evil.example.com/cb'), false)
})

test('a private scheme is accepted, since desktop apps use one', () => {
  assert.equal(isUsableRedirectUri('claude://oauth/callback'), true)
})

test('schemes that can execute are refused', () => {
  for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'vbscript:x']) {
    assert.equal(isUsableRedirectUri(uri), false, `${uri} must be refused`)
  }
})

test('junk and fragments are refused', () => {
  assert.equal(isUsableRedirectUri('not a url'), false)
  assert.equal(isUsableRedirectUri(''), false)
  assert.equal(isUsableRedirectUri(null), false)
  assert.equal(isUsableRedirectUri('https://ok.example.com/cb#frag'), false)
})

test('a registered redirect URI must match exactly, not by prefix', () => {
  const registered = ['https://claude.ai/callback']
  assert.equal(isRegisteredRedirectUri('https://claude.ai/callback', registered), true)
  // The open-redirect classic: a prefix check would let both of these through.
  assert.equal(isRegisteredRedirectUri('https://claude.ai/callback.evil.com', registered), false)
  assert.equal(isRegisteredRedirectUri('https://claude.ai/callback/../x', registered), false)
  assert.equal(isRegisteredRedirectUri('https://claude.ai/callback?next=x', registered), false)
})

// ─── PKCE ────────────────────────────────────────────────────────────────────

test('a correct verifier passes', () => {
  const { verifier, challenge } = pkcePair()
  assert.equal(verifyPkce(verifier, challenge, 'S256'), true)
})

test('a wrong verifier fails', () => {
  const { challenge } = pkcePair()
  const other = pkcePair()
  assert.equal(verifyPkce(other.verifier, challenge, 'S256'), false)
})

test('plain is refused even when the values match', () => {
  const v = 'a'.repeat(50)
  assert.equal(verifyPkce(v, v, 'plain'), false)
  assert.equal(verifyPkce(v, v), false)
})

test('a verifier outside the legal length is refused', () => {
  const short = 'a'.repeat(42)
  const long = 'a'.repeat(129)
  assert.equal(verifyPkce(short, crypto.createHash('sha256').update(short).digest('base64url'), 'S256'), false)
  assert.equal(verifyPkce(long, crypto.createHash('sha256').update(long).digest('base64url'), 'S256'), false)
})

test('a verifier with illegal characters is refused', () => {
  const v = '!'.repeat(50)
  assert.equal(verifyPkce(v, crypto.createHash('sha256').update(v).digest('base64url'), 'S256'), false)
})

test('missing values are refused rather than throwing', () => {
  assert.equal(verifyPkce(undefined, 'x', 'S256'), false)
  assert.equal(verifyPkce('a'.repeat(50), undefined, 'S256'), false)
})

// ─── REGISTRATION ────────────────────────────────────────────────────────────

test('a normal registration is accepted and normalised', () => {
  const out = validateRegistration({
    client_name: 'Claude',
    redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
  })
  assert.equal(out.client_name, 'Claude')
  assert.equal(out.token_endpoint_auth_method, 'none')
  assert.deepEqual(out.redirect_uris, ['https://claude.ai/api/mcp/auth_callback'])
})

test('registration without a redirect URI is refused', () => {
  assert.throws(() => validateRegistration({}), /redirect_uris is required/)
  assert.throws(() => validateRegistration({ redirect_uris: [] }), /redirect_uris is required/)
})

test('registration carrying one bad redirect URI is refused entirely', () => {
  assert.throws(
    () => validateRegistration({ redirect_uris: ['https://ok.example.com/cb', 'javascript:alert(1)'] }),
    /unusable redirect_uri/
  )
})

test('an unsupported auth method is refused', () => {
  assert.throws(
    () => validateRegistration({ redirect_uris: ['https://ok.example.com/cb'], token_endpoint_auth_method: 'private_key_jwt' }),
    /unsupported token_endpoint_auth_method/
  )
})

test('a long client name is truncated rather than rejected', () => {
  const out = validateRegistration({ client_name: 'x'.repeat(500), redirect_uris: ['https://ok.example.com/cb'] })
  assert.equal(out.client_name.length, 120)
})

// ─── AUTHORIZE ───────────────────────────────────────────────────────────────

const client = { client_id: 'abc', redirect_uris: ['https://claude.ai/cb', 'claude://cb'] }
const goodQuery = (over = {}) => ({
  response_type: 'code',
  redirect_uri: 'https://claude.ai/cb',
  code_challenge: 'Y2hhbGxlbmdl',
  code_challenge_method: 'S256',
  state: 'xyz',
  ...over,
})

test('a valid authorize request is accepted', () => {
  const out = validateAuthorizeParams(goodQuery(), client)
  assert.equal(out.redirectUri, 'https://claude.ai/cb')
  assert.equal(out.state, 'xyz')
  assert.equal(out.scope, SCOPE)
})

test('an unknown client is refused', () => {
  assert.throws(() => validateAuthorizeParams(goodQuery(), null), /Unknown client_id/)
})

test('a redirect URI the client never registered is refused', () => {
  assert.throws(
    () => validateAuthorizeParams(goodQuery({ redirect_uri: 'https://evil.example.com/cb' }), client),
    /does not match a registered value/
  )
})

test('an omitted redirect URI is allowed only when the client registered exactly one', () => {
  const single = { client_id: 'abc', redirect_uris: ['https://claude.ai/cb'] }
  const q = goodQuery()
  delete q.redirect_uri
  assert.equal(validateAuthorizeParams(q, single).redirectUri, 'https://claude.ai/cb')
  assert.throws(() => validateAuthorizeParams(q, client), /redirect_uri is required/)
})

test('the redirect URI is checked before anything else, so errors never leak to a stranger', () => {
  // response_type is also wrong here; the redirect failure must still be what surfaces.
  assert.throws(
    () => validateAuthorizeParams(goodQuery({ redirect_uri: 'https://evil.example.com/cb', response_type: 'token' }), client),
    /does not match a registered value/
  )
})

test('implicit flow is refused', () => {
  assert.throws(() => validateAuthorizeParams(goodQuery({ response_type: 'token' }), client), /authorization code flow/)
})

test('PKCE is mandatory', () => {
  const q = goodQuery()
  delete q.code_challenge
  assert.throws(() => validateAuthorizeParams(q, client), /code_challenge is required/)
})

test('a plain code challenge is refused, including by omission of the method', () => {
  assert.throws(() => validateAuthorizeParams(goodQuery({ code_challenge_method: 'plain' }), client), /must be S256/)
  const q = goodQuery()
  delete q.code_challenge_method
  assert.throws(() => validateAuthorizeParams(q, client), /must be S256/)
})

// ─── REDIRECT BUILDING ───────────────────────────────────────────────────────

test('buildRedirect appends params and preserves existing query', () => {
  const url = buildRedirect('https://claude.ai/cb?keep=1', { code: 'C', state: 'S' })
  const u = new URL(url)
  assert.equal(u.searchParams.get('keep'), '1')
  assert.equal(u.searchParams.get('code'), 'C')
  assert.equal(u.searchParams.get('state'), 'S')
})

test('buildRedirect omits empty values rather than sending blanks', () => {
  const u = new URL(buildRedirect('https://claude.ai/cb', { code: 'C', state: '' }))
  assert.equal(u.searchParams.has('state'), false)
})

test('buildRedirect escapes values rather than letting them inject params', () => {
  const u = new URL(buildRedirect('https://claude.ai/cb', { state: 'a&code=injected' }))
  assert.equal(u.searchParams.get('state'), 'a&code=injected')
  assert.equal(u.searchParams.get('code'), null)
})

test('buildRedirect works with a private scheme', () => {
  assert.match(buildRedirect('claude://cb', { code: 'C' }), /^claude:\/\/cb\?code=C$/)
})

// ─── ACCESS TOKENS ───────────────────────────────────────────────────────────

test('a signed token verifies and carries the user', () => {
  const token = signAccessToken({ email: 'max@zhenghe.com.sg', clientId: 'abc' }, SECRET, { issuer: ISSUER })
  const claims = verifyAccessToken(token, SECRET, { issuer: ISSUER })
  assert.equal(claims.sub, 'max@zhenghe.com.sg')
  assert.equal(claims.client_id, 'abc')
  assert.equal(claims.scope, SCOPE)
})

test('a token signed with another secret does not verify', () => {
  const token = signAccessToken({ email: 'a@b.com', clientId: 'abc' }, 'other-secret', { issuer: ISSUER })
  assert.equal(verifyAccessToken(token, SECRET, { issuer: ISSUER }), null)
})

test('a token issued for another deployment does not verify', () => {
  const token = signAccessToken({ email: 'a@b.com', clientId: 'abc' }, SECRET, { issuer: 'https://evil.example.com' })
  assert.equal(verifyAccessToken(token, SECRET, { issuer: ISSUER }), null)
})

test('an alg:none token is refused', () => {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify({
    sub: 'attacker@evil.com', iss: ISSUER, aud: `${ISSUER}/api/mcp`, exp: Math.floor(Date.now() / 1000) + 9999,
  })).toString('base64url')
  assert.equal(verifyAccessToken(`${header}.${body}.`, SECRET, { issuer: ISSUER }), null)
})

test('garbage and empty tokens are refused rather than throwing', () => {
  assert.equal(verifyAccessToken('not.a.token', SECRET, { issuer: ISSUER }), null)
  assert.equal(verifyAccessToken('', SECRET, { issuer: ISSUER }), null)
  assert.equal(verifyAccessToken(undefined, SECRET, { issuer: ISSUER }), null)
})

test('an expired token is refused', () => {
  const jwt = require('jsonwebtoken')
  const token = jwt.sign({ scope: SCOPE }, SECRET, {
    algorithm: 'HS256', subject: 'a@b.com', issuer: ISSUER,
    audience: `${ISSUER}/api/mcp`, expiresIn: -10,
  })
  assert.equal(verifyAccessToken(token, SECRET, { issuer: ISSUER }), null)
})

// ─── HELPERS AND DISCOVERY ───────────────────────────────────────────────────

test('randomToken is URL safe and does not repeat', () => {
  const a = randomToken()
  assert.match(a, /^[A-Za-z0-9_-]+$/)
  assert.notEqual(a, randomToken())
})

test('hashToken is stable and one-way', () => {
  assert.equal(hashToken('abc'), hashToken('abc'))
  assert.notEqual(hashToken('abc'), hashToken('abd'))
  assert.equal(hashToken('abc').length, 64)
})

test('authorization server metadata advertises only what we actually support', () => {
  const m = authServerMetadata(ISSUER)
  assert.equal(m.issuer, ISSUER)
  assert.equal(m.authorization_endpoint, `${ISSUER}/api/oauth/authorize`)
  assert.equal(m.token_endpoint, `${ISSUER}/api/oauth/token`)
  assert.equal(m.registration_endpoint, `${ISSUER}/api/oauth/register`)
  assert.deepEqual(m.code_challenge_methods_supported, ['S256'])
  assert.deepEqual(m.response_types_supported, ['code'])
  assert.ok(!m.grant_types_supported.includes('implicit'))
  assert.ok(!m.grant_types_supported.includes('password'))
})

test('protected resource metadata points at this deployment', () => {
  const m = protectedResourceMetadata(ISSUER)
  assert.equal(m.resource, `${ISSUER}/api/mcp`)
  assert.deepEqual(m.authorization_servers, [ISSUER])
})
