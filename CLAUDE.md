# CLAUDE.md

> **Collaborators and their agents: this file is Ali's personal working
> agreement plus the P1 build log.** The "Operating mode: manual-first coaching"
> rules below describe how *he* wants his agent to work with him — they are not
> addressed to you.
>
> Start at **[docs/AGENT-BRIEF.md](docs/AGENT-BRIEF.md)** instead. Come back
> here for the **deviations log** at the bottom, which is the most valuable
> reference in the repo: every place the documentation turned out to be wrong,
> and what was actually true.
>
> Two rules below *do* apply to everyone: never open
> `answers/06-gotchas-full.md` unprompted, and never commit secrets.

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

- **Talk to me like a human, not like a machine.** Use natural, conversational
  language and explain the practical meaning first. Do not dump architecture,
  jargon, schemas, or implementation details on me without first saying plainly
  what they mean and why I should care. Keep answers easy to follow, as if we are
  two people working through the product together.
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
| `context/08-deepseek-whatsapp-implementation-handoff.md` | Full current-state and manual implementation handoff |

`answers/06-gotchas-full.md` holds the causes and fixes for those same 19 symptoms. See the rule below before touching it.

`docs/LESSONS-LEARNED.md` — the teaching-detail version of gotchas actually hit while building (not pre-written, discovered live). `CLAUDE.md`'s deviations log below has one-line summaries; that file has the full "why" for each. Read it when something in P2 rhymes with a past mistake.

## Directory purposes

- `docs/` — explanations written for a human reader, not reference lookup. `WORKFLOW-EXPLAINED.md` (the system from first principles), `ARCHITECTURE.md` (node-by-node map + data model), `SETUP.md` (zero to running), `LESSONS-LEARNED.md`, `SHOPIFY-SETUP.md` (P2), `NOTEBOOKLM-PROMPT.md`.
- `scripts/` — standalone verification scripts (token check, test insert, fake-payload POSTer). Wired up as `npm run verify:meta` / `verify:supabase` / `verify:deepseek` / `test:webhook` in `package.json`.
- `workflows/` — n8n workflow JSON, version controlled as a post-build export.
- `supabase/` — SQL migrations and schema files.

`README.md` is the front door for a new collaborator; `CONTRIBUTING.md` holds the two-person working rules (shared infra, who owns the ngrok tunnel, republish-after-edit, never-commit list). Keep both current when the layout or the workflow changes.

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
n8n start              # in one terminal — the workflow you built in the GUI is saved to disk (~/.n8n) and will still be there
npx ngrok http 5678    # in another terminal
```

**UPDATE — n8n is now a real global install, not `npx n8n`.** `npx n8n start` re-resolves n8n's entire (huge — hundreds of AI/LangChain packages) dependency tree from the npm registry on every single run, which turned out to be flaky: hit `ETARGET` errors from stale npm registry metadata twice in a row (a package version npm claimed didn't exist was actually the latest published one — a local npm cache problem, fixed with `npm cache clean --force`). Rather than eat that flakiness every restart, n8n is now installed with `npm install -g n8n@2.32.7` (pinned to this known-working version, not `latest`, since `latest` at the time had its own broken dependency pin). Just run `n8n start` directly — no `npx`, no re-resolution, boots in ~60-80s on Windows instead of several minutes.

**UPDATE — the ngrok URL is now STABLE, not ephemeral.** The `NGROK_AUTHTOKEN` in `.env` is on an account with a **reserved domain**, so ngrok comes back on the *same* URL every restart: `https://coherent-drudge-wobble.ngrok-free.dev`. This means:
- `N8N_URL` in `.env` does **not** need changing on restart — it's already correct.
- Meta's webhook does **not** need re-pasting or re-verifying on restart — the old URL isn't dead, it's the same URL. (The "URL changes every time" advice above was true for a plain free tier; it does not apply here.)
- Start ngrok with `npx ngrok http 5678 --authtoken <NGROK_AUTHTOKEN from .env>` so it picks up the reserved domain.

Restart commands: `n8n start` in one terminal (global install, see above), the ngrok command above in another. Give n8n ~30-60s on first boot. Confirm both up: `curl http://localhost:5678/healthz` (expect 200) and `curl http://localhost:4040/api/tunnels`.

