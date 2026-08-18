# Setup — from zero to a working local instance

Target: your own WhatsApp test number replies to your own handset with a
DeepSeek answer, using the shared Supabase and DeepSeek accounts.

Budget a couple of hours. Most of it is Meta dashboard clicking, not code.

> **AI agents:** read [AGENT-BRIEF.md](AGENT-BRIEF.md) first.
>
> **Humans:** read [CONTRIBUTING.md](../CONTRIBUTING.md) alongside this — it
> explains what's shared and what's yours.

## What you'll own vs share

**Yours:** n8n instance, ngrok tunnel, Meta app + test number + tokens, and the
handset the bot is allowed to reply to.

**Shared with the other developer:** the Supabase project and the DeepSeek key.

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
  toolkit) from the npm registry on *every run*. That proved genuinely flaky —
  two separate `ETARGET` failures for versions that did in fact exist, caused
  by stale local npm cache metadata. Global install boots in ~60–80s and
  resolves nothing.

  Pinned to `2.32.7` deliberately — `latest` at the time had its own broken
  dependency pin. If npm reports `ETARGET` for a package that clearly exists:
  `npm cache clean --force`.
- **An ngrok account** (free tier is fine). Free accounts get one static
  domain, which is worth claiming — otherwise your URL changes on every restart
  and you must re-verify the webhook in Meta each time.

## 2. Clone and create `.env`

```bash
git clone <repo-url>
cd whatsapp-echo-bot
cp .env.example .env
```

> **Were you handed a copy of the other developer's `.env` instead?** Use
> [ENV-HANDOVER.md](ENV-HANDOVER.md) — it lists every variable as KEEP or
> REPLACE, plus the node literals and credentials `.env` doesn't cover.

`.env.example` documents every variable. Fill in:

- **From the other developer** (send privately, never through git):
  `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `DEEPSEEK_API_KEY`
- **Your own**, from steps 3–5 below: all `META_*`, `WEBHOOK_VERIFY_TOKEN`,
  `N8N_URL`, `N8N_API_KEY`, `NGROK_AUTHTOKEN`, `ALLOWED_WHATSAPP_NUMBER`

`.env` is gitignored and has never been committed. Keep it that way.

> **`.env` only feeds the scripts in `scripts/`.** n8n never reads it. The
> workflow's own configuration is set inside the nodes and in n8n's encrypted
> credential store. This catches everyone once — see step 6.

## 3. Create your own Meta app and test number

Reference detail lives in `context/02-meta-whatsapp-api.md`. The shape:

1. Meta developer account → create an app → add the **WhatsApp** product.
2. You get a free **test phone number** and a numeric **phone number id**.
   The id is what the API uses — not the phone number. Save it as
   `META_PHONE_NUMBER_ID`.
3. **Add your own handset as a verified recipient.** The free test number can
   only send to numbers you explicitly add. Without this, sends fail or vanish.
4. Create a **permanent System User token** with
   `whatsapp_business_messaging` and `whatsapp_business_management`. Save as
   `META_ACCESS_TOKEN`. Verify it's permanent — `expires_at` should be `0`.
5. Invent a random `WEBHOOK_VERIFY_TOKEN`. You'll enter the same string in
   Meta's webhook config later.
6. Set `ALLOWED_WHATSAPP_NUMBER` to your handset, digits only, no `+`.

### ⚠️ Subscribe your app to the WABA — there is no button for this

A manually-created System User token does **not** subscribe your app to the
WhatsApp Business Account. Meta's guided signup flow does it invisibly; doing
it by hand does not. Miss it and **real messages silently never reach your
webhook** while every dashboard indicator stays green.

```bash
# Should list YOUR app. If it doesn't, nothing will ever arrive.
curl "https://graph.facebook.com/v25.0/{WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer $META_ACCESS_TOKEN"

# Fix:
curl -X POST "https://graph.facebook.com/v25.0/{WABA_ID}/subscribed_apps" \
  -H "Authorization: Bearer $META_ACCESS_TOKEN"
