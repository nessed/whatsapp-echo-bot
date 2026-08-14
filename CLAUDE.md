# CLAUDE.md

## What this is

A private WhatsApp interface to DeepSeek. The allowed test phone sends text to the Meta number; n8n supplies recent conversation context to DeepSeek, returns the answer through WhatsApp, and logs both directions in Supabase.

This is practice project P1 in a series. The real deliverable is the plumbing: webhook handling, API auth, payload parsing, idempotency, bounded context, and structured logging. P2 will be a client-facing COD order confirmation bot built on the same patterns.

## Operating mode: manual-first coaching

**Read this before anything else. It governs everything below.**

I build the n8n nodes and dashboard configuration myself the first time, using the checklist and reference docs. You provide exact settings, inspect execution data, diagnose failures, keep docs current, and make safe repository changes. Do not silently build or overwrite my live n8n workflow unless I explicitly delegate a specific step.

Keep me in the loop with short, plain-English explanations of what you did and why — a couple of sentences, not a lecture. I want to roughly understand the moving parts, but I don't need to be quizzed, made to explain things back, or walked through it step by step before you act.

### How to move

- Keep the current manual step explicit: tell me which node, field, or dashboard action I should do next, then wait for my result when that action changes a live service.
- Do make safe repository-only changes, scripts, and documentation without asking.
- Prove each step actually works before moving on (see Verification bias below). "Done when" conditions in `context/05` still apply — that's about not shipping broken plumbing, not about slowing down.
- When something breaks, diagnose it from the execution and tell me the smallest manual correction. Don't turn it into a Socratic exercise.
- Still ask before: spending money, anything that could leak a credential publicly, or deleting data that can't be recovered. And still ask before `npm install` or global package changes.

### Explaining

- Plain terms, colleague register. Skip the praise, the "great question," and recaps of stuff I already said.
- Do flag Meta-specific quirks when they bite — those are genuinely obscure and worth a sentence.
- Flag uncertainty inline. If you're not sure a menu is named what the docs say or an API version is current, say so rather than sending me chasing a confident guess.
- Be blunt when something I said is wrong. One line, then the fix.
- **Format for a narrow terminal pane, not a wide doc viewer.** I'm reading this in a CLI, not a browser — long unbroken paragraphs wrap into a wall of text and become unreadable. Rules:
  - Short paragraphs, 1-3 lines max, then a blank line.
  - Prefer short bullets over dense prose. One idea per bullet, not three clauses stitched together.
  - Break long explanations into small headed sections (`##`/`###`) rather than one continuous block.
  - Don't sacrifice content depth for this — I still want full context, especially for stuff that's new to me (first time doing n8n/Meta/Supabase). Just chop it into scannable pieces instead of paragraphs.

## Stack

- Meta WhatsApp Cloud API (test/sandbox phone number, Graph API)
- n8n, self-hosted locally with the existing reserved ngrok tunnel
- Supabase (Postgres) for message logging
- DeepSeek API (`deepseek-v4-flash`, non-thinking) for responses

## Where the context lives

Read these before making decisions. They are detailed and current as of setup.

| File | Contents |
|---|---|
| `context/01-project-brief.md` | Full what/why, and the definition of done |
| `context/02-meta-whatsapp-api.md` | Meta app setup, permanent tokens, webhook handshake, payload shapes, send API. **Most important file.** |
| `context/03-n8n-setup.md` | Local n8n, HTTPS requirement, manual workflow builds, and API backup/export |
| `context/04-supabase-schema.md` | `messages` table design + CREATE TABLE SQL |
| `context/05-build-sequence.md` | Ordered build checklist with explicit "done when" conditions |
| `context/06-gotchas.md` | Known failure modes, **symptoms only**. Read before debugging. |
| `context/07-deepseek-whatsapp-assistant.md` | Manual node-by-node DeepSeek branch build |

`answers/06-gotchas-full.md` holds the causes and fixes for those same 19 symptoms. See the rule below before touching it.

`LESSONS-LEARNED.md` — the teaching-detail version of gotchas actually hit while building (not pre-written, discovered live). `CLAUDE.md`'s deviations log below has one-line summaries; that file has the full "why" for each. Read it when something in P2 rhymes with a past mistake.

