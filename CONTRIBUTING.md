# Working on this together

Read this before you touch n8n or Supabase.

**If you are an AI agent working in this repo, read
[docs/AGENT-BRIEF.md](docs/AGENT-BRIEF.md) instead — it's the same information
in the form you need, plus the invariants you must not break.**

---

## The one thing to understand first

**The product is an n8n workflow, not source code.**

There is no server, no build, no deploy. A 23-node flowchart living inside n8n
*is* the application. The normal git safety net does not protect you here:

- Editing the workflow changes a **live system immediately**. No PR gate.
- `workflows/whatsapp-deepseek-assistant.json` is an **export** — a snapshot
  taken after the fact. Editing that file changes nothing on its own.
- Two people editing the same n8n instance at once overwrite each other, and
  the JSON does not merge sensibly.

---

## How the two setups are split

Each developer runs their **own** WhatsApp pipeline and shares only the data
and model layers.

| Thing | Yours or shared | Notes |
|---|---|---|
| n8n instance | **Yours** | Runs on your own laptop, own login, own credentials |
| ngrok tunnel + URL | **Yours** | Your own account. No contention. |
| Meta app, test number, tokens | **Yours** | Your own developer account |
| Your handset | **Yours** | The allowlist points at it |
| Supabase project + data | **Shared** | Same tables, same rows |
| DeepSeek API key + credit | **Shared** | One prepaid balance between you |

This is deliberate. An earlier plan shared the Meta app, but Meta's webhook
config holds exactly **one** callback URL — so only one machine could ever
receive real messages, and the other person got no error when they lost it.
Separate Meta apps remove that problem entirely.

### Sharing Supabase is fine, and actually clean

`Load history` filters `from_number=eq.<sender>`, so conversations are
partitioned by handset automatically. Your test traffic never becomes the
context for the other person's bot. WhatsApp message ids are globally unique,
so the dedup table doesn't collide either.

