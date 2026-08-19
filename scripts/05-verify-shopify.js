// P2 step: proves the Kavern Shopify app can authenticate and read from the
// Admin API before any of it is wired into n8n.
//
// Flow: client-credentials grant -> 24h access token -> read-only GraphQL.
// Nothing is written to the store and the token is never printed.
//
// Run with: node --env-file=.env scripts/05-verify-shopify.js

const {
  SHOPIFY_STORE_DOMAIN,
  SHOPIFY_CLIENT_ID,
  SHOPIFY_CLIENT_SECRET,
  SHOPIFY_ADMIN_API_VERSION = "2026-07",
} = process.env;

const missing = [
  "SHOPIFY_STORE_DOMAIN",
  "SHOPIFY_CLIENT_ID",
  "SHOPIFY_CLIENT_SECRET",
].filter((key) => !process.env[key]);

if (missing.length) {
  console.error(`Missing required environment variable(s): ${missing.join(", ")}`);
  process.exit(1);
}

const domain = SHOPIFY_STORE_DOMAIN.replace(/^https?:\/\//, "").replace(/\/$/, "");
const TIMEOUT_MS = 20000;

// ---------------------------------------------------------------- token

const tokenUrl = `https://${domain}/admin/oauth/access_token`;
console.log(`POST ${tokenUrl} (grant_type=client_credentials)`);

let tokenResponse;
try {
  tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: SHOPIFY_CLIENT_ID,
      client_secret: SHOPIFY_CLIENT_SECRET,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
} catch (error) {
  console.error(`Token request failed before an HTTP response: ${error.name}: ${error.message}`);
  process.exit(1);
}

const tokenBody = await tokenResponse.text();
console.log(`HTTP ${tokenResponse.status}`);

if (!tokenResponse.ok) {
  console.error(tokenBody.slice(0, 500));
  process.exit(1);
}

let token;
try {
  const parsed = JSON.parse(tokenBody);
  token = parsed.access_token;
  console.log(
    `Token acquired: scope="${parsed.scope ?? "<none>"}" expires_in=${parsed.expires_in ?? "<none>"}s`,
  );
} catch {
  console.error(`Token response was not JSON: ${tokenBody.slice(0, 300)}`);
  process.exit(1);
}

if (!token) {
  console.error("Token response contained no access_token.");
  process.exit(1);
}

// ---------------------------------------------------------------- graphql

const graphqlUrl = `https://${domain}/admin/api/${SHOPIFY_ADMIN_API_VERSION}/graphql.json`;

async function graphql(label, query) {
  console.log(`\n--- ${label} ---`);
  console.log(`POST ${graphqlUrl}`);

  let response;
  try {
    response = await fetch(graphqlUrl, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    console.error(`Request failed before an HTTP response: ${error.name}: ${error.message}`);
    return null;
  }

  const text = await response.text();
  console.log(`HTTP ${response.status}`);

  if (!response.ok) {
    console.error(text.slice(0, 500));
    return null;
  }

  const data = JSON.parse(text);
  if (data.errors) {
    console.error(JSON.stringify(data.errors, null, 2));
    return null;
  }
  return data.data;
}

const shop = await graphql(
  "shop",
  `{ shop { name myshopifyDomain email currencyCode ianaTimezone plan { displayName } } }`,
);
if (shop) console.log(JSON.stringify(shop.shop, null, 2));

const products = await graphql(
  "products (first 10)",
  `{ products(first: 10) { nodes { id title handle status totalInventory } } }`,
);
if (products) {
  const nodes = products.products.nodes;
  console.log(`${nodes.length} product(s)`);
  for (const p of nodes) {
    console.log(`  ${p.title} | handle=${p.handle} | ${p.status} | inventory=${p.totalInventory}`);
  }
}

const orders = await graphql(
  "orders (first 10, newest first)",
  `{ orders(first: 10, sortKey: CREATED_AT, reverse: true) {
       nodes {
         id name createdAt displayFulfillmentStatus displayFinancialStatus
         totalPriceSet { shopMoney { amount currencyCode } }
         customer { displayName phone }
         shippingAddress { phone city country }
       }
     } }`,
);
if (orders) {
  const nodes = orders.orders.nodes;
  console.log(`${nodes.length} order(s)`);
  for (const o of nodes) {
    const money = o.totalPriceSet?.shopMoney;
    console.log(
      `  ${o.name} | ${o.createdAt} | ${money?.amount} ${money?.currencyCode} | ` +
        `${o.displayFinancialStatus}/${o.displayFulfillmentStatus} | ` +
        `phone=${o.customer?.phone ?? o.shippingAddress?.phone ?? "<none>"}`,
    );
  }
}

const failed = !shop || !products || !orders;
console.log(`\n${failed ? "One or more reads failed." : "All Shopify reads succeeded."}`);
process.exit(failed ? 1 : 0);
