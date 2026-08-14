// Step 5 verification: POSTs fake Meta webhook payloads at the n8n POST webhook
// so you can iterate on parsing without a phone in your hand.
//
// Sends three payloads:
//   1. a real inbound text message   -> should hit the If1 TRUE branch (Edit Fields)
//   2. a delivery status update      -> should hit the If1 FALSE branch (the guard)
//   3. a non-text (image) message    -> proves the `text?.body` optional chaining
//                                        doesn't crash when there is no .text
//
// It prints the HTTP status + body for each. The PARSED FIELDS themselves are only
// visible in the n8n execution log (Executions tab) — the webhook just responds "OK".
// So after running this, open n8n > Executions and confirm the 5 fields on the
// text payload, and that the status payload terminated at the guard without parsing.
//
// Targets http://localhost:5678 by default (fast, no tunnel). Override the base with
// N8N_WEBHOOK_BASE if you want to go through ngrok instead.
//
// Run with: node --env-file=.env scripts/03-post-fake-payload.js

const BASE = (process.env.N8N_WEBHOOK_BASE || "http://localhost:5678").replace(/\/$/, "");
const URL = `${BASE}/webhook/whatsapp`;
const TIMEOUT_MS = 15000;

// 1. Inbound text message — the example JSON from context/02 §5.
const textPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550559999", phone_number_id: "106540352242922" },
            contacts: [{ profile: { name: "Ali" }, wa_id: "447700900123" }],
            messages: [
              {
                from: "447700900123",
                id: "wamid.FAKE_TEXT_0001",
                timestamp: "1754212800",
                text: { body: "hello there" },
                type: "text",
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

// 2. Delivery status update — value has `statuses`, no `messages`. Must be filtered.
const statusPayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550559999", phone_number_id: "106540352242922" },
            statuses: [
              {
                id: "wamid.FAKE_STATUS_0001",
                status: "delivered",
                timestamp: "1754212805",
                recipient_id: "447700900123",
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

// 3. Non-text (image) message — same shape as (1) but `image` instead of `text`.
// `text?.body` must resolve to undefined rather than throwing.
const imagePayload = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "102290129340398",
      changes: [
        {
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "15550559999", phone_number_id: "106540352242922" },
            contacts: [{ profile: { name: "Ali" }, wa_id: "447700900123" }],
            messages: [
              {
                from: "447700900123",
                id: "wamid.FAKE_IMAGE_0001",
                timestamp: "1754212810",
                image: { id: "media-id-123", mime_type: "image/jpeg", sha256: "abc123" },
                type: "image",
              },
            ],
          },
          field: "messages",
        },
      ],
    },
  ],
};

async function send(label, payload, expectBranch) {
  process.stdout.write(`\n--- ${label} (expect: ${expectBranch}) ---\n`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const body = await res.text();
    console.log(`HTTP ${res.status}  body: ${JSON.stringify(body)}`);
    if (res.status === 404) {
      console.log("  ^ 404 = workflow not active, or the POST Webhook node isn't listening on /whatsapp.");
    }
  } catch (err) {
    if (err.name === "AbortError") {
      console.log(`TIMEOUT after ${TIMEOUT_MS / 1000}s — no HTTP response came back.`);
      console.log("  ^ The branch this payload hits has no 'Respond to Webhook' node yet.");
      console.log("    The execution still ran — check n8n > Executions — but nothing answered the request.");
    } else {
      console.log(`ERROR: ${err.message}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

console.log(`POSTing fake payloads to ${URL}`);
await send("1. inbound text message", textPayload, "If1 TRUE -> Edit Fields");
await send("2. delivery status update", statusPayload, "If1 FALSE -> guard, no parse");
await send("3. non-text image message", imagePayload, "If1 TRUE -> Edit Fields, message_text empty");

console.log("\nDone. Now open n8n > Executions and confirm:");
console.log("  - text payload: 5 fields populated (message_text = 'hello there', message_type = 'text')");
console.log("  - status payload: terminated at If1 FALSE, never reached Edit Fields");
console.log("  - image payload: reached Edit Fields, message_text empty/undefined, message_type = 'image', no crash");