Still clean up obvious junk rows — see [Working on the database](#working-on-the-database).

### Sharing the DeepSeek key just means sharing the bill

No technical issue. Every call spends the same prepaid balance. `max_tokens` is
capped at 512 in `Build DeepSeek request`; leave it there.

---

## Setting up your own half

Full walkthrough in [docs/SETUP.md](docs/SETUP.md). If you were handed a copy
of the other developer's `.env`, work through
[docs/ENV-HANDOVER.md](docs/ENV-HANDOVER.md) instead — it marks every variable
KEEP or REPLACE. The part people miss:

### ⚠️ The workflow does not read `.env`

`.env` is used **only** by the scripts in `scripts/`. n8n never sees it. The
workflow has hardcoded literals baked into its nodes, so after importing the
JSON you must change these by hand:

| Node | Currently | Change to |
|---|---|---|
| `Allowed Sender` | `<ALLOWED_NUMBER>` (rightValue) | your own handset, digits only, no `+` |
| `Send WhatsApp reply` | `.../v25.0/1303482916173126/messages` | your own phone number id |
| `Send text-only reply` | same id in the URL | your own phone number id |

Plus your own `Meta WhatsApp` credential (Header Auth, `Authorization` =
`Bearer <your token>`).

The 7 Supabase nodes and the DeepSeek node keep the shared values — leave those
alone.

### Your workflow export will differ from theirs

Because of the three literals above. To avoid a permanent phantom diff, pick
one:

- **Default: one canonical export.** Ali's instance is canonical. You don't
  commit `workflows/*.json` unless the change is structural (nodes added,
  removed, or rewired), and when you do, you note in the commit that the three
  literals are his.
- **Better if it works: use env expressions.** Replace the literals with
  `{{ $env.ALLOWED_WHATSAPP_NUMBER }}` and
  `{{ $env.META_PHONE_NUMBER_ID }}`, set those in each n8n process's own
  environment, and the JSON becomes identical for both of you. **Unverified:**
  n8n has an `N8N_BLOCK_ENV_ACCESS_IN_NODE` setting that may block `$env` in
  expressions on 2.32.7. Test it before relying on it, and don't half-migrate —
  a `$env` that resolves to empty fails open and messages go to nobody.

---

## Working on the workflow

### 1. Import into your own n8n
```
n8n GUI → Workflows → Import from File
  → workflows/whatsapp-deepseek-assistant.json
```
Then re-select credentials on every node that needs one. The export contains
credential **ids and names only** — secret material stays encrypted inside
whichever n8n instance created it and never travels in the JSON. This is
deliberate; don't "fix" it.

### 2. ⚠️ Republish after every edit, or your change isn't live
This n8n build separates the **working draft** from the **published/active
version**. Editing nodes updates the draft only. The live webhook keeps serving
the last *activated* version.

Classic symptom: the webhook 404s with "not registered for POST requests" even
though the node is plainly on the canvas.

Fix — toggle Active off then on in the GUI, or via API:
```bash
curl -X POST "$N8N_URL/api/v1/workflows/{id}/deactivate" -H "X-N8N-API-KEY: $N8N_API_KEY"
curl -X POST "$N8N_URL/api/v1/workflows/{id}/activate"   -H "X-N8N-API-KEY: $N8N_API_KEY"
```
Confirm: `GET /workflows/{id}` should show `versionId === activeVersionId`.

### 3. Verify from execution data, not from the canvas
The canvas *renders* values and hides the field's mode. What's stored can
differ from what you see. Real bugs here were invisible on screen:

- A field toggled to **Expression** mode always stores a leading `=`. Retyping
  can never remove it — click **Fixed** on the Fixed|Expression toggle instead.
  Rule of thumb: a comparison's left side wants Expression, its right side
  wants Fixed when comparing to a constant.
- `= {{ expr }}` (space after `=`) is a *string template*, not an expression.
  For an object it silently stringifies to `"[object Object]"`, destroying the
  payload with no error.
- Invisible pasted characters (a stray space, a box-drawing `│`) can corrupt a
  field name that looks perfectly normal.

So: read the actual execution `runData`, and check what landed in Supabase —
not that the request returned 200.

### 4. `$json` is not what you think
`$json` means *only* "whatever the immediately-previous node emitted". The
Supabase inserts return an empty body, so `$json` becomes `{}` and everything
downstream sees `undefined` — silently, no error.

**Always reach back by node name:** `$('Edit Fields').item.json.from_number`.

### 5. Export it back when it works
GUI → workflow menu → Download → save over
`workflows/whatsapp-deepseek-assistant.json`.

An unexported change exists only on your laptop.

---

## Working on the database

Shared Supabase project — your rows are the other person's data.

- **Migrations are additive and numbered.** Add `supabase/003_*.sql`; never
  edit an already-applied file. Say so in chat before applying — a migration
  hits both of you at once.
- **Clean up synthetic test rows** from `messages` **and** `assistant_runs`.
  The fake-payload script uses `447700900123`, which makes them easy to find.
- Never `delete from messages` unqualified. Real conversation history is the
  only record of the system working.

---

## Git conventions

- Branch off `main` for anything non-trivial: `feature/…`, `fix/…`, `docs/…`.
- Commit messages: what changed and **why**, present tense.
- Keep docs honest in the same commit as the change. `CLAUDE.md` holds the
  build checklist and a **deviations log** — when reality differs from the
  docs, add a line there. That log is the most valuable thing in the repo for
  P2.
- Traps you hit and solved go in `docs/LESSONS-LEARNED.md` with full reasoning.

### Never commit

- `.env`, or any real token/key/secret in any file
- Anything in `.env.example` except **empty** placeholders and comments
- Workflow exports containing credential *data* (n8n doesn't export it — just
  don't paste any in by hand)
- `tmp/`, logs, `node_modules/` — already gitignored

If a secret does get committed, **rotate the credential first**, then worry
about history.

---

## Debugging: where to look, in order

1. **n8n → Executions.** Open the failed run, click the node, read its real
   input and output. This answers most questions.
2. Re-run the relevant `npm run verify:*` script. If it passes, the service and
   credentials are fine and the problem is in the workflow.
3. **`docs/LESSONS-LEARNED.md`** — traps actually hit here, written up in full.
4. **`context/06-gotchas.md`** — 19 known failure symptoms.
5. **`CLAUDE.md` deviations log** — one-liners for where the docs were wrong.
6. `answers/06-gotchas-full.md` — the answer key. Form a diagnosis first.

### The three that waste the most time

- **Messages never arrive at all.** Check your app is subscribed to your WABA:
  `GET /{WABA_ID}/subscribed_apps` must list your app. A manually-created
  System User token does *not* do this, and there's no dashboard button. Meta's
  dashboard "Test" button bypasses the real delivery path and passes happily
  while real messages vanish.
- **A send returns 200 and is never delivered.** Free-form messages only
  deliver inside a 24-hour window opened by the *user* messaging you first.
  Text your bot from the handset, then retry. No error is returned.
- **An n8n credential can be silently wrong while the token is perfectly fine.**
  n8n encrypts credential values and never returns them, so you cannot inspect
  what it stored. Prove the token independently with curl first, *then* suspect
  the credential.
