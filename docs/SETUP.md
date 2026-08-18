# Setup — from zero to a working local instance

Target: you can send a fake WhatsApp message at your own machine and watch it
come back with a DeepSeek answer.

Budget about an hour, most of it waiting on n8n's first boot.

> Read [CONTRIBUTING.md](../CONTRIBUTING.md) alongside this. Some of the
> infrastructure here is **shared and exclusive** — claiming it stops the other
> developer's bot working, with no error message on their side.

---

## 1. Prerequisites

- **Node 22 or newer.** The scripts are ESM and rely on `node --env-file`.
  ```bash
  node --version
  ```
- **n8n, installed globally and pinned:**
  ```bash
  npm install -g n8n@2.32.7
  ```
  Use `n8n start`, **not** `npx n8n start`. `npx` re-resolves n8n's entire
  dependency tree (hundreds of packages, including a whole LangChain/AI-SDK
  toolkit) from the npm registry on *every single run*. That turned out to be
  genuinely flaky — two separate `ETARGET` failures for versions that did in
  fact exist, caused by stale local npm cache metadata. The global install
  boots in ~60–80s instead of several minutes and doesn't resolve anything.

  Pinned to `2.32.7` deliberately — `latest` at the time had its own broken
  dependency pin.

  If npm gives you `ETARGET: No matching version found` for a package that
  clearly exists: `npm cache clean --force`.
- **ngrok** — no install needed, run via `npx`. Only required for real phone
  testing (see step 6).

## 2. Get the repo and the secrets

```bash
git clone <repo-url>
cd whatsapp-echo-bot
cp .env.example .env
```

`.env.example` lists every variable with a comment explaining where it comes
from. **Ask Ali for the shared values** — Meta token, Supabase URL + service
key, DeepSeek key, ngrok authtoken, n8n API key.

Send them over something private and expiring. Never through git, a commit, a
screenshot, or a group chat.

`.env` is gitignored and has never been committed. Keep it that way.

## 3. Prove each service works, in isolation

Do this **before** touching n8n. Each script hits exactly one service and
nothing else, so a failure tells you precisely what's wrong. Debugging a
5-system chain when you haven't proved the individual pieces is how you lose an
afternoon.

```bash
npm run verify:meta       # sends one real WhatsApp message; confirms the token
npm run verify:supabase   # inserts + reads a row; confirms schema and constraints
npm run verify:deepseek   # one chat completion; confirms key and credit
```

Expect: `verify:meta` reports a permanent token (`expires_at: 0`),
`verify:supabase` confirms both constraints fire, `verify:deepseek` returns
HTTP 200 from `deepseek-v4-flash`.

> **Meta quirk that looks like a pass but isn't:** a free-form message to a
> number that hasn't texted the test number first returns HTTP 200 with a valid
> message id — and is then **silently never delivered**. No error. If
> `verify:meta` claims success and no message arrives, that's the 24-hour
> window, not a broken token. Text the test number from that handset first.

## 4. Start n8n

```bash
n8n start
```

Give it 30–60s on first boot. Then open http://localhost:5678 and create your
local owner account (this is your own instance — the login is not shared).

Check it's healthy:
```bash
curl http://localhost:5678/healthz     # expect 200
```

## 5. Import the workflow

In the n8n GUI: **Workflows → Import from File →**
`workflows/whatsapp-deepseek-assistant.json`

Then **recreate the credentials**, because the export deliberately contains
credential *ids and names only* — never secret material. Create these under
**Credentials → New**:

| Credential name | n8n type | Value |
|---|---|---|
| `Supabase (messages)` | Supabase API | Host = `SUPABASE_URL`, Service Role Secret = `SUPABASE_SERVICE_KEY` |
| `DeepSeek account` | DeepSeek | API Key = `DEEPSEEK_API_KEY` |
| `Meta WhatsApp` | Header Auth | Name = `Authorization`, Value = `Bearer <META_ACCESS_TOKEN>` |

