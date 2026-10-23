// OAuth 2.1 authorization server, just large enough to make Motus a custom connector.
//
// Claude Desktop's "Add custom connector" dialog takes a URL and nothing else: no box
// for a header, no box for a token. The only way it can authenticate is OAuth, where it
// discovers our endpoints, registers itself, sends the user to us to log in, and gets
// back a token of its own. So that is what this is.
//
// It is a real authorization server but a deliberately small one:
//   - one grant (authorization code + PKCE) and refresh, nothing else
//   - one scope, motus:read
//   - no consent screen beyond the login itself, because every user is a colleague and
//     the only thing being consented to is reading data they can already read
//   - Supabase still does the actual password check. We never see or store a password,
//     and revoking someone in Supabase revokes them here.
//
// This module is pure: no database, no Express. index.js owns the storage and routes.

const crypto = require('crypto')
const jwt = require('jsonwebtoken')

const AUTH_CODE_TTL_MS = 60_000               // one minute, single use
const ACCESS_TOKEN_TTL_S = 60 * 60            // one hour
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SCOPE = 'motus:read'

const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url')

// Refresh tokens and client secrets are stored as digests, so a leaked database backup
// does not hand over working credentials.
const hashToken = t => crypto.createHash('sha256').update(String(t)).digest('hex')

function oauthError(code, description, status = 400) {
  const e = new Error(description)
  e.oauthCode = code
  e.status = status
  return e
}

// ─── REDIRECT URIS ───────────────────────────────────────────────────────────
// The redirect URI is where an authorization code gets delivered, so a lax check here
// is how codes get stolen. https is the normal case; loopback http is how a desktop app
// receives a callback; a private scheme (claude://...) is the other way a desktop app
// does it. Everything else, and anything that can execute, is refused.

const DANGEROUS_SCHEMES = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:'])
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function isUsableRedirectUri(uri) {
  if (typeof uri !== 'string' || !uri) return false
  let u
  try { u = new URL(uri) } catch { return false }
  if (u.hash) return false                    // a fragment would be dropped on redirect anyway
  if (DANGEROUS_SCHEMES.has(u.protocol)) return false
  if (u.protocol === 'https:') return true
  if (u.protocol === 'http:') return LOOPBACK_HOSTS.has(u.hostname)
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol)
}

// Exact string match, not a prefix or origin match: "starts with the registered URI" is
// a classic open-redirect hole, since /callback also matches /callback.evil.com.
function isRegisteredRedirectUri(uri, registered) {
  return Array.isArray(registered) && registered.includes(uri)
}

// ─── PKCE ────────────────────────────────────────────────────────────────────
// The thing that makes a public client safe: the client commits to a secret up front
// by sending its hash, and must produce the secret itself to redeem the code. An
// intercepted code is then worthless on its own.

function verifyPkce(verifier, challenge, method = 'S256') {
  // 'plain' is still in the spec and is pointless, since anyone who can steal the code
  // can read the challenge from the same request. We only accept S256.
  if (method !== 'S256') return false
  if (typeof verifier !== 'string' || typeof challenge !== 'string') return false
  if (verifier.length < 43 || verifier.length > 128) return false
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false
  const computed = crypto.createHash('sha256').update(verifier).digest('base64url')
  return crypto.timingSafeEqual(
    crypto.createHash('sha256').update(computed).digest(),
    crypto.createHash('sha256').update(challenge).digest()
  )
}

// ─── DYNAMIC CLIENT REGISTRATION (RFC 7591) ──────────────────────────────────
// Claude registers itself the first time someone adds the connector. There is no
// pre-shared client id to distribute, which is the entire point.

function validateRegistration(body) {
  const uris = body && Array.isArray(body.redirect_uris) ? body.redirect_uris : []
  if (!uris.length) throw oauthError('invalid_redirect_uri', 'redirect_uris is required')
  if (uris.length > 10) throw oauthError('invalid_redirect_uri', 'too many redirect_uris')
  for (const u of uris) {
    if (!isUsableRedirectUri(u)) throw oauthError('invalid_redirect_uri', `unusable redirect_uri: ${u}`)
  }

  const authMethod = (body && body.token_endpoint_auth_method) || 'none'
  if (!['none', 'client_secret_post', 'client_secret_basic'].includes(authMethod)) {
    throw oauthError('invalid_client_metadata', `unsupported token_endpoint_auth_method: ${authMethod}`)
  }

  return {
    client_name: String((body && body.client_name) || 'Unnamed client').slice(0, 120),
    redirect_uris: uris,
    token_endpoint_auth_method: authMethod,
  }
}

