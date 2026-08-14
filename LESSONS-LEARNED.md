# Lessons learned — n8n build gotchas

This is the fuller, teaching version of things that went wrong while building the workflow in n8n. `CLAUDE.md`'s deviations log has the one-line summaries; this file has the "why," so the pattern is recognizable next time (including in P2).

---

## 1. n8n keeps a separate "draft" and "published/active" version

Editing nodes — in the GUI, or by pushing JSON through the API — updates a **draft**. The live production webhook keeps serving whatever version was last **activated**, until you explicitly republish.

**How it bit us:** the POST branch (`Webhook1`, `If1`, etc.) was built and saved, but the running webhook still 404'd with `"This webhook is not registered for POST requests"` — because the active version predated those nodes. The nodes were real, visible on the canvas, just not live.

**Fix:** after any node change, republish. In the GUI that's the Publish/Active toggle; via the API it's `POST /workflows/{id}/deactivate` then `POST /workflows/{id}/activate`. You can confirm it actually took by checking `versionId === activeVersionId` on `GET /workflows/{id}` — if they differ, the draft hasn't gone live.

**The general lesson:** in n8n, "I saved it" and "it's running" are two different facts. Don't assume — check.

---

## 2. Expression fields can contain invisible corruption

A Set-node field's Name or Value can carry a stray leading space, or even a pasted box-drawing character (`│`), that is **completely invisible on the canvas** but very real in the stored data.

**How it bit us:** `Edit Fields`' `from_number` field name was actually stored as `" from_number"` (leading space) and its value came out as `" 447700900123"`. Looked completely normal in the GUI. Only visible by pulling the raw workflow JSON via the API, or by looking at what a real execution actually produced.

**The general lesson:** don't trust "it looks right in the node editor" for anything that matters. Trust the actual execution output, or the raw stored JSON. This is the same instinct as `raw_payload` in the database — always keep a way to see the unprocessed truth, not just the parsed/rendered version.

---

## 3. A space between `=` and `{{` silently breaks non-string values

n8n fields toggle between two modes: **Fixed** (plain text, taken literally) and **Expression** (the `{{ }}` gets evaluated). A field in Expression mode is stored with a leading `=`.

If the field is *exactly* `={{ expression }}` (no space after the `=`), n8n treats the whole thing as **one pure expression** — whatever type the expression evaluates to (string, number, object) is preserved as-is.

If there's a stray space — `= {{ expression }}` — n8n instead treats it as a **string template**, like `"Hello {{ name }}"`. It evaluates the expression and inserts the result into a string. For a string or number this just adds an unwanted leading space. For an **object**, this is much worse: JavaScript's default way of turning an object into a string is the literal text `"[object Object]"` — so the real data is gone, replaced by that useless string.

**How it bit us:** the `raw_payload` field (meant to hold the entire original WhatsApp payload as real JSON) was accidentally typed with that leading space, so what got sent to Supabase was the string `"[object Object]"` instead of the actual payload. Silent, no error — it "worked," just uselessly.

**The general lesson:** for anything other than a plain string, the exact form of the expression matters, not just its content. When a field is supposed to carry a real object (not text), verify what actually landed in the database, not just that the insert succeeded.

---

## 4. A `responseNode`-mode Webhook needs a Respond node on *every* branch

If a Webhook node is set to "respond via node" and a branch of the workflow reaches the end without ever hitting a `Respond to Webhook` node, n8n doesn't hang — it throws `HTTP 500: No Respond to Webhook node found in the workflow` and refuses to run that execution at all.

**The general lesson:** every fork after a `responseNode` webhook needs its own path to a response, even if that response is a boring "200 OK." We built this by having *two* Respond nodes — one for the real-message branch, one for the status-ping branch — both ending in "OK," just reached from different forks.

---

## 5. The built-in Supabase node can't do upsert/dedup — and fails hard on a duplicate

The dedicated **Supabase** node's "Create a row" operation is a plain insert. Its UI (Resource/Operation/Table/Fields) has no upsert or on-conflict option anywhere.

**How it bit us:** we already knew from step 2 that a duplicate `wa_message_id` needs `on_conflict=wa_message_id` + `Prefer: resolution=ignore-duplicates` to be silently ignored (a bare insert 409s). The dedicated node doesn't expose any way to send that. Sending the same fake message twice made the second run hard-error with a real Postgres unique-constraint violation — the node failed, the execution errored, and Meta would've gotten a broken response instead of a clean 200.

**Fix:** swapped the dedicated Supabase node for a generic **HTTP Request** node calling Supabase's REST API directly — same URL, but with the query param and header set explicitly, replicating the exact call already proven to work in `scripts/02-verify-supabase.js`. Auth still goes through the same encrypted credential (via "Predefined Credential Type"), so the service key never appears in the workflow JSON.

**The general lesson:** a dedicated integration node is usually easier, but it only exposes what its author built a UI for. When you need behavior the node doesn't support, the generic HTTP Request node — talking to the same REST API directly — is the fallback, and you already know it works because you tested the raw API call earlier.

---

## 6. A node inserted "on a wire" can still land in the wrong spot

Using the `+` that appears on a wire is supposed to splice a new node cleanly into that connection. In practice, the Supabase node ended up wired as `Edit Fields → Respond OK (msg) → Create a row` — **after** the response, not before it — even though the intent was `Edit Fields → Create a row → Respond OK (msg)`.

**Why it mattered:** if the database write happens after Meta's already been told "OK," a failed write is invisible — Meta has no reason to retry, and there's no error trail. The whole point of writing-then-responding is that a failure is visible and (eventually) retried.

**Fix:** checked the actual `connections` object in the workflow JSON (not just how it looked on the canvas) and rewired it explicitly.

**The general lesson:** for anything where "the write must happen before the response," verify the actual wiring by reading the connections data, not by trusting the visual layout. This is the same principle as #2 — the canvas is a rendering, not the ground truth.

---

## Still open / not yet fixed

- **The GET verification `If` node only checks `hub.mode`, not `hub.verify_token`.** The two-condition check documented in `context/02` and claimed built in the old step-4 checklist entry isn't actually there — only one condition exists live. Low real-world risk for a test-number bot nobody's targeting, but it's a real gap against spec, and the same "verify a secret on an incoming request" pattern matters a lot more in P2 (verifying `X-Hub-Signature-256` on POSTs). Worth fixing before P2 starts.
