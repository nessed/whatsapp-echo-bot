# 07 — DeepSeek WhatsApp Assistant (manual n8n build)

Use this after inbound logging is working. Build the nodes manually in the
existing POST-message branch; do not paste the DeepSeek key into a node field or
workflow JSON.

## 1. Create the DeepSeek credential

**Superseded 2026-08-15:** use n8n's native **DeepSeek** credential type instead
of HTTP Header Auth (this n8n version ships one — search "DeepSeek", not
"Header Auth"). It has a single `API Key` field. Confirmed from source
(`DeepSeekApi.credentials.js`) that it's mechanically identical to HTTP Header
Auth — `authenticate.type: 'generic'`, sets `Authorization: Bearer {{apiKey}}`
— just with n8n adding the `Bearer ` prefix for you. When building the
`DeepSeek chat` HTTP Request node in §5, use Authentication → Predefined
Credential Type → this credential.

<details>
<summary>Original instructions (HTTP Header Auth) — kept for reference, not needed if the native type is available</summary>

In n8n, create an **HTTP Header Auth** credential named `DeepSeek API`:

- Name: `Authorization`
- Value: `Bearer <your replacement DEEPSEEK_API_KEY>`

</details>

Save it. n8n encrypts the credential; the workflow export should reference only
the credential ID/name, never the secret.

## 2. Put the new branch after inbound logging

Start at the output of `Respond OK (msg)` (see the note below — the responder
ended up mid-chain, not at the end). Keep `Respond OK (status)` unchanged.
The message branch needs these decisions in this order:

```text
Log inbound → Allowed Sender? → text message?
  allowed + text → Claim assistant run → Claim succeeded?
    yes → Load history → Build request → DeepSeek → Send Meta reply → Log out → Complete run
    no  → stop
  allowed + non-text → Send text-only reply → Log out
  blocked sender → stop
```

**Note (as actually built, 2026-08-18) — the Respond node fires early, so the
downstream branches do not each need one.** The diagram above originally ended
every branch in its own Respond to Webhook node. In the real workflow
`Respond OK (msg)` sits *before* `Allowed Sender`:

```text
Webhook1 → If1 → Edit Fields → Log to Supabase → Respond OK (msg) → Allowed Sender → text message → …
```

Meta's HTTP 200 is therefore already sent before any assistant logic runs, so
`Allowed Sender` false, `text message` false, `Claim succeeded` false and the
whole DeepSeek path need **no** Respond to Webhook node of their own. This is a
deliberate deviation from the diagram, and a desirable one: Meta gets its 200
fast no matter how slow DeepSeek is. The step-5 rule (a `responseNode` webhook
refuses to run a branch with no responder) is satisfied by that single early
Respond node covering the whole message branch.

After editing, use the Publish control; saved draft changes are not live.

## 3. Add the sender and text guards

Add an IF node named `Allowed Sender` after `Respond OK (msg)` (see the §2 note —
the responder now sits mid-chain):

- Left value: `={{ $('Edit Fields').item.json.from_number }}` — Expression mode
- Operation: string equals
- Right value: your digits-only `ALLOWED_WHATSAPP_NUMBER` — **Fixed** mode

On the true branch, add `text message`:

- Left value: `={{ $('Edit Fields').item.json.message_type }}` — Expression mode
- Operation: string equals
- Right value: `text` — **Fixed** mode

**Why `$('Edit Fields')` and not `$json`.** `$json` only ever means "whatever the
immediately-previous node emitted." `Log to Supabase` sends
`Prefer: resolution=ignore-duplicates` without `return=representation`, so
Supabase answers 201 with an **empty body** — the HTTP Request node outputs `{}`,
and `Respond OK (msg)` passes that empty object straight through. Confirmed from
a real execution: `Edit Fields` emitted the five parsed fields,
`Log to Supabase` and `Respond OK (msg)` both emitted `{}`. Written against
`$json.from_number` these guards compare `undefined` and silently never fire
true. Once a chain passes through an HTTP node the parsed fields are gone —
reach back by node name. (`Log to Supabase` already did this correctly for
`raw_payload` via `$('Webhook1').item.json.body`.)