// ─── AUTHORIZE REQUEST ───────────────────────────────────────────────────────

function validateAuthorizeParams(query, client) {
  const q = query || {}
  if (!client) throw oauthError('invalid_client', 'Unknown client_id', 400)

  // The redirect URI is validated BEFORE anything else can redirect to it. Every error
  // from here on is safe to report back to the client; an error before here has to be
  // shown to the user instead, because we have nowhere trustworthy to send them.
  let redirectUri = q.redirect_uri
  if (!redirectUri) {
    if (client.redirect_uris.length !== 1) {
      throw oauthError('invalid_request', 'redirect_uri is required', 400)
    }
    redirectUri = client.redirect_uris[0]
  }
  if (!isRegisteredRedirectUri(redirectUri, client.redirect_uris)) {
    throw oauthError('invalid_request', 'redirect_uri does not match a registered value', 400)
  }

  if (q.response_type !== 'code') {
    throw oauthError('unsupported_response_type', 'Only the authorization code flow is supported')
  }
  if (!q.code_challenge) {
    throw oauthError('invalid_request', 'code_challenge is required')
  }
  if ((q.code_challenge_method || 'plain') !== 'S256') {
    throw oauthError('invalid_request', 'code_challenge_method must be S256')
  }

  return {
    redirectUri,
    state: q.state || '',
    codeChallenge: q.code_challenge,
    scope: SCOPE,
  }
}

// Builds the URL the browser is sent back to, carrying either a code or an error.
// `state` is echoed verbatim; it is the client's CSRF defence, not ours.
function buildRedirect(redirectUri, params) {
  const u = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v)
  }
  return u.toString()
}

// ─── TOKENS ──────────────────────────────────────────────────────────────────
// The access token is a signed JWT rather than a row in a table, so verifying a call
// to /api/mcp costs no database round trip. The tradeoff is that it cannot be revoked
// before it expires, which is why it only lives an hour; the refresh token IS a row and
// can be revoked immediately.

function signAccessToken({ email, clientId }, secret, { issuer }) {
  return jwt.sign(
    { scope: SCOPE, client_id: clientId },
    secret,
    {
      algorithm: 'HS256',
      subject: email,
      issuer,
      audience: `${issuer}/api/mcp`,
      expiresIn: ACCESS_TOKEN_TTL_S,
    }
  )
}

function verifyAccessToken(token, secret, { issuer }) {
  try {
    return jwt.verify(token, secret, {
      // Pinned: without this a token could be presented with alg "none", or signed with
      // the public half of an asymmetric key, and still verify.
      algorithms: ['HS256'],
      issuer,
      audience: `${issuer}/api/mcp`,
    })
  } catch {
    return null
  }
}

// ─── DISCOVERY DOCUMENTS ─────────────────────────────────────────────────────
// How the client finds all of the above without being told. It fetches the protected
// resource metadata named in our 401, which points at the authorization server, whose
// metadata lists these endpoints.

function authServerMetadata(issuer) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/api/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    registration_endpoint: `${issuer}/api/oauth/register`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    scopes_supported: [SCOPE],
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    service_documentation: 'https://github.com/zhenghelogistics/Motus/blob/main/integrations/MCP.md',
  }
}

function protectedResourceMetadata(issuer) {
  return {
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ['header'],
  }
}

module.exports = {
  SCOPE,
  AUTH_CODE_TTL_MS,
  ACCESS_TOKEN_TTL_S,
  REFRESH_TOKEN_TTL_MS,
  randomToken,
  hashToken,
  oauthError,
  isUsableRedirectUri,
  isRegisteredRedirectUri,
  verifyPkce,
  validateRegistration,
  validateAuthorizeParams,
  buildRedirect,
  signAccessToken,
  verifyAccessToken,
  authServerMetadata,
  protectedResourceMetadata,
}
