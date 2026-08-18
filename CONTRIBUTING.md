# Working on this together

Read this before you touch n8n or Supabase. This project shares live
infrastructure between developers, and a few things here will silently break
the other person's work if you don't know about them.

---

## The one thing to understand first

**The product is an n8n workflow, not source code.**

There is no server to run, no build, no deploy. A 23-node flowchart living
inside n8n *is* the application. That means the normal git safety net doesn't
protect you here:

- Editing the workflow changes a **live system immediately** — there's no PR
  gate between you and production.
- `workflows/whatsapp-deepseek-assistant.json` is an **export**, a snapshot
  taken after the fact. Editing that file changes nothing on its own.
- Two people editing the workflow at once will overwrite each other, and the
  JSON does not merge sensibly.

So the coordination rules below matter more than the git rules.

---

## What's shared and what's yours

| Thing | Shared? | Notes |
|---|---|---|
| Supabase project + data | **Shared** | Same tables, same rows. Your test data is in their AI's conversation history. |
| Meta app, WABA, test number | **Shared** | One webhook URL, globally. See below. |
| DeepSeek API key + credit | **Shared** | Same prepaid balance. Every call spends it. |
| ngrok reserved domain | **Shared, exclusive** | Only one machine can hold it at a time. |
| n8n instance | **Yours** | Runs on your own laptop, own credentials, own local DB. |

### ⚠️ Only one person can receive real WhatsApp messages at a time

Meta's webhook config holds exactly **one** callback URL. It points at the
project's reserved ngrok domain, and that domain can only be claimed by one
running ngrok process.

Consequence: if you start ngrok with the shared authtoken, **you take the
tunnel** and real messages stop reaching the other person's laptop. They get
no error — messages just stop arriving.

**Rule: say so in chat before you claim the tunnel, and say so when you're
done.** There's no lock and no way to detect it from the outside.

### You almost never need the tunnel anyway

The normal development loop doesn't involve a real phone at all:

```bash
npm run test:webhook
```

This POSTs a realistic fake WhatsApp payload straight at *your own* local n8n.
It exercises the entire workflow — parsing, guards, claiming, DeepSeek, logging.
It needs no ngrok, no Meta, and doesn't disturb anyone.

Only claim the tunnel for a genuine end-to-end test from a handset.

### The allowlist means the bot ignores your phone

