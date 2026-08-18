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

## Product-data test

We attempted a read-only GraphQL request for the first 10 products with:

```graphql
{ products(first: 10) { nodes { title handle status totalInventory } } }
```

Results:

1. First request failed with `app_not_installed`, which correctly identified
   that Kavern had not been installed on the shop.
2. Kavern was then installed on `kavern-ngm2illt.myshopify.com`.
3. Two subsequent read-only requests did not return product data: one hung and
   timed out, and the next failed before an HTTP response was received. No data
   was changed, and no credentials or access token were printed.

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

## Next step

Retry the product query now that the app is installed and the public App URL is
back online. If it still times out, verify in Dev Dashboard that Kavern is
installed on this exact store under the same organization, then make a minimal
token-only request before retrying GraphQL.
