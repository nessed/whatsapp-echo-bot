# 08 — DeepSeek WhatsApp Assistant: Full Implementation Handoff

## Purpose

Build a private WhatsApp chatbot that behaves like a normal DeepSeek chat:

```text
Ali's phone → Meta WhatsApp webhook → local n8n → DeepSeek API
                                                ↓
Ali's phone ← Meta WhatsApp send API ← n8n ← Supabase history/logs
```

The bot is not a custom agent, RAG system, or business assistant. It uses one
minimal system prompt — `You are a helpful assistant.` — and responds with
DeepSeek's answer. It remembers the most recent ten stored text messages for the
same WhatsApp number.

## Non-negotiable project rules

- **Manual-first:** Ali builds the Supabase and n8n changes himself in the GUI.
  The assisting agent explains exact settings, checks evidence, and makes
  repository/documentation changes only. Do not silently edit the live workflow
  or apply database SQL unless Ali explicitly delegates that exact action.
- **Private test bot:** only `ALLOWED_WHATSAPP_NUMBER` may call DeepSeek. Keep the
  Meta test number; do not make this public or move to a production number.
- **No new recurring spend:** n8n stays local, the existing reserved ngrok tunnel
  is used, and the laptop being off means the bot is off. DeepSeek uses the
  existing prepaid balance only; never add automatic top-ups.
- **Text-only v1:** images, voice notes, documents, reactions, and other non-text
  messages are logged but never sent to DeepSeek. They receive a fixed text-only
  reply.
- **Secrets:** `.env` and n8n's encrypted credentials are local only. Never place
  a real key in `.env.example`, `workflows/*.json`, a script, execution notes, or
  a Git commit.

### Current credential decision

The repository's visible history and templates have been scrubbed of secrets. Ali
has explicitly chosen to keep the present test credentials rather than rotate them
now. Do not repeatedly ask him to rotate while completing this private test build.
Revisit credential rotation before any production/public deployment.

## Current verified state

The following already work and must be preserved:

1. Meta credentials were tested in isolation with
   `scripts/01-verify-meta-credentials.js`.
2. The `public.messages` table exists and was verified through the Supabase REST
   API by `scripts/02-verify-supabase.js`.
3. Local n8n and the stable ngrok URL are reachable by Meta.
4. Meta's GET webhook verification is live and the `messages` subscription is on.
5. The POST path distinguishes actual inbound messages from delivery-status
   callbacks.
6. The `Edit Fields` node extracts `from_number`, `wa_message_id`, `timestamp`,
   `message_text`, and `message_type`.
7. `Log to Supabase` writes inbound rows with duplicate protection.
8. `scripts/04-verify-deepseek.js` returned HTTP 200 using
   `deepseek-v4-flash`; the test used 24 tokens.

The existing workflow currently ends at:

```text
Webhook1 → If1 → Edit Fields → Log to Supabase → Respond OK (msg)
```

The status branch is already correct:

```text
Webhook1 → If1 false → Respond OK (status)
```

Do not disturb the GET verification nodes or the status branch.

## Files that are the source of truth

- `context/05-build-sequence.md` — ordered checklist and completion criteria.
- `context/07-deepseek-whatsapp-assistant.md` — compact node-by-node guide.
- `supabase/002_create_assistant_runs.sql` — manual database migration.
- `scripts/04-verify-deepseek.js` — isolated DeepSeek test.
- `workflows/echo-bot.json` — last exported inbound-only workflow snapshot. It is
  not yet the desired final workflow.
- `LESSONS-LEARNED.md` — n8n traps discovered while building the inbound path.

## Phase 0 — Start the local services

Start n8n and ngrok in separate terminals using the existing local setup. Confirm:

```powershell
curl http://localhost:5678/healthz
curl http://localhost:4040/api/tunnels
```

The n8n editor should load, the ngrok tunnel should point at port 5678, and the
public URL must remain the one registered in Meta. If n8n was edited in the GUI,
remember that a saved draft is not live until it is published.

## Phase 1 — Local environment and DeepSeek verification

The local `.env` must contain, at minimum:

```env
DEEPSEEK_API_KEY=<local secret>
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-flash
DEEPSEEK_MAX_TOKENS=512
ALLOWED_WHATSAPP_NUMBER=<Ali's digits-only WhatsApp number, no +>
```