## Directory purposes

- `scripts/` — standalone verification scripts (token check, test insert, fake-payload POSTer). Empty at setup time.
- `workflows/` — n8n workflow JSON, version controlled as a post-build export.
- `supabase/` — SQL migrations and schema files.

## How I want you to work

Within the teaching mode above:

- **Write complete files, not snippets** — when you write at all. If a script needs 60 lines, write all 60 into a file rather than handing me a fragment and telling me where to paste it. See the division-of-labour rule for when you should be writing versus when I should.
- **Ask before installing anything.** No `npm install` or global package changes without checking first.
- **Explain in plain terms, not tutorial-speak.** Same register you'd use talking to a colleague. Skip the "Great question!", the numbered recap of concepts I already know, and the praise. I don't need to be told a question was good.
- **Assume I'm technically competent.** Don't explain what a webhook or an env var is. Do explain Meta-specific quirks — those are genuinely obscure and partly undocumented, and knowing them isn't a skill I can derive from first principles.
- **Be blunt when I'm wrong.** Say "no, that's wrong" and then explain. Don't lead with what's good about a broken approach before getting to the problem. I'd rather be corrected in one line than let down gently over five.
- **Flag uncertainty inline.** If you're not sure a dashboard menu is still named what the docs say, or an API version is current, say so rather than asserting it. Don't let me waste an hour on your confident guess.

I'm a student with limited hours. That constrains where the effort goes, not how rigorous it is — spend my time on the parts that transfer to P2, and don't spend it on typing boilerplate or on ceremony.

If there's a choice between a clever solution and one I can debug at 1am three weeks from now, pick the second.

## The answers file — important

`answers/06-gotchas-full.md` is an answer key. **Do not read it, quote it, summarise it, or act on it unless I ask you to by name.**

This one file stays off-limits by default: don't read, quote, or summarise `answers/06-gotchas-full.md` unless I ask for it by name. When something breaks, diagnose it from the actual evidence (execution logs, raw payloads, error bodies) and just fix it. If you get genuinely stuck, say so and ask whether to open the answers file rather than reading it unprompted.

**Not restricted:** `context/01` through `context/05`. Those are reference material — API shapes, endpoints, schema, build order. Use them freely.

## Verification bias

Every step in `context/05-build-sequence.md` has a "done when" condition. Prove each one before moving on. Building three steps and then testing means I can't tell which of the three broke.

## Resuming after a restart

n8n and the ngrok tunnel run as local background processes in a terminal session — they are **not** persistent services. If the laptop sleeps, the terminal closes, or a session ends, both die and need to be restarted:

```bash
npx n8n start          # in one terminal — the workflow you built in the GUI is saved to disk (~/.n8n) and will still be there
npx ngrok http 5678    # in another terminal
```

**UPDATE — the ngrok URL is now STABLE, not ephemeral.** The `NGROK_AUTHTOKEN` in `.env` is on an account with a **reserved domain**, so ngrok comes back on the *same* URL every restart: `https://coherent-drudge-wobble.ngrok-free.dev`. This means:
- `N8N_URL` in `.env` does **not** need changing on restart — it's already correct.
- Meta's webhook does **not** need re-pasting or re-verifying on restart — the old URL isn't dead, it's the same URL. (The "URL changes every time" advice above was true for a plain free tier; it does not apply here.)
- Start ngrok with `npx ngrok http 5678 --authtoken <NGROK_AUTHTOKEN from .env>` so it picks up the reserved domain.

Restart commands: `npx n8n start` in one terminal, the ngrok command above in another. Give n8n ~30-60s on first boot. Confirm both up: `curl http://localhost:5678/healthz` (expect 200) and `curl http://localhost:4040/api/tunnels`.

**How we build now:** build new n8n nodes manually in the GUI. Keep credentials encrypted in n8n and out of workflow JSON. Export the working workflow back to `workflows/` after a verified step. **After every edit, republish** or the change won't go live — see the active-version deviation below.

**To resume:** restart n8n + ngrok per above (URL is already correct, no Meta re-verify needed), rotate the exposed credentials, then pick up at **step 7** in `context/05`. The workflow, credentials, and Supabase data survive restarts.

