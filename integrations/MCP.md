# Motus MCP server

Lets Claude read Motus directly. Instead of exporting a deck and asking questions about
last week's numbers, you ask Claude and it queries the live database.

> "How did sea freight do last quarter compared to the one before?"
> "Find every ACME job this year and tell me which ones lost money."
> "What did we quote on the Jakarta lane, and what did CargoHub charge us?"

It is read-only. Nothing Claude can call will change or delete anything in Motus.

---

## What it is, in one paragraph

MCP (Model Context Protocol) is a convention for telling a model what an application can
do. Claude asks our server "what can you do?", the server returns a list of tools with
descriptions and argument schemas, and Claude picks one and calls it. Underneath it is
JSON-RPC 2.0 over a single HTTP POST. There is no AI running in the server; it is our
existing database queries with machine-readable labels on them.

The endpoint lives at `POST /api/mcp`, inside the same Vercel function as the rest of the
API. No new infrastructure and no new database.

---

## Two ways to connect

**Custom connector (recommended).** Each person adds Motus from Claude's Connectors
screen and signs in with their own Motus account. No tokens to hand out, and revoking
someone in Supabase revokes them here. Needs `MCP_OAUTH_SECRET` set.

**Static token.** A per-person token pasted into a config file. Works in Claude Code and
Claude Desktop. Useful for scripts and for a quick trial. Needs `MCP_TOKENS` set.

Both can be enabled at once, and if neither is set the endpoint returns 503 and nothing
is reachable. Missing configuration means off, not open.

---

## Setup: custom connector

### 1. Set the signing secret

Generate one:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

In Vercel, Settings, Environment Variables, add `MCP_OAUTH_SECRET` with that value for
Production. Redeploy.

Changing this value later signs everyone out, which is the emergency stop if you ever
need one.

### 2. Add the connector

In Claude, Settings, Connectors, **Add custom connector**:

- **Name:** Motus
- **MCP server URL:** `https://zhlmotus.vercel.app/api/mcp`

Claude discovers the rest by itself, registers, and opens a Motus sign-in page. Sign in
with your normal `@zhenghe.com.sg` email and password. That is the whole flow.

### 3. Check it worked

The connector shows as connected with 8 tools. Ask it "how did we do last quarter".

---

## Setup: static token

### 1. Generate a token per person

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Add them to Vercel

Add `MCP_TOKENS` for Production as comma-separated `label:secret` pairs:

```
max:<token>,director:<token>
```

The label is only for the logs, so a call is attributable to a person rather than to
"someone with a valid token". Redeploy.

### 3. Connect

Claude Code:

```bash
claude mcp add --transport http motus https://zhlmotus.vercel.app/api/mcp \
  --header "Authorization: Bearer <your token>"
```

Claude Desktop, in Settings, Developer, Edit Config:

```json
{
  "mcpServers": {
    "motus": {
      "type": "http",
      "url": "https://zhlmotus.vercel.app/api/mcp",
      "headers": { "Authorization": "Bearer <your token>" }
    }
  }
}
```

### 4. Check it works

```bash
curl -s https://zhlmotus.vercel.app/api/mcp \
  -H "Authorization: Bearer <your token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | head -c 400
```

---

## The tools

| Tool | What it answers |
| --- | --- |
| `search_jobs` | Find jobs by text, status, mode or customer. Returns a summary per job with revenue, cost, profit and GP%. |
| `get_job` | One job in full: every cost line, billing line, split entity and document. |
| `search_leads` | The sales pipeline, including the free-text reason a lead was lost. |
| `movement_report` | Performance for a month, quarter or year, with a like-for-like comparison against the previous period. The main one. |
| `pipeline_report` | The monthly BD report: enquiries, win rate, value won, per-salesperson. |
| `company_stats` | One customer's volume and revenue over a year or month, by mode and by month. |
| `list_companies` | Every customer and the modes in use. Use it to resolve a misspelled name. |
| `list_rate_cards` | Vendor rate cards with every charge line. Buying rates, not selling rates. |

Every figure is computed in Postgres and handed to the model as a finished number. The
model is never asked to do arithmetic, for the same reason it is not asked to in the
monthly deck.

---

## Why read-only

Motus has no role system. Every authenticated user can delete any job. That is tolerable
when the only way in is a UI a human drives. It is not tolerable when the caller is a
model acting on an instruction it may have misread, in a chat window, with no
confirmation step.

Adding writes later is reasonable, in this order:

1. A `role` column on users, and a permission check in the tool layer.
2. Low-blast-radius creates first: a lead, a note, a cost line.
3. Never `delete_*`. If something has to be removed, a human does it in the app.

A unit test fails if a tool named `create_*`, `update_*` or `delete_*` is added, so this
cannot be undone by accident.

---

## How the OAuth side works

Enough of OAuth 2.1 to be a custom connector, and no more:

- **Discovery.** An unauthenticated call to `/api/mcp` answers 401 with a
  `WWW-Authenticate` header naming `/.well-known/oauth-protected-resource`, which points
  at the authorization server, whose metadata lists the endpoints. The two `.well-known`
  paths are served by rewrites in `vercel.json`.
- **Registration.** Claude registers itself (RFC 7591), so there is no client id to
  distribute. Registration rejects any redirect URI that is not https, loopback http or
  a private scheme.
- **Login.** Supabase does the password check. Motus never sees or stores a password, and
  the same `@zhenghe.com.sg` rule as the app applies. Disabling someone in Supabase
  disables them here.
- **PKCE is mandatory**, S256 only. `plain` is refused.
- **Access tokens** are signed JWTs valid for one hour, so verifying a call costs no
  database round trip. **Refresh tokens** are rows, rotate on every use, and last 30 days.
- **Replay detection.** An authorization code presented twice revokes every refresh token
  for that user and client, and logs it.

Tables: `oauth_clients`, `oauth_codes`, `oauth_refresh_tokens`. They are created
automatically on deploy by the usual schema bootstrap. There is no SQL to run by hand.

---

## Troubleshooting

**503 "not configured"** — neither `MCP_OAUTH_SECRET` nor `MCP_TOKENS` is set on that
deployment, or they were added without a redeploy.

**401 on a static token** — check for a stray space in `MCP_TOKENS`. The secret is
everything after the first colon, so a space after the colon becomes part of the secret.

**The connector will not add** — check that
`https://zhlmotus.vercel.app/.well-known/oauth-protected-resource` returns JSON rather
than the app's HTML. HTML means the rewrites in `vercel.json` did not deploy.

**Everyone signed out at once** — `MCP_OAUTH_SECRET` changed. Every token signed with the
old value is now invalid. People just reconnect.

**Claude says a customer does not exist** — `company_stats` matches the name exactly. Ask
it to call `list_companies` first.

**A tool returns an error message instead of data** — by design. Tool failures come back
inside a normal result so Claude can read what went wrong and correct itself, rather than
aborting the turn.

**Logs** — Vercel function logs. `[ZHL:mcp]` for tool calls, `[ZHL:oauth]` for sign-ins,
registrations and replay warnings.