Verify the API before touching n8n:

```powershell
node --env-file=.env scripts/04-verify-deepseek.js
```

Expected result: HTTP 200, a short reply, and `usage` details. If it fails, solve
the key/model/network error here. Do not debug DeepSeek from inside n8n first.

## Phase 2 — Apply and verify the Supabase migration manually

Open Supabase Dashboard → SQL Editor. Review then run the full contents of
`supabase/002_create_assistant_runs.sql`.

It does four jobs:

1. Enables RLS on the existing `messages` table and removes browser-role access.
2. Creates `assistant_runs`, one row per inbound WhatsApp message.
3. Creates `claim_assistant_run`, a server-only RPC that returns `claimed=true`
   once and `claimed=false` for duplicate webhook deliveries.
4. Grants the n8n service-role credential the limited table/function access it
   needs.

### Manual checks after the migration

Use an existing real inbound row from `messages`:

```sql
select wa_message_id, from_number
from public.messages
where direction = 'in'
order by created_at desc
limit 1;
```

Copy the returned values into this query and run it twice:

```sql
select *
from public.claim_assistant_run(
  '<inbound wamid>',
  '<sender number>',
  'deepseek-v4-flash'
);
```

The first result must be `claimed = true`; the second must be `claimed = false`.
Then remove this manual test row before building the n8n branch, otherwise the
real workflow will treat that inbound message as already claimed:

```sql
delete from public.assistant_runs
where inbound_wa_message_id = '<inbound wamid>';
```

Check RLS and grants in the dashboard. `anon` and `authenticated` must not access
`messages` or `assistant_runs`; the server-side n8n service role must still work.
If the REST API says `permission denied`, check the project's Data API exposure
settings and the explicit `service_role` grants before changing the workflow.

## Phase 3 — Create encrypted n8n credentials manually

Create these in n8n's Credentials UI. Do not type credentials into node fields.

### DeepSeek API

Create **HTTP Header Auth**, name it `DeepSeek API`:

- Header name: `Authorization`
- Header value: `Bearer <DEEPSEEK_API_KEY from local .env>`

### Meta WhatsApp API

Create **HTTP Header Auth**, name it `Meta WhatsApp API`:

- Header name: `Authorization`
- Header value: `Bearer <META_ACCESS_TOKEN from local .env>`

Keep using the existing Supabase credential (`Supabase (messages)`) for all
Supabase REST nodes. If a new credential is necessary, use the service-role key,
not a browser/publishable key.

## Phase 4 — Build the manual n8n message branch

Build after `Log to Supabase` in the true output of `If1`. Remove the direct wire
from `Log to Supabase` to `Respond OK (msg)` only after replacement branches are
wired all the way to a response node.

Final shape:

```text
Log to Supabase
  ↓
Allowed sender?
  ├─ false → Respond OK (blocked)
  └─ true
      ↓
      Text message?
      ├─ false → Send text-only reply → Log text-only reply → Respond OK (media)
      └─ true
          ↓
          Claim assistant run
          ↓
          Claim succeeded?
          ├─ false → Respond OK (duplicate)
          └─ true
              ↓
              Load conversation → Build DeepSeek request → DeepSeek chat
                ├─ success → Send DeepSeek reply → Log outbound reply
                │             → Complete assistant run → Respond OK (message)
                └─ error   → Mark assistant failed → Send fallback reply
                              → Log fallback reply → Respond OK (failure)
```

Every terminal route needs a Respond to Webhook node returning status 200 and a
short `OK` body. This is mandatory because `Webhook1` is in “respond via node”
mode.

### 4.1 `Allowed sender` IF node

Create an IF node named `Allowed sender`.

- Left value expression: `={{ $json.from_number }}`
- Operation: `equals`
- Right value: Ali's digits-only allowed WhatsApp number from `.env`

Do not call DeepSeek for the false path. It only responds 200 to Meta. In this
test-number project other users should not normally reach the bot anyway.

### 4.2 `Text message` IF node

Create an IF node named `Text message` on the true output.

- Left value expression: `={{ $json.message_type }}`
- Operation: `equals`
- Right value: `text`

False route:

