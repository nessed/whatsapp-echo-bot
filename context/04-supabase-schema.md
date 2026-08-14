# 04 — Supabase Schema

One table: `messages`. Every WhatsApp message in either direction becomes a row.

---

## Table design

| Column | Type | Notes |
|---|---|---|
| `id` | `bigint` identity | Surrogate primary key. Not related to anything WhatsApp sends. |
| `from_number` | `text` | The counterparty's number in E.164 without `+`, e.g. `447700900123`. See naming note below. |
| `message_text` | `text` | Message body. Nullable — non-text message types have no body. |
| `direction` | `text` | `'in'` or `'out'`. Constrained by a CHECK. |
| `wa_message_id` | `text` | The `wamid.` string. Unique. This is the deduplication key. |
| `timestamp` | `timestamptz` | When the message happened, per WhatsApp — not when the row was written. |
| `raw_payload` | `jsonb` | The complete unmodified payload. |
| `created_at` | `timestamptz` | Row insert time, defaults to `now()`. |

### On `from_number`

The name is slightly wrong for outbound rows, where the number is the recipient rather than the sender. It's kept because the spec calls for it and because for this bot the counterparty is always the same person either way — `direction` tells you which end it was.

If it starts causing confusion in P2, the cleaner design is `counterparty_number` plus a separate `business_number`. Not worth changing now; noting it so the ambiguity is deliberate rather than accidental.

---

## Why `raw_payload` matters

This column is the actual skill being practiced, more than the reply text is.

**Debugging.** When a message doesn't produce the expected row, the question is always "what did Meta actually send?" Without the raw payload you're guessing from the parsed fields — which is exactly the layer you suspect. With it, you `SELECT raw_payload FROM messages WHERE ...` and read the real thing. The number of hours this saves in a stack you don't control is not small.

**Audit trail.** P2 confirms COD orders. When a customer says "I never confirmed that," the parsed text field is your word against theirs. The raw payload with WhatsApp's own message ID and timestamp is evidence. Building the habit here, where nothing is at stake, means it's automatic when something is.

**Schema evolution.** You will eventually want a field you didn't think to extract — profile name, message type, the conversation ID from a status update. With the raw payload stored you can backfill from historical rows. Without it, that data is gone permanently.

**Handling what you don't understand yet.** Media messages, reactions, replies-to-message, interactive button responses all have different shapes. Storing the whole payload means an unexpected type still produces a usable row instead of a crash or a silent drop.

`jsonb` rather than `json` or `text`: jsonb is stored parsed and binary, supports indexing, and lets you query into it directly — `raw_payload->'entry'->0->'changes'->0->'value'->>'messaging_product'`. Slightly slower on insert, much better everywhere else.

---

## CREATE TABLE

Run this in the Supabase SQL Editor. Save it to `supabase/001_create_messages.sql` so it's version controlled.

```sql
create table if not exists public.messages (
  id             bigint generated always as identity primary key,
  from_number    text        not null,
  message_text   text,
  direction      text        not null,
  wa_message_id  text,
  timestamp      timestamptz not null,
  raw_payload    jsonb,
  created_at     timestamptz not null default now(),

  constraint messages_direction_check
    check (direction in ('in', 'out')),

  constraint messages_wa_message_id_unique
    unique (wa_message_id)
);

comment on table public.messages is
  'Every WhatsApp message in both directions. raw_payload retained for debugging and audit.';

comment on column public.messages.from_number is
  'Counterparty number, E.164 without leading +. Sender when direction=in, recipient when direction=out.';

comment on column public.messages.wa_message_id is
  'WhatsApp wamid. Unique constraint provides idempotency against duplicate webhook deliveries.';

comment on column public.messages.timestamp is
  'Message time per WhatsApp, not row insert time. Compare with created_at to measure pipeline lag.';

create index if not exists messages_timestamp_idx
  on public.messages (timestamp desc);

create index if not exists messages_from_number_idx
  on public.messages (from_number);

create index if not exists messages_direction_idx
  on public.messages (direction);
```

### Design decisions in that SQL

**`unique (wa_message_id)`** — this is the duplicate-delivery defence. Meta can deliver the same webhook more than once (see `06-gotchas.md`). Rather than checking for existence before inserting, which races, let the database reject the second insert. Then insert with conflict handling:

```sql
insert into public.messages (from_number, message_text, direction, wa_message_id, timestamp, raw_payload)
values ($1, $2, $3, $4, $5, $6)
on conflict (wa_message_id) do nothing;
```

