-- Billing (build plan §9: setup fee + monthly fee per student covering software and SMS).

alter table public.schools
  add column if not exists price_per_student numeric(12, 2) not null default 0 check (price_per_student >= 0),
  add column if not exists setup_fee         numeric(12, 2) not null default 0 check (setup_fee >= 0),
  add column if not exists price_per_sms     numeric(12, 2) not null default 0 check (price_per_sms >= 0), -- 0 = SMS included
  add column if not exists billing_start     date,
  add column if not exists billing_email     text check (billing_email is null or billing_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$');

-- The platform's own details for invoices (one row).
create table public.platform_settings (
  id             boolean primary key default true check (id),
  business_name  text not null default 'TapIn',
  address        text,
  email          text,
  phone          text,
  bank_details   text,   -- e.g. "Bank, account name, account number"
  invoice_prefix text not null default 'TAP' check (invoice_prefix ~ '^[A-Z0-9]{2,8}$'),
  updated_at     timestamptz not null default now()
);
insert into public.platform_settings (id) values (true) on conflict do nothing;

create table public.invoices (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete restrict,
  number     text not null unique,
  period     date not null,              -- first day of the billed month
  lines      jsonb not null,             -- [{description, quantity, unit_price, amount}]
  total      numeric(14, 2) not null check (total >= 0),
  status     text not null default 'issued' check (status in ('issued', 'paid', 'void')),
  issued_at  timestamptz not null default now(),
  paid_at    timestamptz,
  unique (school_id, period)
);
create index invoices_school_idx on public.invoices (school_id, period desc);

alter table public.platform_settings enable row level security;
alter table public.invoices enable row level security;
revoke all on public.platform_settings, public.invoices from anon;
-- Super admin reads everything; a school admin reads their own school's invoices and the
-- platform's details (shown on the invoice). All writes go through the super admin's server actions.
create policy platform_settings_select on public.platform_settings for select to authenticated
  using (public.is_super_admin() or public.app_role() = 'school_admin');
create policy invoices_select on public.invoices for select to authenticated
  using (public.is_super_admin() or public.is_school_admin(school_id));
create policy mfa_required on public.invoices as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());
create policy mfa_required on public.platform_settings as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

-- Usage for a month, per school: counts only, never names (the super admin has no student access).
create or replace function public.school_usage(p_month date)
returns table (school_id uuid, active_students integer, sms_sent integer)
language sql stable security definer set search_path = '' as $$
  select s.id,
    (select count(*)::int from public.students st where st.school_id = s.id and st.status = 'active'),
    (select count(*)::int from public.sms_logs l where l.school_id = s.id and l.status = 'sent'
       and l.sent_at >= p_month and l.sent_at < (p_month + interval '1 month'))
  from public.schools s
$$;
revoke execute on function public.school_usage(date) from public, anon, authenticated;
grant execute on function public.school_usage(date) to service_role;
