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

Start at the output of `Log to Supabase`. Keep `Respond OK (status)` unchanged.
The message branch needs these decisions in this order:

```text
Log inbound → Allowed sender? → Text message?
  allowed + text → Claim assistant run → Claim succeeded?
    yes → Load history → Build request → DeepSeek → Send Meta reply → Log out → Complete run → Respond 200
    no  → Respond 200
  allowed + non-text → Send text-only reply → Log out → Respond 200
  blocked sender → Respond 200
```

Every terminal branch must reach a Respond to Webhook node. After editing, use the
Publish control; saved draft changes are not live.

## 3. Add the sender and text guards

Add an IF node named `Allowed sender` after `Log to Supabase`:

- Left value: `={{ $json.from_number }}`
- Operation: equals
- Right value: your digits-only `ALLOWED_WHATSAPP_NUMBER`

On the true branch, add `Text message`:

- Left value: `={{ $json.message_type }}`
- Operation: equals
- Right value: `text`

The false branch of `Text message` sends this fixed Meta text message to
`$json.from_number`:

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

Add `Claim succeeded` after it. Check `={{ $json.claimed }}` is `true`. Only the
true branch may call DeepSeek. The false branch returns HTTP 200 without sending
a second reply.

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
