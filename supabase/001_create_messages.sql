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
