-- The WhatsApp assistant's open question to a parent ("Which child? 1 Ada, 2 Kola, 3 Both"), so the next
-- reply can finish the request. One per phone number, short-lived, read and written by the server only.
create table if not exists public.whatsapp_pending (
  phone       text primary key,
  intent      text not null check (intent in ('code', 'absent', 'early', 'early_time')),
  data        jsonb not null default '{}',
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
alter table public.whatsapp_pending enable row level security;
revoke all on public.whatsapp_pending from anon, authenticated;
drop policy if exists mfa_required on public.whatsapp_pending;
create policy mfa_required on public.whatsapp_pending as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

select cron.schedule('tapin-whatsapp-pending-cleanup', '29 3 * * *', $$delete from public.whatsapp_pending where expires_at < now() - interval '1 day'$$);