1. Add `Send text-only reply`, an HTTP Request to the Meta send endpoint.
2. Send this body to the original sender:

   ```json
   {
     "messaging_product": "whatsapp",
     "recipient_type": "individual",
     "to": "<original sender>",
     "type": "text",
     "text": {
       "preview_url": false,
       "body": "I currently support text messages only."
     }
   }
   ```

3. Use the `Meta WhatsApp API` credential.
4. Log the resulting outbound wamid to `messages`, then respond 200.

### 4.3 `Claim assistant run` HTTP Request

Create an HTTP Request node named `Claim assistant run`:

- Method: `POST`
- URL: `{SUPABASE_URL}/rest/v1/rpc/claim_assistant_run`
- Authentication: existing Supabase service-role credential
- Send Body: JSON
- Body expression:

```javascript
={{ {
  p_inbound_wa_message_id: $('Edit Fields').item.json.wa_message_id,
  p_from_number: $('Edit Fields').item.json.from_number,
  p_model: 'deepseek-v4-flash'
} }}
```

This RPC returns one item whose `claimed` field is a Boolean. It exists because a
plain `INSERT ... ON CONFLICT DO NOTHING` can produce no n8n item on duplicates,
which would leave the webhook branch without a response node.

### 4.4 `Claim succeeded` IF node

- Left value: `={{ $json.claimed }}`
- Operation: `is true`

False means a duplicate delivery: connect it directly to `Respond OK (duplicate)`.
True continues to the history query.

### 4.5 `Load conversation` HTTP Request

Create `Load conversation` using the Supabase credential.

- Method: `GET`
- URL: `{SUPABASE_URL}/rest/v1/messages`
- Query parameters:
  - `from_number` = `eq.{{ $('Edit Fields').item.json.from_number }}`
  - `message_text` = `not.is.null`
  - `select` = `direction,message_text,timestamp`
  - `order` = `timestamp.desc`
  - `limit` = `10`

This includes the newly logged inbound text. The response is newest-first, so the
next node reverses it before DeepSeek sees it.

### 4.6 `Build DeepSeek request` Code node

Set mode to **Run Once for All Items**. Paste this code:

```javascript
const history = $input
  .all()
  .map((item) => item.json)
  .filter((row) => typeof row.message_text === 'string' && row.message_text.length > 0)
  .reverse();

return [{
  json: {
    deepseek_request: {
      model: 'deepseek-v4-flash',
      thinking: { type: 'disabled' },
      max_tokens: 512,
      messages: [
        { role: 'system', content: 'You are a helpful assistant.' },
        ...history.map((row) => ({
          role: row.direction === 'in' ? 'user' : 'assistant',
          content: row.message_text,
        })),
      ],
    },
  },
}];
```

Before wiring DeepSeek, execute this node from a fake text payload and inspect the
output. It must contain one `deepseek_request` object with chronological messages:
oldest first, newest inbound text last.

### 4.7 `DeepSeek chat` HTTP Request

Create `DeepSeek chat`:

- Method: `POST`
- URL: `https://api.deepseek.com/chat/completions`
- Authentication: `DeepSeek API`
- Send Body: JSON
- Body expression: `={{ $json.deepseek_request }}`
- While building, enable full response/error details.
- In the node error settings, use **Continue (using error output)** so its error
  path can mark the run failed and still return Meta an HTTP 200.

Expected successful response fields:

```text
choices[0].message.content
usage.prompt_tokens
usage.completion_tokens
usage.total_tokens
```

Never expose DeepSeek's internal reasoning in WhatsApp; only send
`choices[0].message.content`.

### 4.8 `Send DeepSeek reply` HTTP Request

Create `Send DeepSeek reply` with `Meta WhatsApp API`:

- Method: `POST`
- URL: `https://graph.facebook.com/<META_API_VERSION>/<META_PHONE_NUMBER_ID>/messages`
- JSON body expression:

```javascript
={{ {
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to: $('Edit Fields').item.json.from_number,
  type: 'text',
  text: {
    preview_url: false,
    body: $('DeepSeek chat').item.json.choices[0].message.content
  }
} }}
```

Meta returns the outbound WhatsApp ID at `messages[0].id`.

### 4.9 `Log outbound reply` HTTP Request

Use the same direct Supabase REST pattern as the working inbound logger:

