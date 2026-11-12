-- WhatsApp assistant for parents (spec 7): every message in and out is logged.
-- Written by the server only; school admins can read their own school's conversations.
create table if not exists public.whatsapp_messages (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid references public.schools (id) on delete cascade,
  guardian_id  uuid references public.guardians (id) on delete set null,
  phone        text not null,
  direction    text not null check (direction in ('in', 'out')),
  body         text not null,
  command      text,
  provider_id  text,
  status       text not null default 'ok' check (status in ('ok', 'failed', 'ignored')),
  error        text,
  created_at   timestamptz not null default now()
);
-- The provider may deliver the same incoming message twice: answer once.
create unique index if not exists whatsapp_messages_provider_in on public.whatsapp_messages (provider_id) where direction = 'in' and provider_id is not null;
create index if not exists whatsapp_messages_school_idx on public.whatsapp_messages (school_id, created_at desc);
create index if not exists whatsapp_messages_phone_idx on public.whatsapp_messages (phone, created_at desc);

alter table public.whatsapp_messages enable row level security;
revoke all on public.whatsapp_messages from anon;
create policy whatsapp_messages_admin on public.whatsapp_messages for select to authenticated using (public.is_school_admin(school_id));
drop policy if exists mfa_required on public.whatsapp_messages;
create policy mfa_required on public.whatsapp_messages as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

-- Conversations are kept for 180 days.
select cron.schedule('tapin-whatsapp-cleanup', '23 3 * * *', $$delete from public.whatsapp_messages where created_at < now() - interval '180 days'$$);
