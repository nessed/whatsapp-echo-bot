# 05 — Build Sequence

Build and verify one layer at a time. Steps 1–6 are already complete; do not
rebuild them. The remaining work is deliberately manual so the n8n concepts stick.

## Completed foundation

1. Meta credential smoke test.
2. `messages` table and REST insert verification.
3. Local n8n + stable ngrok HTTPS endpoint.
4. Meta GET webhook verification and `messages` subscription.
5. POST parsing with status-webhook filtering.
6. Idempotent inbound logging to Supabase.

## Step 7 — Confirm local credentials and verify DeepSeek

The current repository history and `.env.example` contain no real credentials.
Keep all working test credentials only in local `.env`. Ali has chosen not to
rotate the current test keys yet; do not block the manual build by asking again.
Rotate or replace every test credential before any production/public deployment.

Run the DeepSeek isolation test:

```bash
node --env-file=.env scripts/04-verify-deepseek.js
```

**Done when:** the script returns HTTP 200, a short response, and usage metadata.

## Step 8 — Create the assistant-run table by hand

Open Supabase SQL Editor, review `supabase/002_create_assistant_runs.sql`, paste
it, and run it. This table lets the workflow claim an inbound WhatsApp ID before
calling DeepSeek, so a duplicate webhook cannot produce a second paid reply.

Verify manually that:

- a row can be inserted with the service-role REST credential;
- the same `inbound_wa_message_id` cannot be inserted twice;
- `anon` and `authenticated` do not have access to either `messages` or `assistant_runs`;
- the table is available to the Data API for `service_role`.

**Done when:** one test claim succeeds, the duplicate is ignored with
`on_conflict=inbound_wa_message_id`, and the security checks match the comments in
the SQL file.

## Step 9 — Build the DeepSeek branch manually in n8n

Follow `context/07-deepseek-whatsapp-assistant.md` node by node. Do this in the
existing POST-message branch after `Log to Supabase`.

The final branch must:

1. Reject any number other than `ALLOWED_WHATSAPP_NUMBER`.
2. Send non-text messages the fixed text-only response without calling DeepSeek.
3. Claim the inbound WhatsApp ID in `assistant_runs` before any model request.
4. Load the latest 10 non-empty messages for that number from Supabase.
5. Call DeepSeek once using `deepseek-v4-flash`, non-thinking mode, and
   `max_tokens: 512`.
6. Send the returned text with Meta, log it as `direction = 'out'`, and mark the
   assistant run complete with its token usage and outbound wamid.
7. Mark failures as failed and send one fixed retry-later message. Do not retry
   automatically or top up the account.

Publish the workflow after every edit. Every branch must still reach a Respond to
Webhook node with HTTP 200.

**Done when:** the fake text payload produces one DeepSeek response in n8n, one
outbound Meta wamid, one outbound `messages` row, and one completed
`assistant_runs` row.

## Step 10 — Manual end-to-end test

Text the test number from the allowed phone. Test:

- a short question;
- a follow-up that depends on the previous answer;
- emoji and a multiline message;
- two rapid messages;
- an image or voice note;
- the same fake webhook posted twice;
- a deliberately invalid DeepSeek credential, then the replacement credential.

After each text exchange, verify exactly one inbound row, one outbound row, and
one assistant-run row. Status callbacks must terminate at the existing guard and
must not call DeepSeek.

**Done when:** DeepSeek replies through WhatsApp, the latest-ten-message context
works, duplicates cost nothing, non-text input gets the fixed reply, and failures
are recorded without a retry loop.

## After Step 10

- Update the current-status checklist in `CLAUDE.md`.
- Export the finished workflow from n8n into `workflows/echo-bot.json` and review
  it for embedded credentials before committing.
- Replace the repository's initial commit to remove historic secrets before sharing
  access with anyone else.
