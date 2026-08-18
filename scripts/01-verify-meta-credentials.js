// Step 1 isolation test: proves META_ACCESS_TOKEN and META_PHONE_NUMBER_ID
// work by sending one hardcoded WhatsApp message. Touches nothing else —
// no n8n, no Supabase.
//
// Run with: node --env-file=.env scripts/01-verify-meta-credentials.js

import { appendFileSync } from "node:fs";

const LOG_FILE = "scripts/01-verify-meta-credentials.log";

function log(line) {
  const entry = `[${new Date().toISOString()}] ${line}`;
  console.log(entry);
  appendFileSync(LOG_FILE, entry + "\n");
}

const { META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, META_API_VERSION } = process.env;

const missing = ["META_ACCESS_TOKEN", "META_PHONE_NUMBER_ID", "META_API_VERSION", "ALLOWED_WHATSAPP_NUMBER"].filter(
  (key) => !process.env[key]
);
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  console.error("Did you run with --env-file=.env ?");
  process.exit(1);
}

// Recipient comes from .env so each developer texts their OWN handset.
// Must be a number registered as a verified recipient on your Meta test number,
// digits only, no "+", no spaces.
const TEST_RECIPIENT = process.env.ALLOWED_WHATSAPP_NUMBER;

const url = `https://graph.facebook.com/${META_API_VERSION}/${META_PHONE_NUMBER_ID}/messages`;

const body = {
  messaging_product: "whatsapp",
  to: TEST_RECIPIENT,
  type: "text",
  text: { body: "credential test" },
};

log(`POST ${url} to=${TEST_RECIPIENT}`);

let response;
try {
  response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${META_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
} catch (networkError) {
  log(`NETWORK ERROR: ${networkError.message}`);
  process.exit(1);
}

const data = await response.json();

log(`HTTP ${response.status}`);
log(JSON.stringify(data, null, 2));

if (!response.ok) {
  log("Send failed.");
  if (data?.error?.error_data?.details) {
    log(`Details: ${data.error.error_data.details}`);
  }
  process.exit(1);
}

const wamid = data?.messages?.[0]?.id;
log(`Send accepted by Meta. wamid=${wamid ?? "MISSING"}`);
log("Note: HTTP 200 means Meta accepted the message, not that it was delivered. Delivery status only arrives later via webhook (step 4+) — check your phone directly.");
