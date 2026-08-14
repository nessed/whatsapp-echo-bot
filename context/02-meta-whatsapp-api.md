# 02 — Meta WhatsApp Cloud API

The most important file in this project. Most of the ways P1 fails originate here.

> **On accuracy:** Meta renames dashboard sections and moves menu items regularly, and the docs lag the UI. Endpoint shapes and payload structures below are stable and reliable. Menu paths and button labels are best-effort — if a path doesn't match what you see, the section is probably one level up or renamed, not gone. Anything marked **VERIFY** should be checked against the live dashboard or current docs rather than trusted.

---

## 1. Create the Meta developer app

1. Go to `developers.facebook.com` and sign in with a Facebook account. There's no separate developer login.
2. **My Apps > Create App.**
3. Choose app type **Business**. This matters — other types don't expose the WhatsApp product, and you can't change type after creation.
4. Give it a name and a contact email. Attaching a Business Portfolio (formerly "Business Manager account") is either requested here or prompted later. You need one eventually for the System User token in step 3, so create one now if you don't have one.
5. On the app dashboard, find **WhatsApp** in the product list and click **Set up**.

Adding the WhatsApp product auto-provisions two things: a test phone number, and a WhatsApp Business Account (WABA) to hold it. Both are free and neither requires business verification.

**VERIFY:** Meta has been consolidating "Business type" app creation into a use-case-driven flow ("What do you want your app to do?" → select messaging/WhatsApp). If you see the use-case picker instead of the type list, pick the WhatsApp/messaging option — it produces an equivalent Business app.

---

## 2. Test number and test recipients

After setup, go to **App Dashboard > WhatsApp > API Setup** (sometimes labelled "Getting Started" or "Quickstart").

On that page:

- **From** dropdown — the Meta-provided test number. Directly under it is the **Phone number ID**, a long numeric string. That ID, not the phone number, is what goes in `META_PHONE_NUMBER_ID` and into the send endpoint URL. Confusing the two is a common early mistake.
- **WhatsApp Business Account ID** — also shown here. Not needed for P1 but note it; it's the parent object for template management in P2.
- **To** dropdown — recipient numbers. Click **Manage phone number list** (or **Add phone number**) and add your personal number in full international format with no `+`, no spaces, no dashes. Example: a UK number becomes `447700900123`.

You'll get a WhatsApp verification code on that phone. Enter it. The number is now a registered test recipient.

### Hard limits on the test number

- **Maximum 5 test recipient numbers.** You cannot exceed this without moving to a verified production number.
- **The bot can only message registered testers.** Sending to any other number returns an error even with a perfectly valid token. If you're debugging a send failure, confirm the recipient is on the list before suspecting anything else.
- The test number gets a free allowance of business-initiated conversations per month. User-initiated replies (which is all P1 does) are not the constrained resource here, so this won't bite in P1.

---

## 3. Permanent access token — do this before anything else

**The token displayed on the API Setup page expires in 24 hours.** It's a temporary user access token meant for a five-minute smoke test. If you build the whole workflow with it, everything works, you go to bed, and the next morning every send call returns a 401 with an OAuth error — and it looks exactly like your workflow broke.

Get a permanent System User token instead. This is the single most valuable 10 minutes in the project.

### Steps

1. Go to **business.facebook.com/settings** (Business Settings for your Business Portfolio). This is a different site from the app dashboard — it's a common point of confusion.
2. In the left sidebar, **Users > System Users**.
3. **Add** — name it something like `whatsapp-bot-system-user`. Role: **Admin** is simplest for a practice project. **Employee** works too but you'll need to grant asset access explicitly.
4. With the system user selected, click **Add Assets** (or **Assign Assets**).
   - Under **Apps**, select your app, enable **Manage app** (full control).
   - Under **WhatsApp Accounts**, select your WABA, enable full control.
   - Missing this assignment step is why "I generated a token and it still 401s" happens. The token has to be scoped to assets it can actually see.
