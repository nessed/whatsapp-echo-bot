# 01 — Project Brief

## What gets built

A private WhatsApp interface to DeepSeek. Your registered phone sends a text to
the Meta test number; n8n logs it, supplies the latest conversation context to
DeepSeek, sends the answer back through Meta, and logs the outbound message.

Three systems carry the work:

- **Meta WhatsApp Cloud API** receives and sends WhatsApp messages.
- **Local n8n + ngrok** runs the workflow while the laptop is awake.
- **Supabase** stores messages and one assistant-run claim per inbound message.

## Why it exists

This remains a training rep, but the reply now exercises a real AI API rather
than an echo string. The transferable skills are webhook security, API auth,
manual workflow construction, message idempotency, bounded conversation context,
structured logging, and cost-aware failure handling.

Build it manually the first time. The documentation gives the node order and
verification conditions; do not use workflow-API automation unless you explicitly
ask to take over a specific repair.

## What done looks like

1. Your allowed test phone texts the Meta test number.
2. DeepSeek replies in WhatsApp using the prior ten stored text messages as context.
3. Supabase records an `in` row, an `out` row, and a completed `assistant_runs` row
   containing the DeepSeek token usage and the outbound WhatsApp message ID.
4. A duplicated webhook creates no second DeepSeek call or WhatsApp reply.

## Explicit non-goals for v1

- Public or multi-user access.
- Paid or always-on hosting.
- Template messages, production numbers, or outbound conversation initiation.
- Media understanding, voice transcription, tools, RAG, or a custom persona.
- Automatic retries or automatic DeepSeek balance top-ups.

## Constraints

- Only the number in `ALLOWED_WHATSAPP_NUMBER` may invoke the model.
- Only text messages reach DeepSeek. Other message types receive a fixed text-only reply.
- Use `deepseek-v4-flash`, non-thinking mode, and at most 512 output tokens.
- The current prepaid DeepSeek balance is the only intended spend.
