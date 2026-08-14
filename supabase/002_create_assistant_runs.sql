-- Apply manually in the Supabase SQL Editor after reviewing context/07.
-- These tables are server-only: n8n accesses them with the service_role key.

-- 001 was created through raw SQL. Lock the existing conversation table down
-- before adding more personal conversation data to the public schema.
alter table public.messages enable row level security;
revoke all on table public.messages from public, anon, authenticated;
grant select, insert, update, delete on table public.messages to service_role;

create table if not exists public.assistant_runs (
  inbound_wa_message_id  text primary key
    references public.messages (wa_message_id) on delete cascade,
  from_number            text not null,
  model                  text not null,
  status                 text not null default 'claimed',
  prompt_tokens          integer,
  completion_tokens      integer,
  total_tokens           integer,
  error_code             text,
  error_message          text,
  outbound_wa_message_id text unique
    references public.messages (wa_message_id) on delete set null,
  created_at             timestamptz not null default now(),
  completed_at           timestamptz,

  constraint assistant_runs_status_check
    check (status in ('claimed', 'completed', 'failed')),
  constraint assistant_runs_usage_nonnegative_check
    check (
      (prompt_tokens is null or prompt_tokens >= 0)
      and (completion_tokens is null or completion_tokens >= 0)
      and (total_tokens is null or total_tokens >= 0)
    )
);

comment on table public.assistant_runs is
  'One DeepSeek attempt per inbound WhatsApp message. The primary key claims a webhook delivery before an AI reply is generated.';

alter table public.assistant_runs enable row level security;

-- Do not expose personal WhatsApp conversations through anon or authenticated keys.
revoke all on table public.assistant_runs from public, anon, authenticated;
grant select, insert, update on table public.assistant_runs to service_role;

create index if not exists assistant_runs_from_number_created_at_idx
  on public.assistant_runs (from_number, created_at desc);

-- PostgREST returns an empty body for an ignored insert. This function always
-- returns one row, making the manual n8n branch reliable for both outcomes.
create or replace function public.claim_assistant_run(
  p_inbound_wa_message_id text,
  p_from_number text,
  p_model text
)
returns table (claimed boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  inserted boolean;
begin
  insert into public.assistant_runs (
    inbound_wa_message_id,
    from_number,
    model,
    status
  )
  values (
    p_inbound_wa_message_id,
    p_from_number,
    p_model,
    'claimed'
  )
  on conflict (inbound_wa_message_id) do nothing;

  inserted := found;
  return query select inserted;
end;
$$;

revoke all on function public.claim_assistant_run(text, text, text)
  from public, anon, authenticated;
grant execute on function public.claim_assistant_run(text, text, text)
  to service_role;
