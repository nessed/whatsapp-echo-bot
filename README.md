# whatsapp-deepseek-bot

A private WhatsApp number that answers with AI and remembers the conversation.

You text a Meta WhatsApp test number. An n8n workflow picks the message up,
loads the last 10 messages of that conversation out of Postgres, asks DeepSeek
for a reply, sends it back over WhatsApp, and logs both directions.

**Status: complete and working.** All 10 build steps are verified end to end
against a real handset. See [Current state](#current-state) for the known loose
ends.

---

## New here? Read these three things

1. **[docs/WORKFLOW-EXPLAINED.md](docs/WORKFLOW-EXPLAINED.md)** — start here.
   A self-contained, plain-English explanation of what every part of the system
   does and *why it exists*. No n8n knowledge assumed. ~30 min read.
2. **[docs/SETUP.md](docs/SETUP.md)** — get it running on your machine.
3. **[CONTRIBUTING.md](CONTRIBUTING.md)** — how two people work on this without
   breaking each other. **Read before touching n8n** — the live workflow is a
   shared single instance, not a per-developer thing.

Everything else is reference material you can look up when you need it.

---

## What it's made of

Five systems, each doing one job:

| Piece | Role |
|---|---|
| **Meta WhatsApp Cloud API** | Receives and sends the actual WhatsApp messages |
| **n8n** (local) | The orchestrator — a 23-node flowchart that decides what happens in what order |
| **ngrok** | Gives the local n8n a public HTTPS URL so Meta can reach it |
| **Supabase** (Postgres) | Stores every message + one "run" row per AI attempt |
| **DeepSeek** (`deepseek-v4-flash`) | Writes the replies |

There is no application server and no deployed code. **The workflow *is* the
product** — it lives in n8n, and `workflows/whatsapp-deepseek-assistant.json`
is a version-controlled export of it. The `scripts/` folder is verification
tooling only; it is not part of the running system.

## How a message flows

```
WhatsApp message
      │
      ▼
  Meta Cloud API ──POST──► ngrok ──► n8n webhook
                                       │
                              Is it actually a message?    (delivery receipts land here too)
                                       │ yes
                              Log inbound to Supabase
                                       │
                              Reply 200 to Meta  ◄── happens NOW, before the slow AI part
                                       │
                              Is the sender allowed?
                                       │ yes
                              Is it text?  ── no ──► "text messages only" reply
                                       │ yes
                              Claim the run  ── already claimed ──► stop (duplicate delivery)
                                       │ first time
                              Load last 10 messages
                                       │
                              Ask DeepSeek
                                       │
                              Send reply via Meta
                                       │
                              Log outbound + mark run completed
```

Each guard exists for a real reason (duplicate deliveries, non-message webhook
traffic, media, Meta's response timeout, cost control). The reasoning behind
every one is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), and at length in
[docs/WORKFLOW-EXPLAINED.md](docs/WORKFLOW-EXPLAINED.md).

---

## Repository layout

```
docs/          Explanations written for humans — start here
context/       Reference material: API shapes, schema, build order, gotchas
answers/       Answer key for the gotchas list (see the rule below)
scripts/       Standalone verification scripts — prove one service works in isolation
supabase/      SQL migrations (messages + assistant_runs tables)
workflows/     Exported n8n workflow JSON (credential *ids* only, no secrets)
CLAUDE.md      Working agreement + full build log and deviations log
```

### docs/
| File | What it's for |
|---|---|
| [WORKFLOW-EXPLAINED.md](docs/WORKFLOW-EXPLAINED.md) | The system explained from scratch. Best single document here. |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Node-by-node map of the live workflow, and the data model |
| [SETUP.md](docs/SETUP.md) | Zero to running locally |
| [LESSONS-LEARNED.md](docs/LESSONS-LEARNED.md) | Traps actually hit while building, with full explanations. Read when stuck. |
| [SHOPIFY-SETUP.md](docs/SHOPIFY-SETUP.md) | P2 groundwork — the Shopify app for the next project |
| [NOTEBOOKLM-PROMPT.md](docs/NOTEBOOKLM-PROMPT.md) | Prompt for generating an audio overview of this system |

### context/
Numbered reference docs, written before/during the build. Look things up here
rather than reading end to end.

`01` brief · `02` **Meta WhatsApp API (the important one)** · `03` n8n setup ·
`04` Supabase schema · `05` build sequence · `06` gotchas (symptoms) ·
`07` DeepSeek branch build · `08` implementation handoff

### ⚠️ The answers/ folder
`answers/06-gotchas-full.md` is a deliberate answer key. Don't reach for it
first — diagnose from actual execution logs and error bodies, then check it.
The whole point of the project is learning to debug this class of system.

---

## Quick start

Full detail in **[docs/SETUP.md](docs/SETUP.md)**. The short version:

```bash
cp .env.example .env      # then fill it in — ask Ali for the shared values
npm run verify:meta       # each script proves ONE service works, in isolation
npm run verify:supabase
npm run verify:deepseek

n8n start                 # terminal 1  (global install, not npx — see SETUP.md)
npx ngrok http 5678 --authtoken <NGROK_AUTHTOKEN>   # terminal 2

npm run test:webhook      # POST a fake WhatsApp payload at your local n8n
```

Requires **Node 22+** (the scripts are ESM and use `--env-file`).

`npm run test:webhook` is the main development loop — it fakes an inbound
WhatsApp message so you can exercise the whole workflow without a real phone
and without owning the shared Meta webhook.

---

## Current state

Working and verified end to end: inbound parsing, sender allowlist, non-text
handling, idempotent run claiming, bounded conversation history, DeepSeek
replies, outbound delivery + logging, token accounting, and failure marking.

Known loose ends — none blocking:

- **No `X-Hub-Signature-256` verification** on the inbound webhook.
  `META_APP_ID` / `META_APP_SECRET` are unset. Optional for P1, expected for P2.
  Anyone who learns the webhook URL can POST a fake message at it today.
- **Stale `assistant_runs` rows** sitting at `status: claimed` with no
  completion — historical noise from before the `Complete run` node existed.
- **Credentials exposed during development have not been rotated.**

## What's next: P2

This is practice project **P1**. The real deliverable was always the plumbing —
webhook handling, API auth, payload parsing, idempotency, bounded context,
structured logging.

**P2** is a client-facing COD order-confirmation bot on the same patterns.
Groundwork has started in [docs/SHOPIFY-SETUP.md](docs/SHOPIFY-SETUP.md).

Two P1 findings that bite P2 directly:
- Free-form messages only deliver inside a 24-hour window opened by the *user*
  messaging first. P2 must open conversations with an approved **template**.
- A manually-created System User token does **not** subscribe your app to the
  WABA. You must `POST /{WABA_ID}/subscribed_apps` yourself or real messages
  silently never arrive. (Meta's dashboard "Test" button does not catch this.)

---

## Security

- `.env` is gitignored and has never been committed. Verified.
- Workflow JSON exports contain credential **ids and names only** — n8n keeps
  the secret material encrypted on its own side.
- Never paste a real key into `.env.example`, a workflow export, a doc, or a
  commit message. See [CONTRIBUTING.md](CONTRIBUTING.md#never-commit).
