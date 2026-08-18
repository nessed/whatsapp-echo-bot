# Architecture

A map of the live system: every node, what it does, and why it's there.

This is the **reference**. If you want the concepts explained from scratch —
what a webhook is, why idempotency matters, how the context window works — read
[WORKFLOW-EXPLAINED.md](WORKFLOW-EXPLAINED.md) first. This document assumes you
already know.

---

## The shape of it

```
   handset                Meta Cloud API              your laptop
  ┌────────┐              ┌────────────┐         ┌──────────────────┐
  │WhatsApp│──message────►│  WABA +    │──POST──►│ ngrok ──► n8n    │
  │        │◄──reply──────│  test num  │◄─POST───│   (23 nodes)     │
  └────────┘              └────────────┘         └────────┬─────────┘
                                                          │
                                              ┌───────────┴───────────┐
                                              ▼                       ▼
                                        ┌──────────┐          ┌────────────┐
                                        │ Supabase │          │  DeepSeek  │
                                        │ Postgres │          │ v4-flash   │
                                        └──────────┘          └────────────┘
```

Everything runs on one laptop except Supabase, DeepSeek and Meta. There is no
deployed application — n8n *is* the application.

---

## Two webhooks on one path

Both use the path `/webhook/whatsapp`, distinguished by HTTP method.

### GET — Meta's verification handshake

Meta calls this once when you save the webhook config, to prove you own the URL.

```
Webhook (GET)
   └─► If  (hub.mode == "subscribe" AND hub.verify_token == WEBHOOK_VERIFY_TOKEN)
         ├─true──► Respond to Webhook    200, body = hub.challenge
         └─false─► Respond to Webhook1   403, "Forbidden"
```

Echoing `hub.challenge` back is the entire protocol. Get it wrong and Meta
refuses to save the URL.

### POST — the actual message pipeline

```
Webhook1 (POST)
   └─► If1                          is there a non-empty `messages` array?
         ├─false─► Respond OK (status)          200 — delivery/read receipt, ignore
         └─true──► Edit Fields                  parse 5 fields out of Meta's nesting
                     └─► Log to Supabase        inbound row, upsert-safe
                           └─► Respond OK (msg) 200 to Meta ◄── EARLY, see note
                                 └─► Allowed Sender          allowlist check
                                       └─► text message      is it type "text"?
                                             ├─false─► Send text-only reply
                                             │            └─► Log text-only reply
                                             └─true──► Claim assistant run   (RPC)
                                                   └─► Claim succeeded
                                                         └─true─► Load history
                                                               └─► Build DeepSeek request
                                                                     └─► DeepSeek chat ──┐
                                                                           └─► Send WhatsApp reply ──┐
                                                                                 └─► Log outbound ──┐ │
                                                                                       └─► Complete run
                                                                                                  │ │ │
                                        error outputs of those three ─────────────────────────────┴─┴─┴──► Mark run failed
```

---

## Why each node exists

Every guard here was earned by a real failure mode.

### `If1` — most inbound webhook traffic isn't a message
Meta POSTs delivery receipts, read receipts and account updates to the same
URL. Only some of them carry a `messages` array. Without this check the parser
would run on payloads that have no message in them.

### `Edit Fields` — flattening Meta's nesting
Pulls out five fields: `from_number`, `message_text`, `message_type`,
`wa_message_id`, `timestamp`. The message body is buried several levels deep,
and `message_text` uses optional chaining (`text?.body`) so an image message
yields `null` instead of crashing.

### `Log to Supabase` — before anything can fail
Logs the inbound message first, so you have a record even if everything
downstream breaks.

This is an **HTTP Request** node, not n8n's built-in Supabase node. The built-in
node's "Create a row" operation is a plain insert with no upsert option
anywhere in its UI, so a duplicate `wa_message_id` throws a hard Postgres
unique-constraint error and kills the execution. Instead:

```
POST {SUPABASE_URL}/rest/v1/messages?on_conflict=wa_message_id
Prefer: resolution=ignore-duplicates
```

**Both parts are required.** The `Prefer` header alone does nothing — a
duplicate just 409s. You need the `on_conflict` query param naming the target
column as well.

### `Respond OK (msg)` — answering Meta before doing the slow work
Meta wants a 200 within seconds and retries if it doesn't get one. DeepSeek
takes longer than that. So the response is sent **here**, early, and all the
assistant logic runs afterwards.

Consequence worth knowing: none of the downstream branches need a
`Respond to Webhook` node of their own — this one already covered the whole
message branch. That's a deliberate deviation from the diagram in
`context/07` §2, and it's the better shape.

