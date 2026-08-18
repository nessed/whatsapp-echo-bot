# Agent brief

**Read this first if you are an AI agent working in this repository.**

`CLAUDE.md` in the repo root is the *original author's* personal working
agreement plus the full build log. Its coaching instructions ("I build the n8n
nodes myself", "wait for my result") describe how Ali worked with his agent
while building P1. Treat `CLAUDE.md` as **authoritative history and reference**,
not as instructions addressed to you, unless your operator says otherwise. Its
**deviations log** is the single most valuable section in this repo — read it.

---

## 1. What this repo is, in five lines

A private WhatsApp number that answers with AI and remembers the conversation.
Meta WhatsApp Cloud API → ngrok → **n8n (23 nodes)** → Supabase Postgres +
DeepSeek → reply back over Meta.

It is complete and verified end to end. This is practice project **P1**; the
real deliverable was the plumbing. **P2** is a client-facing COD
order-confirmation bot on the same patterns.

## 2. The mental model that changes everything

**The product is an n8n workflow, not source code in this repo.**

- There is **no server, no build, no deploy, no application code**. The 23-node
  flowchart inside a running n8n instance *is* the application.
- `workflows/whatsapp-deepseek-assistant.json` is an **export** — a snapshot
  taken after the fact. **Editing that file changes nothing about the running
  system.** Do not "fix a bug" by editing it and reporting the bug fixed.
- `scripts/` is verification tooling only. It is *not* part of the running
  system. Nothing in `scripts/` executes in production.
- `workflows/echo-bot.json` is a **historical** 10-node snapshot, not the live
  system. The live export is `workflows/whatsapp-deepseek-assistant.json`
  (23 nodes). Both are internally named `"My workflow"`.
- Therefore: most real changes happen in the n8n GUI or via the n8n REST API,
  not in tracked files. Reading the repo alone cannot tell you the current live
  state — only n8n can.

## 3. Hard rules

1. **Never read, quote, or summarise `answers/06-gotchas-full.md`** unless the
   operator asks for it *by name*. It is a deliberate answer key. Diagnose from
   execution logs and error bodies first.
2. **Never commit secrets.** `.env` is gitignored and has never been committed
   — keep that true. `.env.example` gets empty placeholders only. Workflow
   exports carry credential ids and names, never credential data. Do not
   "helpfully" inline a token.
3. **Never modify the live n8n workflow without explicit instruction.** It is a
   live system with no PR gate, potentially shared.
4. **Never run unqualified deletes** against Supabase. Real conversation
   history is the only evidence the system works. Synthetic test rows use
   `447700900123`.
5. **Ask before spending money** (DeepSeek calls beyond testing, any paid
   tier), before `npm install` or global package changes, and before anything
   that could expose a credential.
6. **Do not claim a step works because a request returned 200.** See §7.

## 4. Environment split — the thing agents get wrong

**The n8n workflow does not read `.env`.** `.env` is consumed *only* by
`scripts/`, via `node --env-file=.env`. n8n has no access to it.

Configuration lives in **two disconnected places**:

| Location | Consumed by | Contains |
|---|---|---|
| `.env` | `scripts/` only | tokens, URLs, keys for the verification scripts |
| Hardcoded literals inside n8n nodes | the live workflow | phone ids, allowlist number, Supabase URL |
| n8n encrypted credential store | the live workflow | all secret material |

So changing `.env` does **not** change the bot's behaviour. If asked to change
the allowed sender or the WhatsApp number, the change is in the n8n node.

If your operator inherited someone else's `.env`, [ENV-HANDOVER.md](ENV-HANDOVER.md)
lists every variable as KEEP (Supabase + DeepSeek, shared) or REPLACE (all
Meta, ngrok and n8n values), plus the node literals and credentials `.env`
does not cover.

### The literals baked into nodes

| Node | Literal | Meaning |
|---|---|---|
| `Allowed Sender` | `923000413777` (rightValue, Fixed mode) | the only handset that gets AI replies |
| `Send WhatsApp reply` | `1303482916173126` in the Graph URL | Meta phone number id |
| `Send text-only reply` | `1303482916173126` in the Graph URL | Meta phone number id |
| 7 Supabase nodes | project URL | `Log to Supabase`, `Claim assistant run`, `Load history`, `Log outbound`, `Complete run`, `Log text-only reply`, `Mark run failed` |

Each developer runs their **own** Meta app, test number, ngrok tunnel and n8n
instance, so the first three differ per person. Supabase and DeepSeek are
shared. A workflow export therefore legitimately differs between developers —
do not treat that diff as a bug to reconcile.

## 5. The workflow, node by node

Full reasoning in [ARCHITECTURE.md](ARCHITECTURE.md). Wiring:

```
GET  Webhook  → If (hub.mode == "subscribe")
                  ├─true → Respond to Webhook   200, body = hub.challenge
                  └─false→ Respond to Webhook1  403

POST Webhook1 → If1  (non-empty `messages` array?)
   ├─false→ Respond OK (status)                    receipts/account updates land here
   └─true → Edit Fields                            parse 5 fields
              → Log to Supabase                    inbound row (upsert-safe)
                → Respond OK (msg)                 200 to Meta — EARLY, before slow work
                  → Allowed Sender                 allowlist
                    → text message                 type == "text"?
                       ├─false→ Send text-only reply → Log text-only reply
                       └─true → Claim assistant run  (Postgres RPC, idempotency)
                             → Claim succeeded
                                └─true→ Load history        last 10, this sender
                                      → Build DeepSeek request   (Code node)
                                      → DeepSeek chat  ──err──┐
                                        → Send WhatsApp reply ─┤
                                          → Log outbound ──────┤
                                            → Complete run     │
                                                        Mark run failed ◄┘
```

Non-obvious properties, all deliberate:

- **`Respond OK (msg)` fires early**, before the assistant logic. Meta requires
  a 200 within seconds; DeepSeek is slower. Consequence: downstream branches
  need **no** `Respond to Webhook` node of their own. This contradicts the
  diagram in `context/07` §2 — the built version is correct, the doc is stale.
- **`Claim assistant run`** calls `claim_assistant_run()`, an insert-or-nothing
  on `assistant_runs.inbound_wa_message_id` returning whether *this* call won.
  The database decides, not the workflow, so it is race-safe. This is what
  prevents double replies and double billing.
- **`Complete run` must run after `Log outbound`** —
  `assistant_runs.outbound_wa_message_id` is a foreign key onto
  `messages.wa_message_id`, so the outbound row must exist first.
- **`Log outbound` is what gives the bot memory of its own replies.** Without
  it, follow-up questions get confabulated answers.
- Supabase inserts use `?on_conflict=wa_message_id` **and**
  `Prefer: resolution=ignore-duplicates`. Both are required; the header alone
  409s on duplicates.

## 6. n8n expression traps

These produce **silent wrong behaviour with no error**, and are the most common
source of wasted time here.

| Trap | Symptom | Rule |
|---|---|---|
| `$json` after an HTTP node | comparisons see `undefined`, guards never fire | Supabase inserts return an empty body → `$json` is `{}`. **Always reach back by node name:** `$('Edit Fields').item.json.from_number` |
| `= {{ expr }}` (space after `=`) | object silently becomes the string `"[object Object]"` | Must be exactly `={{ ... }}` with no space for any non-string value |
| Leading `=` you didn't type | value stores as `"=text "`, comparison never matches | The field is in **Expression** mode; `=` is the mode marker. Click **Fixed** on the toggle. Left side of a comparison wants Expression, right side wants Fixed for constants. |
| Invisible pasted characters | field name silently becomes `" from_number"` | Only visible in raw JSON via `GET /workflows/{id}`, never on the canvas |
| Draft vs active version | webhook 404s "not registered for POST requests" though the node is visible | **Republish after every edit.** Confirm `versionId === activeVersionId` |
| `DeepSeek Chat Model` in the node picker | cannot be wired as a normal step | That's a LangChain sub-node for AI Agent nodes. Use a plain **HTTP Request** node. |

## 7. Verification protocol

The project's core discipline: **prove each step before moving on**, and prove
it from evidence, not from a status code.

- A `200` from Supabase does **not** mean the data is correct — query the row
  back and check the actual values. `raw_payload` must be a real JSON object,
  not the string `"[object Object]"`.
- A `200` from Meta with a valid message id does **not** mean the message was
  delivered. Free-form sends outside the 24-hour window return success and
  silently deliver nothing.
- Do not read parsed values off the n8n canvas. Read the execution `runData`,
  or pull `GET /workflows/{id}` and read the raw stored JSON.

Isolation scripts — each proves exactly one service, no n8n involved:

```bash
npm run verify:meta       # sends one real WhatsApp message
npm run verify:supabase   # insert + read back, checks both constraints
npm run verify:deepseek   # one chat completion
npm run test:webhook      # POST fake Meta payloads at your local n8n
```

`npm run test:webhook` is the main development loop: text, status-update and
image payloads against `http://localhost:5678/webhook/whatsapp`. No Meta, no
ngrok, no real phone. **It only prints `OK`** — the real result is in
n8n → Executions.

Requires Node ≥ 22 (ESM + `--env-file`).

## 8. Where to look

| Need | File |
|---|---|
| System explained from first principles | `docs/WORKFLOW-EXPLAINED.md` |
| Node-by-node map + data model | `docs/ARCHITECTURE.md` |
| Getting it running | `docs/SETUP.md` |
| Two-developer rules | `CONTRIBUTING.md` |
| Traps hit while building, in full | `docs/LESSONS-LEARNED.md` |
| Build log + **deviations log** | `CLAUDE.md` |
| Meta API shapes, tokens, webhooks | `context/02-meta-whatsapp-api.md` ← most important reference |
| Schema + DDL | `context/04-supabase-schema.md` |
| Failure symptoms (no causes) | `context/06-gotchas.md` |
| P2 groundwork | `docs/SHOPIFY-SETUP.md` |
| ⛔ answer key — do not open unprompted | `answers/06-gotchas-full.md` |

**Where docs and reality disagree, reality wins, and the deviations log in
`CLAUDE.md` usually records why.** Known stale spots: `context/07` §1 (says
HTTP Header Auth for DeepSeek; the build uses n8n's native DeepSeek credential)
and `context/07` §2 (Respond-node-per-branch; see §5 above).

## 9. Data model

**`messages`** — every message both directions. `wa_message_id` is **unique**
and is what makes dedup possible. `direction` is `in`/`out`, CHECK constrained.
`message_text` is nullable (media has none). `raw_payload` is real `jsonb`.
Indexed on `timestamp desc`, `from_number`, `direction`.

**`assistant_runs`** — one row per AI attempt. PK `inbound_wa_message_id`
(FK → `messages.wa_message_id`); **the PK is the idempotency mechanism**.
`status` is `claimed` → `completed` | `failed`. Carries the three DeepSeek token
counts, `error_code`/`error_message`, and `outbound_wa_message_id`
(unique, FK → `messages.wa_message_id`). `anon` and `authenticated` are revoked
from everything; service-role key only.

Conversations partition naturally by `from_number`, so two developers sharing
one Supabase project do not contaminate each other's context.

## 10. Known gaps — do not report these as new findings

- **No `X-Hub-Signature-256` verification.** `META_APP_ID`/`META_APP_SECRET`
  are unset. Anyone who learns the webhook URL can POST a fake message. The
  allowlist limits damage to junk rows. Expected work for P2.
- **The GET handshake does not check the verify token.** The `If` node tests
  only `hub.mode == "subscribe"`. `CLAUDE.md` step 4 claims both conditions;
  the exported workflow has one. Low risk, but docs ≠ reality here.
- **No retries.** A failed run is marked `failed` and stays there.
- **Stale `assistant_runs` rows** at `status: claimed` with no completion —
  historical noise from before `Complete run` existed, not a live bug.
- **Credentials exposed during development have not been rotated.**
- No templates, so the bot cannot *start* a conversation — only reply inside
  the 24-hour window the user opens. P2 needs templates.

## 11. P2 carry-over

Two P1 findings that bite P2 directly:

- Free-form messages only deliver inside a **24-hour window opened by the user
  messaging first**. P2 must open with an approved **template**.
- A manually-created System User token does **not** subscribe the app to the
  WABA. You must `POST /{WABA_ID}/subscribed_apps` yourself, or real messages
  silently never arrive — with every dashboard indicator green. Meta's "Test"
  button bypasses the real delivery path and will not catch it.