## Current status

Steps 1-6 are done and verified. The inbound path parses and logs a message with dedup. Not yet built: credential rotation, the `assistant_runs` migration, the manual DeepSeek branch, outbound logging, and the real-phone end-to-end test. Next action: step 7 in `context/05`.

- [x] 1. Meta credentials verified in isolation — `scripts/01-verify-meta-credentials.js`. Permanent System User token confirmed (`expires_at: 0`).
- [x] 2. Supabase table created and test insert verified — `supabase/001_create_messages.sql` + `scripts/02-verify-supabase.js`. Both constraints confirmed firing.
- [x] 3. n8n instance live on a public HTTPS URL — self-hosted via `npx n8n` (localhost:5678) + ngrok tunnel. API key verified (GET /workflows → 200, empty array). ngrok URL is ephemeral; re-point on restart.
- [x] 4. Webhook GET verification handshake passing — built by hand in the n8n GUI (Ali is clicking nodes himself for this project rather than pushing workflow JSON). `whatsapp-echo-bot` workflow: Webhook (GET, path `whatsapp`, respond via node) → IF (checks `hub.mode == subscribe` AND `hub.verify_token == WEBHOOK_VERIFY_TOKEN`) → Respond to Webhook (200, body = `hub.challenge`) on true / Respond to Webhook (403, "Forbidden") on false. Curl-tested locally and via the ngrok URL before pointing Meta at it. Meta dashboard shows "Configure Webhooks" verified (green check), and `messages` field is confirmed subscribed (had to check manually — Meta auto-subscribes several other fields like `account_update`/`calls` but not `messages` by default, matching the known trap in `context/02` §4).
- [x] 5. POST handler parsing inbound messages — **done.** POST branch: `Webhook1` (POST, path `whatsapp`) → `If1` (guard: `messages` is a non-empty array, AND of the two conditions) → true: `Edit Fields` (5 fields) → `Respond OK (msg)` (200, `OK`); false: `Respond OK (status)` (200, `OK`). The two `Respond OK` nodes and the final expression cleanup were pushed via the n8n REST API (`scripts/`-style patch), not the GUI — the GUI got us the nodes, the API finished the wiring. Verified with `scripts/03-post-fake-payload.js`: text payload parses all 5 fields clean (`from_number` `447700900123`, `message_type` `text`, etc.); status payload terminates at `If1` false without touching Edit Fields and returns 200; image payload yields `message_text: null` + `message_type: image` with no crash (the `?.` guard). Field expressions confirmed by reading them back out of the workflow JSON and out of the execution `runData`, not just eyeballing the canvas.
- [x] 6. Supabase logging on inbound — **done.** Chain is now `Edit Fields → Log to Supabase → Respond OK (msg)`. **Not** built with the dedicated Supabase node — that node's "Create a row" op is a plain insert with no upsert/on-conflict option, so it hard-errored on a duplicate `wa_message_id`. Replaced it with an **HTTP Request** node hitting `POST {SUPABASE_URL}/rest/v1/messages?on_conflict=wa_message_id` with `Prefer: resolution=ignore-duplicates` (the exact call proven in `scripts/02`), authed via the `supabaseApi` predefined-credential-type so the service key stays out of the workflow JSON. Node name: `Log to Supabase`. All 6 columns populated: `from_number`, `message_text`, `direction='in'`, `wa_message_id`, `timestamp` (Unix-sec×1000→ISO), `raw_payload` (full webhook body as real jsonb). Verified by querying Supabase directly: running the fake-payload script twice → exactly 2 rows (text + image), the status ping made 0 rows, the duplicate second run was silently ignored, and `raw_payload` is a real JSON object (see step-6 deviation for the bug that nearly broke this). See `LESSONS-LEARNED.md` for full detail.
- [ ] 7. Rotate exposed credentials and verify DeepSeek in isolation
- [ ] 8. Apply and verify `assistant_runs` manually in Supabase
- [ ] 9. Build the manual DeepSeek branch and outbound logging in n8n
- [ ] 10. Full end-to-end test from my phone

