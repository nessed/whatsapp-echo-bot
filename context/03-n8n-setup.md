# 03 — n8n Setup

> **VERIFY:** Railway's dashboard and pricing change often, and n8n's public API has been under active development. Endpoint shapes below match the n8n public API v1 as documented at `docs.n8n.io/api/`. Check that doc if a call behaves unexpectedly.

---

## Why HTTPS is mandatory

Meta will not deliver webhooks to anything except a publicly reachable HTTPS URL with a valid certificate. Specifically it rejects:

- `http://` of any kind
- `localhost` / `127.0.0.1` / private LAN addresses
- self-signed or expired certificates
- non-standard ports in most cases

There is no dev mode, no bypass, no allowlist. Meta's servers make an outbound request to your URL from the public internet — if they can't reach it and complete a TLS handshake, verification fails and no messages are delivered.

This is why the n8n instance has to be live and publicly addressable *before* the webhook can even be configured, and it's why build step 3 comes before step 4.

Additional note from Meta's v25.0 changelog: **webhook mTLS certificate requirements changed in early 2026** — Meta introduced a new internal Certificate Authority that receiving endpoints must trust. Managed platforms like Railway handle this. Flagging it because a self-managed VPS with a custom TLS setup could hit TLS handshake failures with no obvious cause.

---

## Option A — Railway (not used for this project)

Railway runs a Docker container with a public HTTPS domain and a managed certificate. Roughly:

