# 06 — Gotchas (full version, with causes and fixes)

**Answer key. Don't open this first.**

`context/06-gotchas.md` lists the same 19 failures by symptom only, in the same order and with the same numbers. The intent is that you diagnose from the symptom, form a theory, test it, and only then come here to check whether you were right.

That order matters. Reading a cause you never had to hunt for produces recognition, not recall — you'll nod along and then fail to spot the same thing in P2. Working it out yourself and being wrong is what makes it stick.

Reasonable times to open this file:

- you've had a real go and you're stuck
- you think you've found it and want to check
- you fixed it and want to know whether your explanation was the actual reason

Not a reasonable time: the moment something breaks.

Numbers here match `context/06-gotchas.md` exactly, so #6 there is #6 here.

---

Known failure modes.

---

## 1. The default access token expires in 24 hours

**Symptom:** everything worked yesterday. Today every send returns 401 with an OAuth error. Nothing in your code changed.

**Cause:** the token shown on the App Dashboard's WhatsApp API Setup page is a temporary user token with a 24-hour life. It's meant for a first smoke test only.

**Fix:** generate a permanent System User token per `02-meta-whatsapp-api.md` §3. Verify with the `debug_token` call — `expires_at` must be `0`.

**Why it's nasty:** the failure arrives on a delay and looks like a code regression. You'll suspect your workflow first because that's what you touched last. Do the permanent token in step 1 and this never happens.

---

## 2. The test number can only message pre-registered testers

**Symptom:** sends to your own number work fine. Sending to a friend's number to demo it returns error 131030 or a generic recipient error.

**Cause:** Meta's free test number is restricted to numbers explicitly added to the recipient list. Maximum five.

**Fix:** add the number under WhatsApp > API Setup > Manage phone number list. It receives a verification code that has to be entered. There's no way around the limit without business verification and a production number.

**Also:** a number added to the list but not yet verified will fail the same way as one that isn't on the list.

---

## 3. Localhost will never work for Meta webhooks

**Symptom:** webhook verification fails with an unhelpful error and no detail about why.

**Cause:** Meta's servers make an outbound HTTPS request from the public internet to your callback URL. `localhost`, `127.0.0.1`, private LAN IPs, plain HTTP, and self-signed certificates are all unreachable or rejected.

**Fix:** ngrok, Cloudflare Tunnel, or a deployed instance. See `03-n8n-setup.md`.

**Related:** if n8n shows you a webhook URL containing `localhost`, `WEBHOOK_URL` isn't set on the container. You can copy that URL into Meta but it will never work.

**Also related:** ngrok free-tier URLs change on every restart, and each change requires re-doing Meta's webhook config and handshake.

---

## 4. Meta sends both GET and POST to the same URL

**Symptom:** verification passes but no messages ever arrive. Or messages work but re-verification fails later.

**Cause:** one URL, two completely different behaviours. GET is the verification handshake and expects the bare `hub.challenge` echoed back as plain text. POST is message delivery and expects a 200 with any body. A handler that only implements one silently fails the other.

**Fix:** the Webhook node must accept both methods on the same path, with branching logic on the method.

**Note:** Meta re-sends the GET handshake periodically, not just at setup. The GET branch has to stay working forever, not just long enough to click "Verify and save."

---

## 5. The payload nesting is deep and easy to mis-parse

**Symptom:** `undefined` where the message text should be, or rows with null `message_text`.

**Cause:** the path is `entry[0].changes[0].value.messages[0].text.body`. Six levels, three of them arrays. Every intermediate level is a place to typo or to forget an index.

**Fix:** copy the exact path table from `02-meta-whatsapp-api.md` §5 rather than typing it from memory. Log the full incoming payload during development so you can compare against what you're reaching for.

**Specific traps:**

- `text.body` only exists when `type === "text"`. Image messages have `image` instead. Check `type` first.
- `timestamp` is a **string** of Unix **seconds**. Forgetting `* 1000` puts every row in 1970.
- `from` has no `+` prefix, and the send API also expects none. Adding one somewhere and not elsewhere means your log queries silently don't match.
- `contacts[0].profile.name` can be absent depending on the user's privacy settings. Don't require it.
- `entry` and `changes` are arrays because Meta can batch multiple events. Writing `[0]` is an assumption that usually holds for one test number but isn't guaranteed.