- Method: `POST`
- URL: `{SUPABASE_URL}/rest/v1/messages?on_conflict=wa_message_id`
- Header: `Prefer: resolution=ignore-duplicates`
- Authentication: Supabase service-role credential
- JSON body expression:

```javascript
={{ {
  from_number: $('Edit Fields').item.json.from_number,
  message_text: $('DeepSeek chat').item.json.choices[0].message.content,
  direction: 'out',
  wa_message_id: $('Send DeepSeek reply').item.json.messages[0].id,
  timestamp: new Date().toISOString(),
  raw_payload: $('Send DeepSeek reply').item.json
} }}
```

### 4.10 `Complete assistant run` HTTP Request

- Method: `PATCH`
- URL: `{SUPABASE_URL}/rest/v1/assistant_runs?inbound_wa_message_id=eq.{{ $('Edit Fields').item.json.wa_message_id }}`
- Authentication: Supabase service-role credential
- JSON body expression:

```javascript
={{ {
  status: 'completed',
  outbound_wa_message_id: $('Send DeepSeek reply').item.json.messages[0].id,
  prompt_tokens: $('DeepSeek chat').item.json.usage.prompt_tokens,
  completion_tokens: $('DeepSeek chat').item.json.usage.completion_tokens,
  total_tokens: $('DeepSeek chat').item.json.usage.total_tokens,
  completed_at: new Date().toISOString()
} }}
```

Then connect to `Respond OK (message)`.

### 4.11 DeepSeek failure route

From the `DeepSeek chat` error output:

1. PATCH `assistant_runs` for the original inbound ID:
   - `status: failed`
   - `error_code`: HTTP status or a short internal code
   - `error_message`: safe error summary, not credentials
2. Send this exact fallback through Meta:

   ```text
   I can't respond right now. Please try again later.
   ```

3. Log that fallback as an outbound `messages` row.
4. Return HTTP 200 to Meta.

Do not automatically retry a failed DeepSeek call. The next message from Ali is a
new request; a duplicate delivery of the failed request must stop at the claim.

## Phase 5 — Publish and test incrementally

After **every** node change:

1. Save the draft.
2. Publish/activate it.
3. Send a fake payload or a real test message.
4. Inspect node-by-node execution data before adding the next node.

Minimum acceptance tests:

1. Run `scripts/04-verify-deepseek.js` — HTTP 200.
2. Use `scripts/03-post-fake-payload.js` — inbound parsing/logging still works.
3. Test `Allowed sender` false — it returns 200 and does not call DeepSeek.
4. Test a fake image payload — it sends the text-only reply and does not call
   DeepSeek.
5. Test a fake text payload — one DeepSeek request, one Meta send, one inbound
   message row, one outbound message row, and one completed assistant-run row.
6. Send a real short question from Ali's phone — DeepSeek reply appears in WhatsApp.
7. Send a follow-up — response demonstrates the previous exchange was included.
8. Post the same fake text payload twice — only one assistant run and one outbound
   reply exist.
9. Temporarily use an invalid DeepSeek credential — failed run and fallback reply,
   no retry loop. Restore the credential immediately after the test.
10. Check status callbacks — they terminate at `If1` false without calling DeepSeek
    or creating new rows.

Useful database checks:

```sql
select direction, message_text, timestamp
from public.messages
where from_number = '<Ali number>'
order by timestamp desc
limit 20;

select inbound_wa_message_id, status, model, total_tokens, outbound_wa_message_id,
       error_code, created_at, completed_at
from public.assistant_runs
order by created_at desc
limit 20;
```

## Phase 6 — Export and commit the finished manual workflow

Only after all tests pass:

1. Export the current workflow from n8n to `workflows/echo-bot.json`.
2. Inspect the JSON before committing. It may reference encrypted credential IDs,
   but must not contain `Bearer`, a DeepSeek key, Meta token, Supabase service-role
   key, or any raw secret.
3. Update the completed-step checklist in `CLAUDE.md` and add unexpected behavior
   to `LESSONS-LEARNED.md`.
4. Commit and push the export and documentation changes.

## Handoff behavior for another Claude

When resuming this repository, the next live task is **Phase 2** unless Ali says
he already ran the migration. Ask for the Supabase SQL result, then proceed one
manual n8n node at a time. Do not skip verification, deploy paid hosting, add
public users, replace the workflow through the API, or use/install a new service
without Ali explicitly asking.