**Claude Code: update this checklist as we complete steps.** Tick the box and add a one-line note about anything that differed from the docs — that note is what makes the docs accurate for P2.

### Deviations log

- **Step 1:** A free-form text send to a user who has NOT messaged the test number first returns HTTP 200 with a valid wamid but is **silently not delivered** — no error 131047 as `context/02` §7 implies. Fix: the recipient must text the test number first to open the 24-hour window; then free-form sends deliver. The dashboard "test" button works regardless because it sends an approved template. This is the 24-hour-window rule biting in practice, and matters directly for P2 (which must open with a template).
- **Step 2:** Duplicate-delivery dedup over the Supabase REST API needs BOTH `Prefer: resolution=ignore-duplicates` AND the `on_conflict=wa_message_id` query param. The Prefer header alone does nothing — a duplicate POST just 409s. The n8n insert node in step 6 must set the on_conflict target, not just the ignore preference.
- **Step 4:** Webhook config now lives under App Dashboard > Use cases > Connect on WhatsApp > Step 2. Production setup > Configure Webhooks — not a standalone "Configuration"/"Webhooks" sidebar item as `context/02` §4 implies. Also, Meta auto-subscribes several webhook fields on save (`account_update`, `account_review_update`, `calls`, `message_template_quality_update`) but **not** `messages` — that one had to be checked/enabled manually. `curl`'s non-browser user-agent skips the ngrok free-tier interstitial warning page automatically, so no interference there.
- **Step 5 — n8n "active version" vs draft (big one, will bite every GUI edit):** this n8n build separates the *working draft* from the *published/active version*. Editing nodes in the GUI (or `PUT`-ing via the API) updates the draft, but the live production webhook keeps serving the last **activated** version until you republish. Symptom: the POST webhook 404'd with "not registered for POST requests" even though the POST node was clearly on the canvas — because the active version predated it. Fix: after any node change, republish — GUI Publish/toggle Active off→on, or via API `POST /workflows/{id}/deactivate` then `/activate`. Confirm it took by checking `versionId === activeVersionId` on `GET /workflows/{id}`.
- **Step 5 — invisible junk in Set-node expression fields:** a Set/`Edit Fields` field can carry a stray leading space or a pasted box-drawing char (`│`) in its **name or value** that is invisible on the canvas but real in the stored JSON — it corrupted a field name to `" from_number"` and a value to `" 447700900123"`. Only caught by pulling the workflow JSON (`GET /workflows/{id}`) and reading the raw `assignments`, and by inspecting the execution `runData`. Lesson: verify parsed fields from the execution data, not by looking at the node. Also n8n re-normalizes expressions on save (re-inserts a space after `=` in some cases) — harmless, but don't be surprised the stored string isn't byte-identical to what you pushed.
- **Step 5 — Respond-node requirement:** a Webhook node set to "respond via node" (`responseMode: responseNode`) throws HTTP 500 "No Respond to Webhook node found in the workflow" and does **not** execute at all if the branch it takes has no `Respond to Webhook` node downstream. Both branches (message and status) need their own responder. This is stricter than a hang/timeout — it's an upfront refusal to run.
- **Step 6 — the dedicated Supabase node can't dedup; the `= {{` space bug corrupts objects.** Two things bit here. (1) The built-in Supabase node's "Create a row" op is a plain insert with no on-conflict/upsert option anywhere in its UI, so a duplicate `wa_message_id` throws a real Postgres unique-constraint error and fails the execution. Fix: use an HTTP Request node against the Supabase REST API directly with the `on_conflict` + `Prefer` combo from the step-2 deviation. (2) Same invisible-space bug as step 5, but this time destructive: a value typed as `= {{ expr }}` (space after `=`) instead of `={{ expr }}` makes n8n treat it as a **string template** rather than a pure expression. For a string that just adds a leading space; for an **object** (`raw_payload`) it stringifies to the literal `"[object Object]"` — the entire JSON payload silently replaced by junk, no error. Rule: for any field meant to carry a non-string (object/number), the expression must be exactly `={{ ... }}` with no leading space, and you must verify what actually landed in the DB, not just that the insert returned 200. Full write-up in `LESSONS-LEARNED.md`.