**Before restarting n8n, check nothing is already running.** A stalled or half-dead n8n process can sit there silently while you start a second one, and then both fight over port 5678 and neither works — happened once already (see `docs/SHOPIFY-SETUP.md`, "Second occurrence" under Local-service recovery). Check with `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"` (PowerShell) rather than trusting a quiet terminal or an empty log — a background process can look dead and not be, or look alive and actually be gone. If more than one `n8n start` shows up, kill both and start exactly one.

Two boot signals, not one: `/healthz` returns 200 fairly early, but n8n's SQLite database can still be initializing after that — the root path (`/`) returns `503 {"message":"Database is not ready!"}` until it's done. Treat root returning 200 as the real "fully up" signal if you need to be certain, not just healthz.

**How we build now:** build new n8n nodes manually in the GUI. Keep credentials encrypted in n8n and out of workflow JSON. Export the working workflow back to `workflows/` after a verified step. **After every edit, republish** or the change won't go live — see the active-version deviation below.

**To resume:** restart n8n + ngrok per above (URL is already correct, no Meta re-verify needed), rotate the exposed credentials, then pick up at **step 7** in `context/05`. The workflow, credentials, and Supabase data survive restarts.

## Current status

**All 10 steps are done and verified.** P1 is functionally complete: a text from the allowed handset reaches n8n over the Meta webhook, is logged, guarded, claimed for idempotency, answered by DeepSeek with bounded conversation context, delivered back over the Graph API, logged outbound, and the run closed out with token usage. Non-text input gets a fixed reply without touching DeepSeek, and DeepSeek/send/log failures mark the run `failed` with the error captured.

The workflow is 23 nodes, exported to `workflows/whatsapp-deepseek-assistant.json` (credential ids and names only — no secret material).

Known loose ends, none blocking:
- Several old `assistant_runs` rows sit at `status: claimed` with no completion. They are from runs that happened before `Complete run` existed; harmless historical noise, not a bug in the current chain.
- `META_APP_ID` and `META_APP_SECRET` are still empty in `.env`. `X-Hub-Signature-256` verification on the inbound webhook was never built — optional for P1, expected for P2.
- Credentials exposed during development were noted for rotation earlier in this file; that has not been done.

**Next action — resume mid-step-9, exactly here:**

