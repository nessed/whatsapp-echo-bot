# Shopify setup — Kavern

Date: 18 August 2026

## Purpose

Add Shopify Admin API access for the P2 COD-order-confirmation work. This is
separate from the existing WhatsApp/DeepSeek bot and will use the Shopify app
server-to-server from the n8n workflow.

## Completed setup

1. Created a Shopify developer account.
2. Created the Shopify development organization.
3. Downloaded the Shopify CLI.
4. Opened the Shopify Dev Dashboard.
5. Created the app named **Kavern**.
6. Opened the app's version configuration in the Dev Dashboard.
7. Configured the app to use the project's public n8n URL as its App URL:

   ```text
   https://coherent-drudge-wobble.ngrok-free.dev
   ```

8. Set the Webhooks API version to `2026-07`.
9. Configured required Admin API scopes:

   ```text
   read_orders,write_orders,read_customers
   ```

10. Left the following unconfigured because this is a server-to-server app,
    not an embedded Shopify-admin UI:

    - Embed app in Shopify admin: off
    - Preferences URL: blank
    - Optional scopes: blank
    - Legacy install flow: off
    - Allowed redirection URLs: blank
    - POS: blank
    - App proxy: blank

11. Released/activated the app version.
12. Copied the Kavern Client ID and Client secret from Dev Dashboard →
    **Settings** into the local `.env` file as:

    ```env
    SHOPIFY_CLIENT_ID=...
    SHOPIFY_CLIENT_SECRET=...
    ```

    The actual credentials are intentionally not repeated in this document.
13. Installed Kavern on the development store:

    ```text
    kavern-ngm2illt.myshopify.com
    ```

## Local configuration

The project now has these Shopify environment variables:

```env
SHOPIFY_STORE_DOMAIN=kavern-ngm2illt.myshopify.com
SHOPIFY_CLIENT_ID=<set locally>
SHOPIFY_CLIENT_SECRET=<set locally>
SHOPIFY_ADMIN_API_VERSION=2026-07
```

`.env` is gitignored. Do not commit it or paste the client secret into n8n
nodes, source code, chat, or documentation.

## Authentication model

Kavern uses Shopify's **client credentials grant**. It does not use a static
Admin API access token or a browser OAuth redirect.

At runtime, request a short-lived token from:

```text
POST https://kavern-ngm2illt.myshopify.com/admin/oauth/access_token
```

with form fields:

```text
grant_type=client_credentials
client_id=<SHOPIFY_CLIENT_ID>
client_secret=<SHOPIFY_CLIENT_SECRET>
```

Use the returned `access_token` as the `X-Shopify-Access-Token` header for
Admin GraphQL requests. Shopify tokens from this flow last 24 hours, so the
workflow should request a fresh token when needed rather than storing one in
`.env`.

## Admin API pull — verified 19 August 2026

`scripts/05-verify-shopify.js` (`npm run verify:shopify`) does the whole flow in
one shot: client-credentials token, then three read-only GraphQL queries. It
never prints the token and never writes to the store.

Result:

| Step | Outcome |
|---|---|
| Token (`client_credentials`) | HTTP 200, `expires_in` 86399s (24h) |
| `shop` query | HTTP 200 — Kavern, USD, America/New_York, plan "Shopify Plus App Development" |
| `products(first: 10)` | `ACCESS_DENIED` — "Access denied for products field." |
| `orders(first: 10)` | HTTP 200, **0 orders** (dev store is empty) |

The earlier hang/timeout was the local tunnel being down, not Shopify — the
Admin API is reached directly at `kavern-ngm2illt.myshopify.com` and does not
involve the ngrok URL at all.

### Scopes actually granted

The token response reports:

```text
scope=read_customers,write_orders
```

Two things differ from what was configured in the Dev Dashboard:

- `read_orders` does not appear because `write_orders` already implies it. Order
  reads work — the query returned 200 with an empty list.
- **`read_products` was never requested**, which is why the products query is
  denied. Add it in Dev Dashboard → Kavern → configuration scopes, release a new
  app version, then reinstall/update Kavern on the store so the new scope is
  granted. A token minted before that still carries the old scope.

Products are not needed for the COD confirmation flow itself, only for showing
line-item detail in the WhatsApp message. Decide whether P2 needs it before
paying the reinstall step.