---

## 6. Status update webhooks arrive on the same endpoint and crash naive parsers

**The most likely thing to break this project.**

**Symptom:** the echo works, then n8n shows a burst of failed executions immediately after. Or garbage rows appear with null fields. Or the flow tries to echo something that was never a message.

**Cause:** every outbound message generates delivery-status webhooks — `sent`, then `delivered`, then `read` if the user opens it. They hit the same URL with the same top-level structure, but `value` contains `statuses` instead of `messages`. And `field` is still `"messages"`, so you can't filter on that.

One echo therefore produces two to three extra POSTs to your endpoint, each of which a naive parser treats as an incoming message.

**Fix:** guard before parsing:

```
if (!entry?.[0]?.changes?.[0]?.value?.messages?.length) → return 200, stop
```

Return 200, not an error. A non-2xx makes Meta retry, which multiplies the problem.

**Also:** `value` can contain an `errors` array for delivery failures. Same guard handles it. Worth logging those separately eventually — a failed delivery is information — but don't parse it as a message.

**The self-inflicted loop:** if the guard is missing and the parser somehow extracts a number from a status payload, the bot can end up echoing at itself. Meta's rate limits will stop it, but not before filling the log with nonsense.

---

## 7. Duplicate webhook deliveries are possible

**Symptom:** two identical rows for one message.

**Cause:** Meta uses at-least-once delivery. If your endpoint is slow, times out, or returns a non-2xx, Meta retries — sometimes after the original was already processed. Network conditions can also cause genuine duplicates.

**Fix:** the `unique (wa_message_id)` constraint plus `on conflict do nothing`. Let the database enforce idempotency rather than checking-then-inserting in application logic, which races.

**Contributing factor:** returning a non-2xx on payloads you don't want (like status updates) actively causes retries. Return 200 and ignore instead.

**Also:** respond quickly. n8n's default is to respond after the workflow finishes, so a slow Supabase insert or a slow send delays the response and can push you into Meta's retry window. If duplicates become frequent, configure the Webhook node to respond immediately and continue processing asynchronously.

---

## 8. Test vs production webhook URL in n8n

**Symptom:** verification passed, then nothing works. Or it works once and never again.

**Cause:** n8n's `/webhook-test/{path}` URL is only live while you're clicking "Listen for test event," and only for one request. `/webhook/{path}` is the production URL, live whenever the workflow is active.

**Fix:** register the production URL with Meta. Use the test URL only for manual iteration.

---

## 9. Inactive workflow returns 404

**Symptom:** the production webhook URL 404s. Looks identical to a wrong path.

**Cause:** production webhooks only listen while the workflow is active. Activation is a separate API call — `POST /api/v1/workflows/{id}/activate` — and is not a field you can set on create or update.

**Fix:** activate it. Check activation state before debugging routing.

---

## 10. Webhook field subscription is a separate step

**Symptom:** handshake verified, dashboard shows green, no messages ever arrive.

**Cause:** verifying the callback URL and subscribing to webhook fields are two different actions. You must explicitly subscribe to the `messages` field under the webhook config's "Manage" section. The config screen looks complete without it.

**Fix:** subscribe to `messages`. Confirm the subscription actually shows as active afterwards rather than assuming the click registered.

---

## 11. Phone number ID is not the phone number

**Symptom:** 400 errors on send, or a "not found" style error on the endpoint path.

**Cause:** the send endpoint path takes the numeric **phone number ID** (a long internal identifier), not the displayable phone number. They're shown near each other on the API Setup page and are easy to confuse.

**Fix:** `META_PHONE_NUMBER_ID` is the long numeric ID under the "From" dropdown, not `+1 555 ...`.

**Related:** the payload's `metadata.phone_number_id` is *your* number's ID, not the sender's. Reading it as the sender is a subtle error that produces plausible-looking wrong data.

---

## 12. `messaging_product` is mandatory

**Symptom:** 400 with an unhelpful message on every send.