Then open each node that needs one and select it.

> **The Meta credential is worth creating programmatically.** A truncated paste
> or a missing `Bearer ` prefix produces n8n's generic
> `Authorization failed - please check your credentials` — with a token that is
> completely fine. n8n encrypts credential values and never returns them, so
> you cannot inspect what it actually stored, and you can burn an hour blaming
> the token. Creating it from `.env` removes the human paste:
> ```bash
> curl -X POST "$N8N_URL/api/v1/credentials" \
>   -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" \
>   -d "{\"name\":\"Meta WhatsApp\",\"type\":\"httpHeaderAuth\",\"data\":{\"name\":\"Authorization\",\"value\":\"Bearer $META_ACCESS_TOKEN\"}}"
> ```

Finally, **activate the workflow** — and remember that every later edit needs a
republish before it goes live. See
[CONTRIBUTING.md](../CONTRIBUTING.md#3--republish-after-every-edit-or-your-change-isnt-live).

## 6. Test it — without touching the shared tunnel

This is the normal development loop:

```bash
npm run test:webhook
```

It POSTs three fake Meta payloads at `http://localhost:5678/webhook/whatsapp`:
a text message, a delivery-status update, and an image message. No ngrok, no
Meta, no shared infrastructure, no effect on the other developer.

**The script only prints the HTTP response, which is always `OK`.** The actual
result is in **n8n → Executions**. Open the run and confirm:

- the text payload parses all five fields and continues down the chain
- the status payload stops at the `If1` guard without parsing anything
- the image payload yields `message_text: null` and gets the fixed
  "text messages only" reply without ever calling DeepSeek

Then **delete the synthetic rows** from `messages` and `assistant_runs` in
Supabase. The bot feeds the last 10 stored messages to DeepSeek as conversation
history, so leftover test junk becomes the AI's memory. The fake payloads use
`447700900123`, which makes them easy to find.

### Only if you need a real end-to-end test

This claims the shared tunnel and takes real WhatsApp delivery away from the
other developer, silently. **Tell them first.**

```bash
npx ngrok http 5678 --authtoken <NGROK_AUTHTOKEN>
```

The authtoken's account has a **reserved domain**, so ngrok always comes back
on the same URL. That means `N8N_URL` never needs changing and Meta's webhook
never needs re-verifying — unlike a plain free-tier tunnel.

Confirm the tunnel: `curl http://localhost:4040/api/tunnels`

Note that the bot only replies to `ALLOWED_WHATSAPP_NUMBER`. Texting from any
other handset gets logged and then silently dropped at the `Allowed Sender`
node — that's by design.

---

## Restarting later

n8n and ngrok are foreground processes, not services. Laptop sleeps or terminal
closes, they die.

```bash
n8n start                                            # terminal 1
npx ngrok http 5678 --authtoken <NGROK_AUTHTOKEN>    # terminal 2, only if needed
```

Your workflow and credentials live in `~/.n8n` and survive restarts. The ngrok
URL is stable, so nothing needs re-pointing in Meta.

---

## If something doesn't work

Work through it in this order:

1. **n8n → Executions**, open the failed run, click the failing node, read its
   real input and output.
2. Re-run the relevant `npm run verify:*` script. If it passes, the service and
   credentials are fine and the problem is in the workflow.
3. [LESSONS-LEARNED.md](LESSONS-LEARNED.md) — traps actually hit on this
   project, written up in full.
4. `context/06-gotchas.md` — 19 known symptoms.
5. `answers/06-gotchas-full.md` — the answer key. Form a diagnosis first; the
   point of the exercise is learning to read the evidence.

**Messages never arriving at all** is usually not a workflow problem — check
that the app is subscribed to the WABA (`GET /{WABA_ID}/subscribed_apps`).
Details in [CONTRIBUTING.md](../CONTRIBUTING.md#two-failure-modes-that-waste-the-most-time).