### Store has no orders yet

`orders` returns an empty list, so there is nothing to build the COD confirmation
message against. Create at least one test order in the dev store (Shopify admin →
Orders → Create order, with a phone number on the customer/shipping address) before
wiring the n8n side.

## Local-service recovery

While testing the Shopify app URL, the public ngrok domain returned
`ERR_NGROK_3200`, meaning its local endpoint was offline.

Investigation confirmed that:

- The ngrok process was initially absent, so the reserved public domain had no
  reachable local target.
- An n8n startup process was running but had not opened local port `5678` after
  several minutes. It was treated as stalled rather than as a normal update.

Recovery performed:

1. Started the reserved ngrok tunnel to local port `5678` using the existing
   `NGROK_AUTHTOKEN` from `.env`.
2. Stopped the stalled n8n process and started one clean n8n instance.
3. Confirmed n8n is listening on port `5678`.
4. Confirmed both local checks return HTTP `200`:

   ```text
   http://127.0.0.1:5678/healthz
   http://127.0.0.1:4040/api/tunnels
   ```

The public URL is therefore live again:

```text
https://coherent-drudge-wobble.ngrok-free.dev
```

Keep the local n8n and ngrok processes running. If the laptop sleeps, restarts,
or their terminal session ends, start them again before relying on the WhatsApp
webhook or Shopify App URL.

### Second occurrence — 19 August 2026, duplicate n8n processes

Same symptom (`ERR_NGROK_3200` on the Shopify app page), different cause the
second time. Diagnosis:

- ngrok was actually still up and correctly forwarding to port `5678` — its
  local API (`127.0.0.1:4040/api/tunnels`) returned 200 the whole time.
- n8n was down. A first restart attempt (started detached via `nohup ... &
  disown`) looked like it had launched, but the process was gone minutes later
  with an empty log — that backgrounding method doesn't reliably survive in
  this environment.
- A second restart attempt was made without confirming the first one was
  actually dead. Result: **two separate `n8n start` processes**, both trying
  to bind port `5678`. Neither answered `healthz` cleanly, and the tunnel had
  no working backend, reproducing `ERR_NGROK_3200` even though "something"
  was technically running.

Fix:

1. Listed actual OS processes (`Get-CimInstance Win32_Process -Filter
   "Name = 'node.exe'"`, which unlike `ps aux` in this environment reliably
   shows the full command line) to confirm two `n8n start` processes existed.
2. Killed both.
3. Started **one** clean n8n instance the reliable way for this environment:
   `n8n` resolves to a `.ps1` shim (`Get-Command n8n`), so a plain
   `Start-Process -FilePath n8n` fails with "not a valid Win32 application."
   Launching it via a hidden wrapper —
   `Start-Process powershell.exe -ArgumentList '-NoProfile -Command "n8n start"'`
   with output redirected to a log file — starts it detached and durably.
4. Waited out the normal boot sequence: `healthz` returns 200 fairly quickly,
   but the root path (`/`) keeps returning `503 {"message":"Database is not
   ready!"}` for a bit longer while SQLite finishes initializing. Root
   returning 200 is the real "fully up" signal, not just `healthz`.
5. Confirmed end-to-end: `healthz` → 200, public ngrok URL → 200.

Also worth knowing: a `Get-CimInstance Win32_Process` query that reads full
command lines will print any secret passed as a CLI argument in plaintext —
this happened here with the `NGROK_AUTHTOKEN` (it's started with
`ngrok http 5678 --authtoken <token>`, visible in `CommandLine`). Not a repo
leak, but worth rotating that token in the ngrok dashboard since it briefly
appeared in a terminal session.

**Rule for next time:** before starting n8n again, check for existing node
processes first (`Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"`)
rather than assuming a previous attempt died just because its log went quiet.

## Next step

1. Create a test order in the dev store with a phone number attached.
2. Decide whether P2 needs `read_products`; if yes, add the scope, release a new
   app version and reinstall Kavern, then re-run `npm run verify:shopify`.
3. Build the n8n token step: an HTTP Request node POSTing the client-credentials
   grant, feeding `X-Shopify-Access-Token` into the Admin GraphQL call. Request a
   fresh token per run rather than caching one — they expire in 24h.
