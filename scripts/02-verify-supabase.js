// Step 2 verification: proves the messages table works through the REST API
// using SUPABASE_URL + SUPABASE_SERVICE_KEY. Inserts a test row, reads it back,
// deletes it, and confirms both constraints fire (bad direction rejected,
// duplicate wamid ignored).
//
// Run with: node --env-file=.env scripts/02-verify-supabase.js

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;

const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_KEY"].filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const base = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/messages`;
const headers = {
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  "Content-Type": "application/json",
};

const TEST_WAMID = "wamid.STEP2_TEST_0001";

function fail(msg, extra) {
  console.error(`\nFAIL: ${msg}`);
  if (extra !== undefined) console.error(extra);
  process.exit(1);
}

// 0. Clear any leftover test row from a previous failed run so this is idempotent.
await fetch(`${base}?wa_message_id=eq.${TEST_WAMID}`, { method: "DELETE", headers });

// 1. Insert a valid row and read it back in the same call.
const insertRes = await fetch(base, {
  method: "POST",
  headers: { ...headers, Prefer: "return=representation" },
  body: JSON.stringify({
    from_number: "923000413777",
    message_text: "step 2 smoke test",
    direction: "in",
    wa_message_id: TEST_WAMID,
    timestamp: new Date().toISOString(),
    raw_payload: { test: true },
  }),
});
const inserted = await insertRes.json();
if (!insertRes.ok) fail(`insert returned HTTP ${insertRes.status}`, inserted);
if (!Array.isArray(inserted) || inserted.length !== 1) fail("insert did not return one row", inserted);
console.log(`OK  insert — row id ${inserted[0].id}`);

// 2. Read it back by wa_message_id.
const readRes = await fetch(`${base}?wa_message_id=eq.${TEST_WAMID}&select=*`, { headers });
const rows = await readRes.json();
if (!readRes.ok) fail(`read returned HTTP ${readRes.status}`, rows);
if (rows.length !== 1 || rows[0].message_text !== "step 2 smoke test") fail("read did not return the inserted row", rows);
console.log("OK  read back");

// 3. Constraint: invalid direction must be rejected.
const badDirRes = await fetch(base, {
  method: "POST",
  headers,
  body: JSON.stringify({
    from_number: "923000413777",
    direction: "sideways",
    timestamp: new Date().toISOString(),
  }),
});
if (badDirRes.ok) fail("invalid direction was accepted — CHECK constraint not working");
console.log(`OK  direction CHECK rejected bad value (HTTP ${badDirRes.status})`);

// 4. Constraint: duplicate wamid with ignore-duplicates must NOT error and must NOT create a second row.
// PostgREST only honours ignore-duplicates as an UPSERT, which needs the on_conflict
// target naming the unique column — without it a duplicate POST just 409s.
const dupRes = await fetch(`${base}?on_conflict=wa_message_id`, {
  method: "POST",
  headers: { ...headers, Prefer: "resolution=ignore-duplicates,return=representation" },
  body: JSON.stringify({
    from_number: "923000413777",
    message_text: "duplicate attempt",
    direction: "in",
    wa_message_id: TEST_WAMID,
    timestamp: new Date().toISOString(),
    raw_payload: { dup: true },
  }),
});
if (!dupRes.ok) fail(`duplicate insert errored (HTTP ${dupRes.status}) — expected silent ignore`, await dupRes.text());
const countRes = await fetch(`${base}?wa_message_id=eq.${TEST_WAMID}&select=id`, { headers });
const countRows = await countRes.json();
if (countRows.length !== 1) fail(`duplicate created ${countRows.length} rows — dedup failed`, countRows);
console.log("OK  duplicate wamid ignored (still one row)");

// 5. Clean up.
const delRes = await fetch(`${base}?wa_message_id=eq.${TEST_WAMID}`, { method: "DELETE", headers });
if (!delRes.ok) fail(`delete returned HTTP ${delRes.status}`, await delRes.text());
console.log("OK  cleaned up test row");

console.log("\nStep 2 verified: table reachable, insert/read/delete work, both constraints fire.");