Via the Supabase REST API this is the `Prefer: resolution=ignore-duplicates` header on the insert, or `.upsert(..., { ignoreDuplicates: true })` in the JS client.

`wa_message_id` is nullable because a send might conceivably need logging before its ID is known. Postgres treats NULLs as distinct in unique constraints, so multiple NULL rows are allowed — which is the behaviour you want, though it does mean rows without an ID get no dedup protection. Try to always capture the wamid.

**`timestamp` as `timestamptz`, separate from `created_at`** — WhatsApp's timestamp is when the message was sent; `created_at` is when your pipeline processed it. The gap between them is your end-to-end latency, and it's the first thing to look at when the bot "feels slow." Storing only one loses that.

Converting Meta's format: the webhook gives Unix **seconds** as a **string**. In JS:

```js
new Date(parseInt(msg.timestamp, 10) * 1000).toISOString()
```

Forgetting the `* 1000` puts every row in January 1970, which at least fails loudly.

**`timestamp` as a column name** — it's a reserved-ish word in SQL. Postgres accepts it unquoted in these statements, but if a query behaves strangely, quote it as `"timestamp"`. `message_timestamp` would have been the safer name; keeping `timestamp` because it's what the spec asks for.

---

## Row Level Security

Supabase enables RLS on new tables via the dashboard flow but not automatically via raw SQL. Either way, the `service_role` key bypasses RLS entirely, so n8n and local scripts using `SUPABASE_SERVICE_KEY` can insert regardless.

For P1 this is fine — nothing but the server touches this table. Explicitly:

```sql
alter table public.messages enable row level security;
```

With RLS on and no policies defined, the `anon` and `authenticated` keys can do nothing at all, which is the correct default. Add policies only when something client-side needs read access.

**Never put `SUPABASE_SERVICE_KEY` anywhere a browser could see it.** It's full database access with all row-level checks disabled.

---

## Verifying the table works

Build step 2 isn't done until an insert has actually succeeded. Minimum check — run in the SQL Editor:

```sql
insert into public.messages (from_number, message_text, direction, wa_message_id, timestamp, raw_payload)
values ('447700900123', 'schema smoke test', 'in', 'wamid.TEST_0001', now(), '{"test": true}'::jsonb);

select id, from_number, message_text, direction, wa_message_id, timestamp, created_at
from public.messages
order by id desc limit 5;

delete from public.messages where wa_message_id = 'wamid.TEST_0001';
```

Then repeat the insert through the REST API with the service key, from a script in `scripts/`. SQL Editor success only proves the schema is valid; it doesn't prove your key, URL, and network path work. Those are separate failure modes and the API test is the one that matters.

Worth also confirming the constraints actually fire:

```sql
-- should fail: violates direction check
insert into public.messages (from_number, direction, timestamp)
values ('447700900123', 'sideways', now());

-- should be ignored, not error: duplicate wamid
insert into public.messages (from_number, direction, wa_message_id, timestamp)
values ('447700900123', 'in', 'wamid.TEST_0001', now())
on conflict (wa_message_id) do nothing;
```

A constraint you never saw reject anything is a constraint you don't know exists.

---

## Useful queries once data is flowing

```sql
-- recent conversation, in order
select direction, message_text, timestamp
from public.messages
order by timestamp desc
limit 20;

-- pipeline latency per message
select wa_message_id,
       direction,
       created_at - timestamp as lag
from public.messages
order by created_at desc
limit 20;

-- inbound messages with no matching outbound reply after them
-- rough check for inbound messages that never received a reply
select m.wa_message_id, m.message_text, m.timestamp
from public.messages m
where m.direction = 'in'
  and not exists (
    select 1 from public.messages o
    where o.direction = 'out'
      and o.timestamp >= m.timestamp
      and o.timestamp < m.timestamp + interval '1 minute'
  )
order by m.timestamp desc;

-- pull a raw payload back out for inspection
select jsonb_pretty(raw_payload)
from public.messages
where wa_message_id = 'wamid.xxxxx';
```

---

## Assistant-run claims

`002_create_assistant_runs.sql` adds one server-only claim per inbound WhatsApp message. It is how the DeepSeek branch avoids paying twice when Meta redelivers a webhook. Apply it manually after reviewing the file and verify it with the service-role credential; no browser client should receive access.

## What goes in `supabase/`

SQL migration files, numbered in the order they should run — `001_create_messages.sql`, then `002_create_assistant_runs.sql`.
