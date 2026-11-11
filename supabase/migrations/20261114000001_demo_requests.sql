-- "Book a demo" requests from the public home page. Platform-level (no school exists yet), so there is no
-- school_id: only the super admin can read them. The website writes through the server (service role) after
-- validation and rate limiting; nobody can insert or read directly.
create table public.demo_requests (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 2 and 120),
  school      text not null check (char_length(school) between 2 and 160),
  phone       text not null check (phone ~ '^\+234[0-9]{10}$'),
  pupils      integer check (pupils between 1 and 20000),
  created_at  timestamptz not null default now(),
  handled_at  timestamptz
);

alter table public.demo_requests enable row level security;

create policy demo_requests_super_admin_read on public.demo_requests
  for select to authenticated using (public.is_super_admin());

create policy demo_requests_super_admin_update on public.demo_requests
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

create index demo_requests_created_idx on public.demo_requests (created_at desc);

-- Same rule as every other table: once the super admin has two-factor on, a password-only session sees nothing.
create policy mfa_required on public.demo_requests as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());
