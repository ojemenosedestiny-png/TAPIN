-- School portal link: each student sign-in at a TapIn kiosk is forwarded to the school's own portal
-- (e.g. POST https://school.example/api/kiosk/tap with a kiosk key), so its class register fills itself.

create table if not exists public.portal_links (
  school_id    uuid primary key references public.schools (id) on delete cascade,
  url          text not null check (url ~ '^https://[^\s]{4,300}$'),
  api_key      text not null check (length(api_key) between 8 and 300), -- secret: server only (see grants)
  key_tail     text not null default '',                                -- last 4 characters, to show which key is saved
  match_by     text not null default 'card' check (match_by in ('card', 'admission')),
  enabled      boolean not null default true,
  last_ok_at   timestamptz,
  last_error   text,
  updated_at   timestamptz not null default now()
);

alter table public.portal_links enable row level security;
revoke all on public.portal_links from anon, authenticated;
-- Admins may read everything except the key itself; all writes go through the server.
grant select (school_id, url, key_tail, match_by, enabled, last_ok_at, last_error, updated_at) on public.portal_links to authenticated;
create policy portal_links_admin on public.portal_links for select to authenticated using (public.is_school_admin(school_id));
drop policy if exists mfa_required on public.portal_links;
create policy mfa_required on public.portal_links as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

-- One row per tap to forward. tap_event_id makes each tap go once; the portal also de-duplicates by tapId.
create table if not exists public.portal_deliveries (
  id            bigint generated always as identity primary key,
  school_id     uuid not null references public.schools (id) on delete cascade,
  tap_event_id  bigint not null unique,
  student_id    uuid references public.students (id) on delete cascade,
  payload       jsonb not null,
  status        text not null default 'pending' check (status in ('pending', 'sent', 'rejected', 'failed')),
  result        text,          -- the portal's answer: present, late, already, unknown_card, inactive, refused
  message       text,
  attempts      int not null default 0,
  next_at       timestamptz not null default now(),
  error         text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz
);
create index if not exists portal_deliveries_due on public.portal_deliveries (next_at) where status = 'pending';
create index if not exists portal_deliveries_school on public.portal_deliveries (school_id, created_at desc);

alter table public.portal_deliveries enable row level security;
revoke all on public.portal_deliveries from anon;
create policy portal_deliveries_admin on public.portal_deliveries for select to authenticated using (public.is_school_admin(school_id));
drop policy if exists mfa_required on public.portal_deliveries;
create policy mfa_required on public.portal_deliveries as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

-- Kept for 90 days.
select cron.schedule('tapin-portal-cleanup', '41 3 * * *', $$delete from public.portal_deliveries where created_at < now() - interval '90 days'$$);