5. Click **Generate New Token**.
   - Select your app from the dropdown.
   - Set **Token expiration** to **Never**.
   - Check these permissions:
     - `whatsapp_business_messaging` — required to send messages
     - `whatsapp_business_management` — required to manage phone numbers, templates, and WABA settings
   - Generate.
6. **Copy the token immediately.** It is shown once and never again. Paste it straight into `.env` as `META_ACCESS_TOKEN`. If you lose it, generate a new one — there's no recovery.

### Confirming the token is actually permanent

Call the debug endpoint:

```bash
curl -s "https://graph.facebook.com/debug_token?input_token=$META_ACCESS_TOKEN&access_token=$META_ACCESS_TOKEN"
```

In the response, `data.expires_at` should be `0` (meaning never). `data.scopes` should include both WhatsApp permissions. If `expires_at` is a real Unix timestamp, you generated a temporary token — go back and set expiration to Never.

---

## 4. Webhook configuration and the verification handshake

### Configuring

In **App Dashboard > WhatsApp > Configuration** (**VERIFY** — may be nested under the WhatsApp product menu as "Webhooks"):

- **Callback URL** — the public HTTPS URL of your n8n webhook.
- **Verify token** — the arbitrary string you chose for `WEBHOOK_VERIFY_TOKEN`. Meta doesn't generate this; you invent it and paste the same value both places.
- Click **Verify and save**. Meta immediately sends a GET request. If your endpoint doesn't respond correctly, saving fails with a generic error and gives you almost no diagnostic detail.
- After saving, click **Manage** next to Webhook fields and **subscribe to the `messages` field**. Without this subscription the handshake passes but no message events are ever delivered. This is an easy step to skip because the config screen looks complete without it.

### The handshake itself

Meta sends a GET to your callback URL with three query parameters:

```
GET /your-webhook-path?hub.mode=subscribe
                      &hub.verify_token=YOUR_VERIFY_TOKEN
                      &hub.challenge=1158201444
```

Your endpoint must:

1. Check `hub.mode === "subscribe"`.
2. Compare `hub.verify_token` against your stored `WEBHOOK_VERIFY_TOKEN`.
3. If both match, respond **200** with the raw value of `hub.challenge` **as plain text**, and nothing else.
4. If they don't match, respond **403**.

Things that break this:

- Returning the challenge wrapped in JSON (`{"challenge": "1158201444"}`). Meta wants the bare string. This fails silently — you get "verification failed" with no explanation.
- Returning it as a number rather than a string. Echo back exactly what arrived.
- Adding whitespace, a newline, or an HTML wrapper.
- The parameter names contain dots. In n8n expressions and many frameworks, `query.hub.mode` is parsed as nested object access and returns undefined. Use bracket notation: `$json.query['hub.mode']`, `$json.query['hub.verify_token']`, `$json.query['hub.challenge']`. **This is the single most common reason the handshake fails in n8n.**

Meta will also re-send this GET periodically to confirm the endpoint is still alive. The handler needs to stay in place permanently, not just during initial setup.

---

## 5. Inbound message payload

Meta POSTs to the same URL used for the handshake. The nesting is deep and every level is an array.