1. Sign in at `railway.app` with GitHub.
2. **New Project > Deploy from Docker Image** (**VERIFY** — Railway also offers an n8n template in its marketplace, which is faster if it's current).
3. Image: `n8nio/n8n:latest`. Pinning a specific tag rather than `latest` is better practice, since `latest` can change under you between deploys.
4. Set environment variables on the service:

   ```
   N8N_HOST=<your-railway-domain>
   N8N_PORT=5678
   N8N_PROTOCOL=https
   WEBHOOK_URL=https://<your-railway-domain>/
   GENERIC_TIMEZONE=<your timezone, e.g. Europe/London>
   N8N_BASIC_AUTH_ACTIVE=true
   N8N_BASIC_AUTH_USER=<pick one>
   N8N_BASIC_AUTH_PASSWORD=<pick one>
   ```

   `WEBHOOK_URL` matters more than it looks. n8n uses it to construct the webhook URLs it displays. Without it, the UI shows `localhost:5678/webhook/...` and you'll paste a URL into Meta that can never work.

   **VERIFY:** the `N8N_BASIC_AUTH_*` variables have been deprecated in newer n8n versions in favour of built-in user management. If the container ignores them, set up an owner account through the UI on first load instead.

5. Add a **persistent volume** mounted at `/home/node/.n8n`. Without it, every redeploy wipes your workflows and credentials. Easy to skip and painful to discover.
6. Under **Settings > Networking**, generate a public domain. That URL goes in `N8N_URL` in `.env`.
7. Load the URL in a browser. On first visit n8n asks you to create an owner account. Do it — that account owns the API key.

### Cost

Railway is usage-based with a trial credit. An idle n8n container is cheap but not free indefinitely. For a practice project that runs for days rather than months this is usually fine, but check current pricing rather than assuming — Railway has changed its free tier terms more than once.

---

## Option B — local n8n + ngrok (current setup)

Works fine, with one significant catch.

```bash
npx n8n
# or: docker run -it --rm -p 5678:5678 -v ~/.n8n:/home/node/.n8n n8nio/n8n
```

Then in a second terminal:

```bash
ngrok http 5678
```

ngrok prints an HTTPS forwarding URL. Set that as `N8N_URL` and as the Meta callback URL.

Also set `WEBHOOK_URL` to the ngrok URL before starting n8n, or n8n will keep displaying localhost webhook URLs:

```bash
WEBHOOK_URL=https://abc123.ngrok-free.app/ npx n8n
```

**The catch:** on ngrok's free tier the URL changes every restart. Each restart means going back into Meta's webhook config, pasting the new URL, and re-doing the verification handshake. Doing that four times in an evening is genuinely annoying. A reserved ngrok domain (paid) or Cloudflare Tunnel with a domain you own both avoid it.

Also: when your laptop sleeps, the tunnel dies and messages sent during that period are lost. Meta retries for a while, but not indefinitely.

**Project decision:** stay on local n8n + the existing reserved ngrok domain. The assistant is private and only needs to run while the laptop is awake, so no additional hosting cost is justified.

---

## n8n API key

In the n8n UI: **Settings > n8n API > Create an API key** (**VERIFY** — newer versions may nest this under Settings > API, or a personal-settings menu).

Copy it into `.env` as `N8N_API_KEY`. Like the Meta token, it's shown once.

Sent as a header on every API call:

```
X-N8N-API-KEY: <your key>
```

Not `Authorization: Bearer`. n8n uses its own header name.

---

## Building manually, then exporting to Git

For this project, create and edit the workflow in the n8n GUI so you learn the nodes and their actual execution data. After a verified milestone, export the current workflow into `workflows/` and review it for credentials before committing.

The API remains useful for backup, inspection, and recovery. Do not use it to silently replace a workflow you are actively building by hand.

Base URL: `{N8N_URL}/api/v1`

### Create a workflow

```bash
curl -X POST "${N8N_URL}/api/v1/workflows" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
  -H "Content-Type: application/json" \
  -d @workflows/echo-bot.json
```

Returns the created workflow including its generated `id`. Save that id — updates need it.

### Minimal workflow JSON shape

```json
{
  "name": "whatsapp-echo-bot",
  "nodes": [],
  "connections": {},
  "settings": {
    "executionOrder": "v1"
  }
}
```

`name`, `nodes`, `connections`, and `settings` are the fields the create endpoint accepts. **The API rejects requests containing read-only fields** — `id`, `active`, `createdAt`, `updatedAt`, `tags`, `versionId`. This bites when you export a workflow from the UI and try to POST it straight back: the export includes fields the create endpoint refuses. Strip them first.

### Update a workflow

```bash
curl -X PUT "${N8N_URL}/api/v1/workflows/{id}" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}" \
  -H "Content-Type: application/json" \
  -d @workflows/echo-bot.json
```

PUT replaces the whole workflow. Send the complete node array, not a partial patch.

### Activate / deactivate

Activation is **not** a field you can set on create or update. It's a separate endpoint:

```bash
curl -X POST "${N8N_URL}/api/v1/workflows/{id}/activate" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}"

curl -X POST "${N8N_URL}/api/v1/workflows/{id}/deactivate" \
  -H "X-N8N-API-KEY: ${N8N_API_KEY}"
```

**A webhook only listens on its production URL while the workflow is active.** An inactive workflow's production webhook path returns 404, which looks exactly like a wrong URL. Check activation state before debugging routing.

### Other useful endpoints

```
GET    /api/v1/workflows            list all
GET    /api/v1/workflows/{id}       fetch one (use to export current state back into git)
DELETE /api/v1/workflows/{id}       delete
GET    /api/v1/executions           execution history — the main debugging surface
GET    /api/v1/executions/{id}      full execution detail including per-node input/output
```

`GET /api/v1/executions` is where you'll spend debugging time. Each execution records what every node received and emitted, so you can see the exact payload that broke your parser rather than guessing.

---

## Test vs production webhook URLs

n8n gives each Webhook node two URLs and mixing them up is a reliable time sink:

- **Test URL** — `{N8N_URL}/webhook-test/{path}`. Only live after clicking "Listen for test event" in the editor, and only for a single request. Convenient for iterating.
- **Production URL** — `{N8N_URL}/webhook/{path}`. Live whenever the workflow is active. **This is the one that goes in Meta's config.**

If you register the test URL with Meta, verification might pass once (if you happened to be listening) and then everything silently stops. Register the production URL.

---

## Credentials in n8n

n8n has its own encrypted credential store, separate from your `.env`. Two approaches:

1. Create credentials in the n8n UI (Supabase API credential, HTTP Header Auth credential for Meta) and reference them from nodes. Cleaner, keeps secrets out of workflow JSON.
2. Set env vars on the n8n container and reference them in expressions as `{{ $env.META_ACCESS_TOKEN }}`. Keeps everything in one place and makes the workflow JSON fully self-describing, but requires `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` (**VERIFY** the exact variable name — n8n has changed env-access gating between versions).

Either is fine for P1. **Whichever you choose, no raw token ever goes into `workflows/*.json`,** because that file is committed to git.

---

## What goes in `workflows/`

The exported n8n workflow JSON for this assistant. One file per workflow, named after the workflow. It is a verified snapshot of the manual build, never a place to store credentials.