The workflow only replies to the single number in `ALLOWED_WHATSAPP_NUMBER`
(currently Ali's handset). If you text the bot from a different phone, the
message gets logged and then silently dropped at the `Allowed Sender` node.
That's working as designed, not a bug. Coordinate before changing it.

---

## Working on the workflow

### 1. Claim it first
One person edits the n8n workflow at a time. Announce it. There is no locking.

### 2. Import the current version into your own n8n
```
n8n GUI → Workflows → Import from File
  → workflows/whatsapp-deepseek-assistant.json
```
Then re-select credentials on every node that needs one. The export contains
credential **ids and names only** — the secret material stays encrypted inside
whichever n8n instance created it, and never travels in the JSON. This is
deliberate; don't "fix" it.

### 3. ⚠️ Republish after every edit, or your change isn't live
This n8n build separates the **working draft** from the **published/active
version**. Editing nodes in the GUI updates the draft only. The live webhook
keeps serving the last *activated* version.

The classic symptom: the webhook 404s with "not registered for POST requests"
even though the node is plainly on the canvas.

Fix — toggle Active off then on in the GUI, or via API:
```bash
curl -X POST "$N8N_URL/api/v1/workflows/{id}/deactivate" -H "X-N8N-API-KEY: $N8N_API_KEY"
curl -X POST "$N8N_URL/api/v1/workflows/{id}/activate"   -H "X-N8N-API-KEY: $N8N_API_KEY"
```
Confirm it took: `GET /workflows/{id}` should show `versionId === activeVersionId`.

### 4. Verify from execution data, not from the canvas
The n8n canvas *renders* values and hides the field's mode. What's stored can
differ from what you see. Multiple real bugs here were invisible on screen:

- A field toggled to **Expression** mode always stores a leading `=`. Retyping
  the value can never remove it — click **Fixed** on the Fixed|Expression
  toggle instead.
- `= {{ expr }}` (space after `=`) is a *string template*, not an expression.
  For an object it silently stringifies to `"[object Object]"`, destroying the
  payload with no error.
- Invisible pasted characters (a stray space, a box-drawing `│`) can corrupt a
  field name that looks perfectly normal.

So: check the actual execution `runData`, and check what actually landed in
Supabase — not that the request returned 200.

### 5. Export it back when it works
```bash
# GUI: workflow menu → Download
# Save over workflows/whatsapp-deepseek-assistant.json, then commit.
```
An unexported change exists only on your laptop. If that laptop dies, the
product is gone.

### 6. `$json` is not what you think
`$json` means *only* "whatever the immediately-previous node emitted". Several
nodes here (the Supabase inserts) return an empty body, so `$json` becomes `{}`
and everything downstream sees `undefined` — silently, with no error.

**Always reach back by node name:** `$('Edit Fields').item.json.from_number`.

---

## Working on the database

Shared Supabase project — your rows are the other person's data.

- **Migrations are additive and numbered.** Add `supabase/003_*.sql`; don't
  edit an applied file.
- **Clean up test rows.** The bot feeds the last 10 stored messages to DeepSeek,
  so leftover junk from your testing becomes the AI's memory of the
  conversation. Delete synthetic rows from `messages` **and** `assistant_runs`
  when you're done.
- The fake-payload script uses obviously-fake numbers (`447700900123`) —
  keep it that way so test rows are easy to find and delete.

---

## Git conventions

Nothing exotic:

- Branch off `main` for anything non-trivial: `feature/…`, `fix/…`, `docs/…`.
- Commit messages: what changed and **why**, present tense. The existing log is
  a decent model (`Step 9 complete: outbound logging, run completion, …`).
- Keep the docs honest in the same commit as the change. `CLAUDE.md` holds the
  build checklist and a **deviations log** — when reality differs from the
  docs, add a line there. That log is the most valuable artifact in the repo
  for P2.
- Real traps you hit and solved go in `docs/LESSONS-LEARNED.md` with the full
  reasoning.

### Never commit

- `.env`, or any real token/key/secret in any file
- Anything into `.env.example` except **empty** placeholder keys and comments
- Workflow exports containing credential *data* (n8n doesn't export it — just
  don't paste any in by hand)
- `tmp/`, logs, `node_modules/` — all already gitignored

If a secret does get committed, rotating the credential matters more than
rewriting history. Do both, rotate first.

---

## Debugging: where to look, in order

1. **n8n → Executions.** Open the failed run, click the node, read the actual
   input and output. This answers most questions.
2. **`context/06-gotchas.md`** — 19 known failure symptoms.
3. **`docs/LESSONS-LEARNED.md`** — traps actually hit here, with full write-ups.
4. **`CLAUDE.md` deviations log** — one-liners for where the docs were wrong.
5. **`scripts/`** — isolate the failing service. Each script proves exactly one
   thing (Meta token, Supabase insert, DeepSeek call) with no n8n involved.
   If `npm run verify:meta` passes, the token isn't your problem.
6. `answers/06-gotchas-full.md` — the answer key. Form a diagnosis first.

### Two failure modes that waste the most time

- **A message never arrives at all.** Check that the app is subscribed to the
  WABA: `GET /{WABA_ID}/subscribed_apps` must list this project's app. A
  manually-created System User token does *not* do this automatically, and
  there's no dashboard button for it. The dashboard "Test" button bypasses the
  real delivery path and will happily pass while real messages vanish.
- **An n8n credential can be silently wrong while the token is perfectly fine.**
  n8n encrypts credential values and never returns them, so you can't inspect
  what it stored. Prove the token independently with curl first, then suspect
  the credential.

---

## Asking the other person for setup values

`.env` is shared by hand, never through git. Send it over something private
(not a public channel, not a commit, not a screenshot in a group chat) and
prefer a paste that expires.

Everything you need is listed with comments in `.env.example`.