### Full example — inbound text message

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550559999",
              "phone_number_id": "106540352242922"
            },
            "contacts": [
              {
                "profile": {
                  "name": "Ali"
                },
                "wa_id": "447700900123"
              }
            ],
            "messages": [
              {
                "from": "447700900123",
                "id": "wamid.HBgLNDQ3NzAwOTAwMTIzFQIAEhggQzY5RUY2NTk5MEFCNzE0M0Y4NTBFRTdBRUJDNDJEMDIA",
                "timestamp": "1754212800",
                "text": {
                  "body": "hello there"
                },
                "type": "text"
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

### The path to what you need

```
entry[0].changes[0].value.messages[0].from        →  sender's number (no + prefix)
entry[0].changes[0].value.messages[0].id          →  wamid, the WhatsApp message ID
entry[0].changes[0].value.messages[0].timestamp   →  Unix seconds, as a STRING
entry[0].changes[0].value.messages[0].text.body   →  the message text
entry[0].changes[0].value.messages[0].type        →  "text", "image", "audio", ...
entry[0].changes[0].value.contacts[0].profile.name →  display name (may be absent)
entry[0].changes[0].value.metadata.phone_number_id →  YOUR number's ID, not the sender's
```

Notes that cost time if missed:

- `messages[0].text.body` only exists when `type === "text"`. An image message has `image` instead of `text` and no `.body` anywhere. Check `type` before reading.
- `timestamp` is a string containing Unix seconds. Multiply by 1000 before constructing a JS Date.
- `entry` and `changes` are arrays because Meta may batch. In practice for a single test number you'll see one of each, but writing `entry[0]` is an assumption — a defensive parser iterates.
- `from` has no `+` prefix. The send API also expects no `+`. Keep the format consistent everywhere so log queries actually match.

### Status update payloads — the one that crashes naive parsers

Delivery receipts arrive at the **same webhook URL** with the **same top-level shape**, but `value` contains `statuses` instead of `messages`:

```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "102290129340398",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "metadata": {
              "display_phone_number": "15550559999",
              "phone_number_id": "106540352242922"
            },
            "statuses": [
              {
                "id": "wamid.HBgLNDQ3NzAwOTAwMTIzFQIAERgSN0EyOEJDNzcyM0JGRUJBQjE5AA==",
                "status": "delivered",
                "timestamp": "1754212805",
                "recipient_id": "447700900123",
                "conversation": {
                  "id": "b8c3f0e1a2d4f5b6c7d8e9f0a1b2c3d4",
                  "origin": { "type": "service" }
                },
                "pricing": {
                  "billable": true,
                  "pricing_model": "CBP",
                  "category": "service"
                }
              }
            ]
          },
          "field": "messages"
        }
      ]
    }
  ]
}
```

Note that `field` is still `"messages"`. You cannot filter on `field`.

**Every outbound message generates two or three of these** — `sent`, then `delivered`, then `read` if the user opens it. Each one hits your webhook. A parser that reaches straight for `value.messages[0].text.body` will get undefined and either crash or write a garbage row.

**The guard:** before processing, check that `entry[0].changes[0].value.messages` exists and is a non-empty array. If not, return 200 immediately and stop. Returning 200 matters — a non-2xx makes Meta retry the delivery.

There's also an `errors` array that can appear in `value` for delivery failures. Same treatment: not a message, don't parse it as one.

---

## 6. Sending a message

### Endpoint

```
POST https://graph.facebook.com/{API_VERSION}/{PHONE_NUMBER_ID}/messages
```

`{PHONE_NUMBER_ID}` is `META_PHONE_NUMBER_ID` — your test number's ID, not the recipient's.

### Headers

```
Authorization: Bearer {META_ACCESS_TOKEN}
Content-Type: application/json
```

### Body — text message

```json
{
  "messaging_product": "whatsapp",
  "recipient_type": "individual",
  "to": "447700900123",
  "type": "text",
  "text": {
    "preview_url": false,
    "body": "echo: hello there"
  }
}
```

`messaging_product` is mandatory and must be exactly `"whatsapp"`. Omitting it returns an unhelpful error. `recipient_type` defaults to `individual` and can be left out, but being explicit costs nothing.

`preview_url: true` makes WhatsApp render a link preview for any URL in the body. Leave it false for echo.

### Full curl for the isolation test in build step 1

```bash
curl -X POST "https://graph.facebook.com/v25.0/${META_PHONE_NUMBER_ID}/messages" \
  -H "Authorization: Bearer ${META_ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "to": "447700900123",
    "type": "text",
    "text": { "body": "credential test" }
  }'
```

### Success response

```json
{
  "messaging_product": "whatsapp",
  "contacts": [
    { "input": "447700900123", "wa_id": "447700900123" }
  ],
  "messages": [
    { "id": "wamid.HBgLNDQ3NzAwOTAwMTIzFQIAERgSN0EyOEJDNzcyM0JGRUJBQjE5AA==",
      "message_status": "accepted" }
  ]
}
```

`messages[0].id` is the wamid for the outbound message. **Capture it and store it in the `wa_message_id` column of the outbound row.** It's what lets you join a sent message to its later delivery-status webhooks — that correlation is the actual point of the logging exercise.

`message_status: "accepted"` means Meta took it, not that it was delivered. Delivery confirmation arrives later via webhook.

### Common error responses

| HTTP | Meaning | Fix |
|---|---|---|
| 401 | Token invalid or expired | You're on the 24-hour temp token. Generate a System User token. |
| 400, code 100 | Malformed body / bad param | Usually a missing `messaging_product` or a `to` with a `+` or spaces |
| 400, code 131030 | Recipient not in allowed list | Add the number as a test recipient |
| 400, code 131047 | Outside 24-hour window | Free-form send blocked; requires a template. Shouldn't hit this in P1. |
| 403 | Permission missing | Token lacks `whatsapp_business_messaging`, or the system user has no asset access to the WABA |
| 429 | Rate limited | Back off |

Meta error bodies nest the useful part at `error.message` and `error.error_data.details`. The top-level message is often generic; `details` is where the real reason lives. Log the whole error object.

---

## 7. The 24-hour session window

The rule: once a user sends your business a message, a **24-hour customer service window** opens. Inside it you can send free-form messages of any type. Outside it, free-form sends are rejected (error 131047) and the only way to reach the user is a **pre-approved template message**.

Each new inbound message from the user resets the 24-hour clock.

**Why P1 doesn't care:** the echo bot only ever replies to a message that just arrived. The window opened milliseconds ago. It's structurally impossible for the echo to fall outside it.

**Why P2 depends entirely on it:** a COD order confirmation bot initiates contact. The customer places an order on a website and hasn't messaged WhatsApp at all — there is no open window. That first outbound message *must* be a template. Consequences:

- Templates require submission to Meta and **approval before use**, typically minutes to hours, occasionally longer, and rejections happen for vague or promotional-sounding copy.
- Template content is fixed at approval time. Only designated `{{1}}`, `{{2}}` variable slots can change per send. You cannot compose the message freely at runtime.
- Templates are categorised (`utility`, `marketing`, `authentication`) and the category drives both pricing and approval strictness. An order confirmation is `utility`.
- Once the customer replies to the template, the 24-hour window opens and free-form conversation works normally.

Practical implication for P2's architecture: any flow that might send a message more than 24 hours after the last inbound one needs a template path as well as a free-form path, plus logic to decide which to use. That decision needs the message log this project is building — you can't know when the window opened without knowing when the last inbound message arrived. **This is the real reason P1 logs timestamps.**

---

## 8. API version

Use `v25.0` unless there's a reason not to. It shipped February 2026 and was the current version as of mid-2026.

**VERIFY before building** at `https://developers.facebook.com/docs/graph-api/changelog` — Meta ships a new version roughly quarterly, and v26.0 was expected around September 2026.

How versioning works here:

- Versions are pinned in the URL path: `https://graph.facebook.com/v25.0/...`.
- Each version is supported for roughly two years from release, then sunsets. Calls to a sunset version get silently upgraded to the oldest supported one, which can change behaviour without any error.
- Omitting the version from the URL routes to the oldest supported version — not the newest. Never omit it.
- WhatsApp Cloud API is stable across recent versions for basic text send/receive. Nothing in this project is version-sensitive. But pin it anyway, in `META_API_VERSION`, so upgrading later is a one-line change rather than a grep.

---

## 9. Webhook payload signature verification

Meta signs every webhook POST with an `X-Hub-Signature-256` header:

```
X-Hub-Signature-256: sha256=<hex digest>
```

The digest is HMAC-SHA256 of the **raw request body** using `META_APP_SECRET` as the key. To verify, compute the HMAC yourself and compare with a constant-time comparison.

Two things that make this fiddly: it must be computed over the raw bytes before any JSON parsing (re-serialising the parsed object changes whitespace and breaks the digest), and n8n's webhook node parses the body by default, so getting at the raw bytes requires configuration.

**Optional for P1.** Worth doing in P2 — without it, anyone who learns your webhook URL can POST fake messages at it. Noting it here so it's a known deliberate omission rather than an oversight.