**Cause:** every WhatsApp Cloud API request body must include `"messaging_product": "whatsapp"`. It's easy to omit because it looks redundant on a WhatsApp-specific endpoint.

**Fix:** include it. Always.

---

## 13. n8n API rejects read-only fields

**Symptom:** `POST /api/v1/workflows` returns 400 about unrecognised properties when you send a workflow you exported from the UI.

**Cause:** the export includes `id`, `active`, `createdAt`, `updatedAt`, `tags`, `versionId`. The create endpoint accepts only `name`, `nodes`, `connections`, `settings` and rejects the rest.

**Fix:** strip read-only fields before posting. Worth writing a small helper for, since this happens every round trip between GUI and git.

---

## 14. Omitting the Graph API version

**Symptom:** behaviour that doesn't match the docs, or a deprecation error out of nowhere.

**Cause:** a URL without a version routes to the **oldest** supported version, not the newest. And versions sunset after roughly two years, after which calls get silently upgraded — changing behaviour without an error.

**Fix:** always pin the version in the URL. Keep it in `META_API_VERSION` so it's one place to change.

---

## 15. Losing n8n data on redeploy

**Symptom:** all workflows and credentials gone after a Railway redeploy.

**Cause:** no persistent volume mounted at `/home/node/.n8n`. Container filesystems are ephemeral.

**Fix:** mount a volume before building anything you'd mind losing. Keeping workflows as JSON in git makes this recoverable, which is a large part of why the API-push pattern is worth the extra friction.

---

## 16. Free-form send outside the 24-hour window

**Symptom:** error 131047 on send.

**Cause:** no open customer service window; free-form messages are blocked and only approved templates can be sent.

**Shouldn't happen in P1** — the echo always replies to a message that just arrived. If you see 131047 in P1, something is wrong with your flow's timing or you're sending to a number that never messaged you. Worth investigating rather than dismissing.

**Will absolutely happen in P2.** See `02-meta-whatsapp-api.md` §7.

---

## 17. Supabase anon key can't insert

**Symptom:** inserts return 401, or succeed but write nothing, or return an empty array.

**Cause:** the `anon` key is subject to Row Level Security. With RLS on and no policies, it can do nothing. The `service_role` key bypasses RLS.

**Fix:** use `SUPABASE_SERVICE_KEY` (service_role) for server-side inserts from n8n and scripts. Never expose it client-side — it's unrestricted database access.

---

## 18. Meta error details are nested

**Symptom:** an error message that says nothing useful.

**Cause:** Meta's top-level `error.message` is often generic. The specific reason lives in `error.error_data.details`, with `error.code` and `error.error_subcode` needed to look it up.

**Fix:** log the entire error object, not just `message`. In n8n, enable "Full Response" on the HTTP Request node so error bodies aren't discarded.

---

## 19. Timezones

**Symptom:** timestamps in Supabase off by hours from what your phone showed.

**Cause:** WhatsApp timestamps are Unix seconds, which are UTC by definition. `timestamptz` stores UTC. But n8n's `GENERIC_TIMEZONE`, the Supabase dashboard's display timezone, and your phone all render differently.

**Fix:** store UTC everywhere, convert only for display. If a timestamp looks wrong, check whether it's actually wrong or just rendered in a different zone before chasing it.

---

## Debugging order when something breaks

Work outside in. Most of the time the answer is in the first two steps.

1. **Is the token still valid?** Run the step 1 isolation script. Rules out the single most common cause in about ten seconds.
2. **Did the webhook fire at all?** Check n8n's execution list. No execution means the problem is upstream — subscription, URL, activation, tunnel — and nothing in your workflow can be at fault.
3. **What did the payload actually contain?** Open the execution, look at the Webhook node's raw output. Compare against the shapes in `02-meta-whatsapp-api.md` §5. This is where status-update payloads reveal themselves.
4. **Which node failed?** The execution view shows per-node input and output. Find the first node whose output isn't what the next one expects.
5. **What did Supabase actually receive?** Check `raw_payload` on the rows that did get written. If nothing was written, check the Supabase logs directly rather than trusting the n8n node's reported success.