### `Allowed Sender` — this bot is private
Compares against a single hardcoded number. Anyone else's message is logged and
then dropped. Not security (there's no signature verification yet) but it does
stop a stranger who finds the webhook URL from spending your DeepSeek credit.

### `text message` — DeepSeek can't read images
Non-text input gets a fixed reply and never reaches the model:
`Send text-only reply` → `Log text-only reply`. No run is claimed, no tokens
spent.

### `Claim assistant run` — idempotency, the real one
Calls the `claim_assistant_run()` Postgres function. It attempts an insert into
`assistant_runs` keyed on `inbound_wa_message_id` with `on conflict do nothing`,
and returns whether *this* call was the one that inserted.

First delivery → `claimed: true` → continue. Duplicate delivery → `claimed:
false` → stop. This is what stops one message getting two answers and being
paid for twice.

The database does the deciding, not the workflow, so it's still correct if two
deliveries arrive at the same instant.

### `Load history` — bounded memory
```
GET {SUPABASE_URL}/rest/v1/messages
  ?select=direction,message_text,timestamp
  &from_number=eq.<sender>
  &message_text=not.is.null
  &order=timestamp.desc
  &limit=10
```
Ten messages. Not "the whole conversation" — you pay per token and there's a
size limit.

### `Build DeepSeek request` — a Code node
Supabase returns newest-first; DeepSeek needs oldest-first, so it reverses.
Maps `direction: 'out'` → role `assistant`, anything else → role `user`,
prepends a system prompt, and emits one item:
`{model, thinking: {type: 'disabled'}, max_tokens: 512, messages}`.

### `DeepSeek chat` — a plain HTTP Request node
`POST https://api.deepseek.com/chat/completions`, authenticated via n8n's
native DeepSeek credential type.

> **Trap:** searching "deepseek" in n8n's node picker surfaces
> **DeepSeek Chat Model**. That is a LangChain sub-node meant to attach to an
> AI Agent node — it cannot be used as a standalone step. Same applies to the
> other provider entries in that list. Use a plain HTTP Request node.

### `Send WhatsApp reply`
`POST https://graph.facebook.com/v25.0/{PHONE_NUMBER_ID}/messages` with a
`Meta WhatsApp` Header Auth credential.

### `Log outbound` — this is what gives the bot memory
Same upsert shape as the inbound log, writing `direction: 'out'`. Without this
node the bot would remember what *you* said but have no record of its own
replies, and follow-up questions would get confabulated answers.

### `Complete run` — bookkeeping, and it must run last
PATCHes the run to `status: 'completed'` with the outbound message id and
DeepSeek's three token counts.

**Order matters:** `assistant_runs.outbound_wa_message_id` is a foreign key onto
`messages.wa_message_id`, so the outbound row has to exist before this runs.
That's why it sits after `Log outbound`, not in parallel.

### `Mark run failed` — knowing which half broke
`DeepSeek chat`, `Send WhatsApp reply` and `Log outbound` each have
`onError: 'continueErrorOutput'`, and their error outputs all route here. It
PATCHes the run to `status: 'failed'` with the error code and a 500-char
truncated message.

So every claimed run ends up either `completed` or `failed` — never silently
abandoned.

---

## Data model

### `messages` — every message, both directions

| Column | Notes |
|---|---|
| `id` | identity PK |
| `from_number` | the human's number in both directions (conversation key) |
| `message_text` | nullable — media messages have no text |
| `direction` | `in` or `out`, CHECK constrained |
| `wa_message_id` | **unique** — this is what makes dedup possible |
| `timestamp` | timestamptz; Meta sends Unix seconds, converted on the way in |
| `raw_payload` | full webhook body as real `jsonb`, for forensics |
| `created_at` | default `now()` |

Indexed on `timestamp desc`, `from_number`, `direction` — matching the
`Load history` query.

> `raw_payload` must be inserted as an object, not a string. See the
> `= {{` trap in [LESSONS-LEARNED.md](LESSONS-LEARNED.md) — it silently stores
> the literal text `"[object Object]"` with no error.

### `assistant_runs` — one row per AI attempt

| Column | Notes |
|---|---|
| `inbound_wa_message_id` | **PK**, FK → `messages.wa_message_id`. The PK *is* the idempotency mechanism. |
| `from_number`, `model` | who and which model |
| `status` | `claimed` → `completed` \| `failed`, CHECK constrained |
| `prompt_tokens`, `completion_tokens`, `total_tokens` | cost accounting, non-negative CHECK |
| `error_code`, `error_message` | populated on the failure path |
| `outbound_wa_message_id` | unique, FK → `messages.wa_message_id` |
| `created_at`, `completed_at` | |

`anon` and `authenticated` are revoked from everything here. Only the
service-role key reaches this table.

### `claim_assistant_run(p_inbound_wa_message_id, p_from_number, p_model)`

Insert-or-nothing on the primary key, returning whether this caller won. One
round trip, atomic, no read-then-write race.

---

## What isn't built

- **No `X-Hub-Signature-256` verification.** Meta signs every webhook with your
  app secret; this workflow doesn't check it. Anyone who learns the URL can POST
  a fake message. The sender allowlist limits the damage to junk rows in
  `messages`. Expected for P2.
- **No retries.** A failed run is marked `failed` and stays there.
- **No template messages**, so the bot can only reply inside the 24-hour window
  the user opens by messaging first. P2 needs templates to *start*
  conversations.
- **No media handling, no tools, no RAG.**

---

## Further reading

- [WORKFLOW-EXPLAINED.md](WORKFLOW-EXPLAINED.md) — the same system explained
  from first principles
- [LESSONS-LEARNED.md](LESSONS-LEARNED.md) — how these decisions were arrived at
  the hard way
- `context/02-meta-whatsapp-api.md` — payload shapes, send API, token setup
- `context/04-supabase-schema.md` — the schema with full DDL
- `CLAUDE.md` — build log and deviations log