```

Meta's dashboard "Test" button does **not** catch this — it bypasses the real
delivery path entirely and will pass while real messages disappear.

## 4. Prove each service works, in isolation

Do this **before** touching n8n. Each script hits exactly one service, so a
failure tells you precisely what's broken. Debugging a five-system chain when
you haven't proved the pieces is how you lose an afternoon.

```bash
npm run verify:meta       # sends one real WhatsApp message to your handset
npm run verify:supabase   # inserts + reads a row; confirms schema and constraints
npm run verify:deepseek   # one chat completion
```

> **A pass that isn't one:** a free-form message to a number that hasn't texted
> your test number first returns HTTP 200 with a valid message id — and is then
> **silently never delivered**. No error, no 131047. If `verify:meta` reports
> success and nothing arrives, that's the 24-hour window, not a broken token.
> Text your test number from the handset first, then re-run.

## 5. Start n8n and expose it

```bash
n8n start                                          # terminal 1, 30–60s first boot
npx ngrok http 5678 --authtoken <NGROK_AUTHTOKEN>  # terminal 2
```

Open http://localhost:5678 and create your local owner account — your own
instance, nothing shared.

```bash
curl http://localhost:5678/healthz      # expect 200
curl http://localhost:4040/api/tunnels  # your public URL
```

Put the ngrok HTTPS URL in `.env` as `N8N_URL` (no trailing slash).

## 6. Import the workflow and make it yours

**Workflows → Import from File →** `workflows/whatsapp-deepseek-assistant.json`

Import **that** file, not `workflows/echo-bot.json` — the latter is a historical
10-node snapshot from before the DeepSeek branch existed. Both are internally
named `"My workflow"`, so rename yours in the GUI after importing. See
[../workflows/README.md](../workflows/README.md).

### 6a. Change the three literals

The workflow does not read `.env`. These values are baked into the nodes and
are currently the *other* developer's:

| Node | Field | Change to |
|---|---|---|
| `Allowed Sender` | rightValue, currently `923000413777` | your handset, digits only, no `+` |
| `Send WhatsApp reply` | URL, currently `.../v25.0/1303482916173126/messages` | your `META_PHONE_NUMBER_ID` |
| `Send text-only reply` | same id in its URL | your `META_PHONE_NUMBER_ID` |

Leave the seven Supabase nodes and the DeepSeek node alone — those point at the
shared services.

> When editing `Allowed Sender`, make sure the right-hand value is in **Fixed**
> mode, not Expression. An Expression-mode field always stores a leading `=`,
> which no amount of retyping removes, and the comparison then never matches.
> The `fx` badge on the field's left edge tells you which mode you're in.

### 6b. Create your credentials

**Credentials → New:**

| Credential name | n8n type | Value |
|---|---|---|
| `Supabase (messages)` | Supabase API | Host = `SUPABASE_URL`, Service Role Secret = `SUPABASE_SERVICE_KEY` |
| `DeepSeek account` | DeepSeek | API Key = `DEEPSEEK_API_KEY` |
| `Meta WhatsApp` | Header Auth | Name = `Authorization`, Value = `Bearer <your META_ACCESS_TOKEN>` |

Then open each node that needs one and select it. The export carries credential
*ids and names only* — secret material stays encrypted in whichever n8n
instance created it. That's deliberate, not a bug.

> **Create the Meta credential programmatically if you can.** A truncated paste
> or a missing `Bearer ` prefix produces n8n's generic
> `Authorization failed - please check your credentials` — with a token that is
> completely fine. n8n encrypts credential values and never returns them, so
> you cannot inspect what it stored, and you can burn an hour blaming the
> token. This removes the human paste:
> ```bash
> curl -X POST "$N8N_URL/api/v1/credentials" \
>   -H "X-N8N-API-KEY: $N8N_API_KEY" -H "Content-Type: application/json" \
>   -d "{\"name\":\"Meta WhatsApp\",\"type\":\"httpHeaderAuth\",\"data\":{\"name\":\"Authorization\",\"value\":\"Bearer $META_ACCESS_TOKEN\"}}"
> ```

### 6c. Activate — and republish after every later edit

n8n separates the **working draft** from the **published/active version**.
Editing nodes updates the draft only; the live webhook keeps serving the last
*activated* version. Symptom: the webhook 404s "not registered for POST
requests" while the node sits plainly on the canvas.

Confirm it took: `GET /workflows/{id}` should show
`versionId === activeVersionId`.

## 7. Point Meta at your webhook

App Dashboard → **Use cases → Connect on WhatsApp → Step 2. Production setup →
Configure Webhooks**. (Not a standalone sidebar item, whatever `context/02` §4
implies.)

- Callback URL: `<your ngrok URL>/webhook/whatsapp`
- Verify token: your `WEBHOOK_VERIFY_TOKEN`

Meta calls the GET handshake immediately. If it fails, the URL won't save.

**Then check the `messages` field is subscribed.** Meta auto-subscribes several
fields on save (`account_update`, `calls`, `message_template_quality_update`)
but **not** `messages` — tick it manually.

## 8. Test

### Normal loop — no Meta, no phone

```bash
npm run test:webhook
```

POSTs three fake payloads at `http://localhost:5678/webhook/whatsapp`: a text
message, a delivery-status update, and an image message.

**The script only prints `OK`.** The real result is in **n8n → Executions**:

- text payload → parses all five fields, runs the full chain
- status payload → stops at the `If1` guard without parsing
- image payload → `message_text: null`, gets the fixed "text messages only"
  reply, never calls DeepSeek

Then **delete the synthetic rows** from `messages` and `assistant_runs`. The
bot feeds the last 10 stored messages to DeepSeek as history, so test junk
becomes the AI's memory. The fakes use `447700900123`.

### Real end-to-end

Text your test number from your handset. You should get a DeepSeek answer back
within seconds, plus an `in` row, an `out` row, and an `assistant_runs` row at
`status: completed` with token counts.

Then ask a follow-up that depends on the previous answer — that proves
`Log outbound` → `Load history` actually closes the memory loop.

---

## Restarting later

n8n and ngrok are foreground processes, not services. Laptop sleeps or terminal
closes, they die.

```bash
n8n start                                          # terminal 1
npx ngrok http 5678 --authtoken <NGROK_AUTHTOKEN>  # terminal 2
```

Your workflow and credentials live in `~/.n8n` and survive restarts. With a
reserved ngrok domain the URL is stable, so nothing needs re-pointing in Meta.
Without one, the URL changes and you must update the Meta webhook config and
re-verify every time.

---

## If something doesn't work

1. **n8n → Executions.** Open the failed run, click the failing node, read its
   real input and output. This answers most questions.
2. Re-run the relevant `npm run verify:*`. If it passes, the service and
   credentials are fine — the problem is in the workflow.
3. [LESSONS-LEARNED.md](LESSONS-LEARNED.md) — traps actually hit here, in full.
4. `context/06-gotchas.md` — 19 known symptoms.
5. `answers/06-gotchas-full.md` — the answer key. Form a diagnosis first; the
   point of the exercise is learning to read the evidence.

**Nothing arrives at all** is usually not a workflow problem — go back to the
`subscribed_apps` check in step 3.

**A send returns 200 but never lands** is the 24-hour window — text the bot
from your handset first.