**Warning — Fixed vs Expression mode on the right-hand value.** A parameter
field toggles between Fixed and Expression (small `fx` badge on its left edge).
Expression-mode fields are *always* stored with a leading `=` in the workflow
JSON; that `=` is the mode marker, not something you typed, and retyping the
value can never remove it. Symptom: a right value that keeps saving as `"=text "`
however many times you retype plain `text`. Fix: hover the field and click
**Fixed**. Rule of thumb — a comparison's left side wants Expression mode, its
right side wants Fixed mode when comparing against a constant. The canvas renders
the value and hides the mode, so diagnose by pulling
`GET /api/v1/workflows/{id}` and reading `rightValue` directly. The same applies
to every literal comparison value in this document.

The false branch of `text message` sends this fixed Meta text message to
`$('Edit Fields').item.json.from_number`:

```text
I currently support text messages only.
```

Log that reply to `messages` with `direction: out` exactly as you will log the
DeepSeek reply. Do not call DeepSeek for non-text input.

## 4. Claim the inbound message

Use an HTTP Request node named `Claim assistant run`, authenticated with the
existing Supabase service-role credential. The SQL migration adds an RPC so this
node always receives one result, even when a duplicate was already claimed.

- Method: `POST`
- URL: `{SUPABASE_URL}/rest/v1/rpc/claim_assistant_run`
- JSON body:

```javascript
={{ {
  p_inbound_wa_message_id: $('Edit Fields').item.json.wa_message_id,
  p_from_number: $('Edit Fields').item.json.from_number,
  p_model: 'deepseek-v4-flash'
} }}
```

Add `Claim succeeded` after it. Check `={{ $json.claimed }}` is `true` — `$json`
is correct here because the RPC call directly precedes it and does return a body.
Only the true branch may call DeepSeek. The false branch just stops: the 200 was
already sent by `Respond OK (msg)`, and no second reply goes out.

## 5. Fetch history and call DeepSeek

Fetch the latest 10 non-null messages for the sender from `messages`, newest
first, selecting `direction,message_text,timestamp`. Reverse them before use so
the oldest appears first.

Use a Code node named `Build DeepSeek request` to output exactly one item with:

```javascript
{
  model: 'deepseek-v4-flash',
  thinking: { type: 'disabled' },
  max_tokens: 512,
  messages: [
    { role: 'system', content: 'You are a helpful assistant.' },
    // stored rows: direction=in → role=user; direction=out → role=assistant
  ]
}
```

Use an HTTP Request node named `DeepSeek chat`:

- Method: `POST`
- URL: `https://api.deepseek.com/chat/completions`
- Authentication: the `DeepSeek API` credential
- Send body as JSON: the output of `Build DeepSeek request`
- Enable full response/error details while building.

The reply text is `choices[0].message.content`; usage is in `usage`.

## 6. Send and log the answer

Send `choices[0].message.content` through the same Meta Graph API endpoint used
by the credential smoke-test script. Capture `messages[0].id` from Meta's
response. Insert the outbound row after the send:

- `from_number`: original sender number
- `message_text`: DeepSeek response text
- `direction`: `out`
- `wa_message_id`: Meta response message ID
- `timestamp`: current ISO time
- `raw_payload`: full Meta send response body

Finally PATCH `assistant_runs` by `inbound_wa_message_id`, setting:

- `status: completed`
- `outbound_wa_message_id`: Meta response message ID
- `prompt_tokens`, `completion_tokens`, `total_tokens`: DeepSeek `usage` values
- `completed_at`: current ISO time

## 7. Failure path

For a DeepSeek HTTP error or missing response text, update the claimed row to
`status: failed` with the code/message. Send one fixed WhatsApp message:

```text
I can't respond right now. Please try again later.
```

Log that fallback as an outbound `messages` row, but leave the assistant run as
`failed`. Do not retry automatically. A duplicate webhook must still stop at the
existing claim and return 200. Inspect the HTTP error body before changing any node.
