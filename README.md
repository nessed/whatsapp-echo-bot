# whatsapp-deepseek-bot

A private WhatsApp chatbot: text your Meta test number, n8n sends the message to
DeepSeek, and the answer arrives back in WhatsApp. Inbound and outbound messages
are logged to Supabase.

This is a manual-first practice project. You build the n8n nodes and dashboard
configuration yourself; the repository gives you the exact order, verification
scripts, reference material, and known failure patterns.

## Stack and cost boundary

- Meta WhatsApp Cloud API test number
- Local n8n + the existing reserved ngrok tunnel, running only while the laptop is on
- Supabase Postgres
- DeepSeek API, using the existing prepaid credit

No new hosting, public access, production number, templates, media processing, or
automatic API top-up belongs in v1.

## Definition of done

Text the registered test number from your allowed phone. Within a few seconds,
DeepSeek replies in WhatsApp. Supabase contains one inbound and one outbound row,
and the reply uses the previous ten stored text messages as conversation context.

The full manual checklist is [context/05-build-sequence.md](context/05-build-sequence.md).
The exact node-by-node DeepSeek build is
[context/07-deepseek-whatsapp-assistant.md](context/07-deepseek-whatsapp-assistant.md).
The complete state and implementation handoff is
[context/08-deepseek-whatsapp-implementation-handoff.md](context/08-deepseek-whatsapp-implementation-handoff.md).

## Current status

Steps 1–6 are complete: Meta credentials, Supabase, public webhook verification,
payload parsing, status filtering, and inbound logging all work. Next: rotate
exposed credentials, then complete the DeepSeek assistant steps manually.

## Environment

Copy `.env.example` to `.env` and fill it with replacement secrets. `.env` is
ignored by Git; never put a real key in `.env.example`, workflow JSON, or a commit.

```bash
cp .env.example .env
```

## Before debugging

Read `context/06-gotchas.md`. Use `answers/06-gotchas-full.md` only after you
have formed a diagnosis from actual executions and error bodies.