- [x] `DeepSeek API` credential created — used n8n's **native `DeepSeek` credential type** (single `API Key` field), not `HTTP Header Auth` as `context/07` §1 originally said. Confirmed by reading the installed credential source (`DeepSeekApi.credentials.js`): its `authenticate` block is `type: 'generic'` setting `Authorization: Bearer {{apiKey}}` — mechanically identical to HTTP Header Auth, just one field instead of two, and n8n adds the `Bearer ` prefix for you. `context/07` §1 should be treated as superseded by this note. When building the `DeepSeek chat` HTTP Request node (§5), set Authentication → Predefined Credential Type → this credential.
- [x] `Allowed Sender` IF node (capital S — that's the real node name) — **built and verified.** Sits after `Respond OK (msg)`, not directly after `Log to Supabase`. Compares `={{ $('Edit Fields').item.json.from_number }}` (string equals) against Fixed-mode `<ALLOWED_NUMBER>`. **Not** `$json.from_number` — see the step-9 `$json` deviation below.
- [x] `text message` IF node (lowercase — real node name) — **built and verified.** On `Allowed Sender`'s true branch, compares `={{ $('Edit Fields').item.json.message_type }}` (string equals) against Fixed-mode `text`. Both guards proven by fake-payload executions 30 and 31: text payload → true/true, image payload → true/false. Executions 32/33 then proved the full chain through to `Load history` (`claimed: true`, 2 history rows returned) with the image payload still stopping at `text message` false. All fake rows were deleted from `messages` and `assistant_runs` afterwards.
- [x] `Claim assistant run` HTTP Request node — **built and verified.** `POST {SUPABASE_URL}/rest/v1/rpc/claim_assistant_run`, `supabaseApi` predefined credential "Supabase (messages)", JSON body with `p_inbound_wa_message_id` / `p_from_number` / `p_model: 'deepseek-v4-flash'` all read via `$('Edit Fields').item.json.*`. On `text message`'s true branch.
- [x] `Claim succeeded` IF node — **built and verified.** Boolean equals: `={{ $json.claimed }}` is `true`. `$json` is correct here because the RPC node directly precedes it and does return a body.
- [x] `text message` FALSE branch — **built and verified.** `Send text-only reply` (Meta send, fixed body `I currently support text messages only.`) → `Log text-only reply` (same outbound insert shape). DeepSeek is never called for non-text input, and no `assistant_runs` row is claimed on this path.
- [x] `Load history` HTTP Request node — **built and verified.** On `Claim succeeded`'s true branch. `GET {SUPABASE_URL}/rest/v1/messages`, `supabaseApi` credential, 5 query params: `select=direction,message_text,timestamp`, `from_number` = Expression `=eq.{{ $('Edit Fields').item.json.from_number }}`, `message_text=not.is.null`, `order=timestamp.desc`, `limit=10`. Only the `from_number` param is Expression mode; the other four are Fixed.
- [ ] `Claim succeeded` FALSE branch — nothing built (correctly returns nothing; `Respond OK (msg)` already answered).
- [x] `Build DeepSeek request` Code node — **built and verified.** Run Once for All Items. Reverses the `Load history` rows (Supabase returns newest-first, DeepSeek needs oldest-first), maps `direction: 'out'` → role `assistant` and anything else → role `user`, prepends a system prompt, and emits exactly one item: `{model, thinking:{type:'disabled'}, max_tokens:512, messages}`.
- [x] `DeepSeek chat` HTTP Request node — **built and verified.** `POST https://api.deepseek.com/chat/completions`, Authentication → Predefined Credential Type → `deepSeekApi` ("DeepSeek account"), JSON body Expression `={{ $json }}`. **Trap:** n8n's node search surfaces a **DeepSeek Chat Model** entry — that is a LangChain sub-node for the AI Agent system and cannot be used as a standalone step. Use a plain HTTP Request node.
- [x] `Send WhatsApp reply` HTTP Request node — **built and verified.** `POST https://graph.facebook.com/v25.0/{META_PHONE_NUMBER_ID}/messages`, Authentication → Generic Credential Type → Header Auth → `Meta WhatsApp`. JSON body Expression builds `{messaging_product:'whatsapp', to: $('Edit Fields').item.json.from_number, type:'text', text:{body: $('DeepSeek chat').item.json.choices[0].message.content}}`.
- [x] `Log outbound` HTTP Request node — **built and verified.** After `Send WhatsApp reply`. Same `on_conflict=wa_message_id` + `Prefer: resolution=ignore-duplicates` shape as `Log to Supabase`. Writes `direction: 'out'`, `message_text` from `$('DeepSeek chat')…choices[0].message.content`, `wa_message_id` from `$('Send WhatsApp reply').item.json.messages[0].id`, `timestamp: new Date().toISOString()`, and the full Meta send response as `raw_payload`. This is what gives DeepSeek memory of its own replies on the next turn.
- [x] `Complete run` HTTP Request node — **built and verified.** `PATCH {SUPABASE_URL}/rest/v1/assistant_runs?inbound_wa_message_id=eq.{{ $('Edit Fields').item.json.wa_message_id }}`, setting `status: 'completed'`, `outbound_wa_message_id`, the three DeepSeek `usage` token counts and `completed_at`. Must run **after** `Log outbound` — `assistant_runs.outbound_wa_message_id` is a foreign key onto `messages.wa_message_id`, so the outbound row has to exist first.
- [x] `Mark run failed` HTTP Request node — **built and verified.** `DeepSeek chat`, `Send WhatsApp reply` and `Log outbound` each have `onError: 'continueErrorOutput'`, and their second (error) output routes here. PATCHes the run to `status: 'failed'` with `error_code`, a 500-char-truncated `error_message` and `completed_at`. Proven by temporarily pointing the `DeepSeek chat` URL at a bad path: the run landed as `failed` / `NodeApiError` / "The resource you are requesting could not be found", and the URL was restored immediately after.
- Note: no extra Respond to Webhook nodes are needed on any of these branches — `Respond OK (msg)` fires earlier in the chain. See the step-9 Respond-node deviation below.

n8n and ngrok were both running locally at end of session but **will need restarting** — see "Resuming after a restart" above (use `n8n start`, not `npx n8n start`).

- [x] 1. Meta credentials verified in isolation — `scripts/01-verify-meta-credentials.js`. Permanent System User token confirmed (`expires_at: 0`).
- [x] 2. Supabase table created and test insert verified — `supabase/001_create_messages.sql` + `scripts/02-verify-supabase.js`. Both constraints confirmed firing.
- [x] 3. n8n instance live on a public HTTPS URL — self-hosted via `npx n8n` (localhost:5678) + ngrok tunnel. API key verified (GET /workflows → 200, empty array). ngrok URL is ephemeral; re-point on restart.
- [x] 4. Webhook GET verification handshake passing — built by hand in the n8n GUI (Ali is clicking nodes himself for this project rather than pushing workflow JSON). `whatsapp-echo-bot` workflow: Webhook (GET, path `whatsapp`, respond via node) → IF (checks `hub.mode == subscribe` AND `hub.verify_token == WEBHOOK_VERIFY_TOKEN`) → Respond to Webhook (200, body = `hub.challenge`) on true / Respond to Webhook (403, "Forbidden") on false. Curl-tested locally and via the ngrok URL before pointing Meta at it. Meta dashboard shows "Configure Webhooks" verified (green check), and `messages` field is confirmed subscribed (had to check manually — Meta auto-subscribes several other fields like `account_update`/`calls` but not `messages` by default, matching the known trap in `context/02` §4).
- [x] 5. POST handler parsing inbound messages — **done.** POST branch: `Webhook1` (POST, path `whatsapp`) → `If1` (guard: `messages` is a non-empty array, AND of the two conditions) → true: `Edit Fields` (5 fields) → `Respond OK (msg)` (200, `OK`); false: `Respond OK (status)` (200, `OK`). The two `Respond OK` nodes and the final expression cleanup were pushed via the n8n REST API (`scripts/`-style patch), not the GUI — the GUI got us the nodes, the API finished the wiring. Verified with `scripts/03-post-fake-payload.js`: text payload parses all 5 fields clean (`from_number` `447700900123`, `message_type` `text`, etc.); status payload terminates at `If1` false without touching Edit Fields and returns 200; image payload yields `message_text: null` + `message_type: image` with no crash (the `?.` guard). Field expressions confirmed by reading them back out of the workflow JSON and out of the execution `runData`, not just eyeballing the canvas.
- [x] 6. Supabase logging on inbound — **done.** Chain is now `Edit Fields → Log to Supabase → Respond OK (msg)`. **Not** built with the dedicated Supabase node — that node's "Create a row" op is a plain insert with no upsert/on-conflict option, so it hard-errored on a duplicate `wa_message_id`. Replaced it with an **HTTP Request** node hitting `POST {SUPABASE_URL}/rest/v1/messages?on_conflict=wa_message_id` with `Prefer: resolution=ignore-duplicates` (the exact call proven in `scripts/02`), authed via the `supabaseApi` predefined-credential-type so the service key stays out of the workflow JSON. Node name: `Log to Supabase`. All 6 columns populated: `from_number`, `message_text`, `direction='in'`, `wa_message_id`, `timestamp` (Unix-sec×1000→ISO), `raw_payload` (full webhook body as real jsonb). Verified by querying Supabase directly: running the fake-payload script twice → exactly 2 rows (text + image), the status ping made 0 rows, the duplicate second run was silently ignored, and `raw_payload` is a real JSON object (see step-6 deviation for the bug that nearly broke this). See `docs/LESSONS-LEARNED.md` for full detail.
- [x] 7. DeepSeek verified in isolation — `scripts/04-verify-deepseek.js` returned HTTP 200 with `deepseek-v4-flash`.
- [x] 8. Apply and verify `assistant_runs` manually in Supabase — SQL from `supabase/002_create_assistant_runs.sql` applied. Verified live: `assistant_runs` reachable via service_role Data API (empty, as expected); `claim_assistant_run()` RPC claims on first call and correctly returns `claimed:false` on a duplicate `inbound_wa_message_id`; `anon`/`authenticated` lockout confirmed structurally via the `revoke all` grants in the SQL (didn't have the anon key handy to double-check live).
- [x] 9. Build the manual DeepSeek branch and outbound logging in n8n — **done.** 23 nodes. The full inbound → DeepSeek → outbound chain works end to end: executions 37 and 40 were real messages from the handset that got real DeepSeek answers delivered back with valid wamids. Execution 44 then proved the complete path including bookkeeping (outbound row logged, run `completed` with usage 40/2/42), execution 45 proved the non-text branch, and a deliberately-broken DeepSeek URL proved the failure path. All synthetic test rows were deleted from `messages` and `assistant_runs` afterwards; only real handset traffic remains.
- [x] 10. Full end-to-end test from my phone — **done, both directions.** A real text from the allowed handset got a real DeepSeek answer delivered back, and a follow-up question ("what did we say 2 sentences ago") was answered from stored history, proving `Log outbound` → `Load history` actually closes the memory loop over the live path. A real image got the fixed `I currently support text messages only.` reply. The run landed as `completed` with 67 total tokens. Caveat worth remembering: that first recall answer was partly confabulated, because outbound logging only went live at the end of step 9 — the rows from earlier sessions are user-side only, so DeepSeek had no record of its own older turns to recall. Conversations from this point forward have genuine two-sided history. Original inbound-only note kept below for the `subscribed_apps` fix that made it work:
- [x] 10a. (inbound half, fixed earlier): a real text from the allowed phone, double-checkmark delivered, was confirmed logged into `messages` via the actual Meta→ngrok→n8n→Supabase path (not the fake-payload script) after fixing the `subscribed_apps` gap below. Outbound/DeepSeek reply half still blocked on step 9.

**Claude Code: update this checklist as we complete steps.** Tick the box and add a one-line note about anything that differed from the docs — that note is what makes the docs accurate for P2.

### Deviations log

- **Step 1:** A free-form text send to a user who has NOT messaged the test number first returns HTTP 200 with a valid wamid but is **silently not delivered** — no error 131047 as `context/02` §7 implies. Fix: the recipient must text the test number first to open the 24-hour window; then free-form sends deliver. The dashboard "test" button works regardless because it sends an approved template. This is the 24-hour-window rule biting in practice, and matters directly for P2 (which must open with a template).
- **Step 2:** Duplicate-delivery dedup over the Supabase REST API needs BOTH `Prefer: resolution=ignore-duplicates` AND the `on_conflict=wa_message_id` query param. The Prefer header alone does nothing — a duplicate POST just 409s. The n8n insert node in step 6 must set the on_conflict target, not just the ignore preference.
- **Step 4:** Webhook config now lives under App Dashboard > Use cases > Connect on WhatsApp > Step 2. Production setup > Configure Webhooks — not a standalone "Configuration"/"Webhooks" sidebar item as `context/02` §4 implies. Also, Meta auto-subscribes several webhook fields on save (`account_update`, `account_review_update`, `calls`, `message_template_quality_update`) but **not** `messages` — that one had to be checked/enabled manually. `curl`'s non-browser user-agent skips the ngrok free-tier interstitial warning page automatically, so no interference there.
- **Step 5 — n8n "active version" vs draft (big one, will bite every GUI edit):** this n8n build separates the *working draft* from the *published/active version*. Editing nodes in the GUI (or `PUT`-ing via the API) updates the draft, but the live production webhook keeps serving the last **activated** version until you republish. Symptom: the POST webhook 404'd with "not registered for POST requests" even though the POST node was clearly on the canvas — because the active version predated it. Fix: after any node change, republish — GUI Publish/toggle Active off→on, or via API `POST /workflows/{id}/deactivate` then `/activate`. Confirm it took by checking `versionId === activeVersionId` on `GET /workflows/{id}`.
- **Step 5 — invisible junk in Set-node expression fields:** a Set/`Edit Fields` field can carry a stray leading space or a pasted box-drawing char (`│`) in its **name or value** that is invisible on the canvas but real in the stored JSON — it corrupted a field name to `" from_number"` and a value to `" 447700900123"`. Only caught by pulling the workflow JSON (`GET /workflows/{id}`) and reading the raw `assignments`, and by inspecting the execution `runData`. Lesson: verify parsed fields from the execution data, not by looking at the node. Also n8n re-normalizes expressions on save (re-inserts a space after `=` in some cases) — harmless, but don't be surprised the stored string isn't byte-identical to what you pushed.
- **Step 5 — Respond-node requirement:** a Webhook node set to "respond via node" (`responseMode: responseNode`) throws HTTP 500 "No Respond to Webhook node found in the workflow" and does **not** execute at all if the branch it takes has no `Respond to Webhook` node downstream. Both branches (message and status) need their own responder. This is stricter than a hang/timeout — it's an upfront refusal to run.
- **Step 10 (first real-phone test) — a permanent-token setup never subscribes the app to the WABA, so real messages silently never reach the webhook.** Callback URL verified, `messages` field subscribed, token valid, and Meta's own dashboard "Test" button returned 200 through the whole n8n chain — all looked correct. But a real text, confirmed double-checkmark delivered by WhatsApp, never hit ngrok at all. Cause: `GET /{WABA_ID}/subscribed_apps` only listed Meta's internal test app, never this project's app — the guided Embedded Signup flow calls that endpoint automatically, a manual System User token setup doesn't, and there's no dashboard button for it. Fix was one call: `POST /{WABA_ID}/subscribed_apps` with the permanent token. Real messages started arriving within seconds. The dashboard's Test button is not a reliable signal for this — it bypasses the real WABA delivery path entirely. Full write-up in `docs/LESSONS-LEARNED.md` #7; matters directly for P2 if that number is also set up by hand.
- **Restart procedure — `npx n8n start` is unreliable; switched to a global install.** `npx n8n` re-resolves n8n's full dependency tree (huge — it now bundles a LangChain/AI-SDK toolkit for dozens of providers) from the npm registry on every restart. Hit `npm error ETARGET: No matching version found` for two different `@aws-sdk/*` subpackages back to back — in both cases the "missing" version was actually the latest one published, meaning it was stale local npm cache metadata, not a real unavailable version. Fixed with `npm cache clean --force`, then switched to `npm install -g n8n@2.32.7` (pinned, not `latest` — `latest` at the time had its own unrelated broken dependency pin) so restarts just run already-installed code via `n8n start` instead of re-resolving anything. See updated "Resuming after a restart" section above.
- **Step 6 — the dedicated Supabase node can't dedup; the `= {{` space bug corrupts objects.** Two things bit here. (1) The built-in Supabase node's "Create a row" op is a plain insert with no on-conflict/upsert option anywhere in its UI, so a duplicate `wa_message_id` throws a real Postgres unique-constraint error and fails the execution. Fix: use an HTTP Request node against the Supabase REST API directly with the `on_conflict` + `Prefer` combo from the step-2 deviation. (2) Same invisible-space bug as step 5, but this time destructive: a value typed as `= {{ expr }}` (space after `=`) instead of `={{ expr }}` makes n8n treat it as a **string template** rather than a pure expression. For a string that just adds a leading space; for an **object** (`raw_payload`) it stringifies to the literal `"[object Object]"` — the entire JSON payload silently replaced by junk, no error. Rule: for any field meant to carry a non-string (object/number), the expression must be exactly `={{ ... }}` with no leading space, and you must verify what actually landed in the DB, not just that the insert returned 200. Full write-up in `docs/LESSONS-LEARNED.md`.
- **Step 9 — a leading `=` you didn't type means the field is in Expression mode, not that you typo'd.** The `text message` IF node's right-hand value kept saving as `"=text "` no matter how many times it was retyped as plain `text`. Cause: that parameter field was toggled to **Expression** mode (small `fx` badge on its left edge), and n8n *always* stores expression-mode fields with a leading `=` — it's the mode marker, not user input. Retyping the value can never remove it. Fix: hover the field, click **Fixed** on the Fixed|Expression toggle; the `fx` badge disappears and the value stores as a bare literal. Rule: a comparison's **left** side normally wants Expression mode (`={{ $json.foo }}`), its **right** side wants Fixed mode when comparing to a constant. Diagnose by pulling `GET /workflows/{id}` and reading `rightValue` — the canvas shows the *rendered* value and hides the mode entirely. Related but distinct from the step-5/6 whitespace bugs: same symptom class (stored JSON ≠ what you see), different cause.
- **Step 9 — an HTTP node in the chain wipes `$json`; reach back with `$('Node Name')`.** `Log to Supabase` sends `Prefer: resolution=ignore-duplicates` with no `return=representation`, so Supabase replies 201 with an **empty body** — the HTTP Request node emits `{}` and `Respond OK (msg)` passes that empty object along. Confirmed in execution 29 (real phone message): `Edit Fields` emitted all five parsed fields, `Log to Supabase` and `Respond OK (msg)` both emitted `{}`. The `Allowed Sender` and `text message` guards were originally written against `$json.from_number` / `$json.message_type`, so they'd have compared `undefined` every time and silently never fired true. Fix: both now use `$('Edit Fields').item.json.*`. Rule: `$json` means only "what the immediately-previous node emitted" — once a chain passes through an HTTP node the parsed fields are gone, so always reach back by node name. `Log to Supabase` already did this correctly for `raw_payload` via `$('Webhook1').item.json.body`. Full write-up in `docs/LESSONS-LEARNED.md` #9.
- **Step 9 — the Respond node fires early, so downstream branches don't each need one.** `context/07` §2 says every terminal branch must reach a Respond to Webhook node. As actually built, `Respond OK (msg)` sits **before** `Allowed Sender`, so Meta's HTTP 200 is already sent before any assistant logic runs. Consequence: `Allowed Sender` false, `text message` false, `Claim succeeded` false and the whole DeepSeek path need no responder of their own. Deliberate deviation from the §2 diagram, and the better shape — Meta gets its 200 fast regardless of how slow DeepSeek is. The step-5 responder rule is still satisfied, by that one early node covering the entire message branch.

- **Step 9 — an n8n credential can be silently wrong while the token is perfectly fine.** `Send WhatsApp reply` failed with n8n's generic `Authorization failed - please check your credentials` / `Authentication Error`. The token was not the problem: `GET /v25.0/{PHONE_NUMBER_ID}` with `Authorization: Bearer $META_ACCESS_TOKEN` returned the number's profile, and `debug_token` reported `is_valid: true`, `expires_at: 0`, scopes `whatsapp_business_management, whatsapp_business_messaging`. The fault was the value stored inside the n8n Header Auth credential (a truncated paste / missing `Bearer ` prefix — unverifiable after the fact because n8n encrypts credential values and the public API never returns them). Fix: create the credential programmatically instead of by hand — `POST /api/v1/credentials` with `{name, type:'httpHeaderAuth', data:{name:'Authorization', value:'Bearer '+token}}`, reading the token straight out of `.env` so no human paste is involved, then repoint the node's `credentials` block at the new id. Lesson: when a node reports an auth failure, prove the credential *material* independently with curl before touching anything else — n8n cannot tell you what it actually stored.
- **Step 9 — n8n's node picker offers `DeepSeek Chat Model`, which is the wrong node.** Searching "deepseek" in the *What happens next?* panel returns a LangChain sub-node meant to be attached to an AI Agent node, not a standalone step in a normal chain. The DeepSeek call in this build is a plain **HTTP Request** node; the DeepSeek credential is selected *inside* it via Predefined Credential Type. Same applies to any other provider entry in that list.
- **P2 (Shopify), local-service recovery — a "dead" restart can leave a zombie process, and starting a second n8n silently produces two.** `ERR_NGROK_3200` on the Shopify app URL recurred even after ngrok was confirmed up. Cause: an n8n restart attempt backgrounded with `nohup ... & disown` appeared to die (empty log, no process a few minutes later), so a second `n8n start` was launched — but the first one turned out to still be alive, and now two processes were fighting over port 5678. `ps aux` in the git-bash tool didn't clearly show either as `n8n` (both show up as bare `node`); `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"` in PowerShell is what actually revealed the full command lines and the duplicate. Fix was killing both and starting exactly one, launched via a PowerShell wrapper since `n8n` resolves to a `.ps1` shim that `Start-Process -FilePath n8n` can't execute directly. Rule now baked into "Resuming after a restart" above: check for existing node processes before restarting, don't trust a quiet log as proof of death.
- **P2 (Shopify) — `/healthz` returning 200 doesn't mean n8n is fully up.** Right after boot, n8n's root path (`/`) can still return `503 {"message":"Database is not ready!"}` for a bit while SQLite finishes initializing, even though `/healthz` already reports 200. If something downstream (like confirming a public URL works end-to-end) needs n8n actually serving, poll root, not just healthz.
- **P2 (Shopify) — inspecting process command lines can print secrets in plaintext.** `Get-CimInstance Win32_Process` returning full `CommandLine` values will surface any secret passed as a CLI arg — happened here with `NGROK_AUTHTOKEN` (ngrok is started as `ngrok http 5678 --authtoken <token>`). Not a repo/commit leak, but it did land in a terminal session, so that token should get rotated in the ngrok dashboard next time it's convenient.
