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
API. No new infrastructure.

---

## Setup

### 1. Generate a token for each person

One token per person, so the logs say who called.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### 2. Add them to Vercel

Project settings, Environment Variables, add `MCP_TOKENS` for Production:

```
max:<token>,director:<token>
```

Comma-separated `label:secret` pairs. The label is only for the logs. Redeploy for it to
take effect.

If `MCP_TOKENS` is not set, the endpoint returns 503 and no tools are reachable. That is
deliberate: missing configuration means off, not open.

### 3. Connect

**Claude Code** (one line, per machine):

```bash
claude mcp add --transport http motus https://zhlmotus.vercel.app/api/mcp \
  --header "Authorization: Bearer <your token>"
```

**Claude Desktop**, in `claude_desktop_config.json`:

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

A list of tools means you are done. `401` means the token is wrong, `503` means
`MCP_TOKENS` is not set on the deployment you are hitting.

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

---

## What this is not, yet

This is a **personal** connector: it authenticates with a static token, which works in
Claude Code and Claude Desktop where you control the config file.

It is not yet a **custom connector** on claude.ai, the kind anyone on the team adds from
Settings. That flow expects OAuth so that each user logs in as themselves and the
connector holds a token scoped to that person. Motus does not have an OAuth server, only
Supabase sessions, so that needs an authorize endpoint, a token endpoint and dynamic
client registration added on our side, with Supabase still doing the actual login.

Worth doing once it is clear people use this. Not worth doing first.

---

## Troubleshooting

**503 "not configured"** — `MCP_TOKENS` is unset on that deployment, or it was added
without a redeploy.

**401** — token mismatch. Check for a trailing comma or a stray space in `MCP_TOKENS`;
the secret is everything after the first colon, so a space after the colon becomes part
of the secret.

**Claude says a customer does not exist** — `company_stats` matches the name exactly.
Ask it to call `list_companies` first.

**A tool returns an error message instead of data** — that is by design. Tool failures
come back inside a normal result so Claude can read what went wrong and correct itself,
rather than aborting the turn.

**Finding the logs** — Vercel function logs, filter for `[ZHL:mcp]`. Each tool call logs
the token label and the tool name.
