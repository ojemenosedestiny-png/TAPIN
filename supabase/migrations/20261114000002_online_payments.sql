-- Online payments from the public pricing page (Paystack).
--   orders           a school buying a plan. Platform-level (the school may not exist in TapIn yet), so no
--                    school_id: super admin only.
--   parent_payments  a parent paying their child's TapIn fee. Belongs to a school: its admins and the super admin
--                    can read them.
-- The website writes both through the server (service role) after validation; nobody writes them directly.

-- A short public code per school (printed on letters and cards) and an optional per-term parent fee.
alter table public.schools
  add column if not exists public_code text unique check (public_code is null or public_code ~ '^[A-Z0-9]{2,8}(-[A-Z0-9]{2,8})?$'),
  add column if not exists parent_fee  numeric(12, 2) check (parent_fee is null or parent_fee > 0);

create table public.orders (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique,                 -- our reference, also sent to Paystack
  plan          text not null check (plan in ('starter', 'standard', 'campus')),
  billing       text not null check (billing in ('term', 'year')),
  students      integer not null check (students between 1 and 20000),
  school_name   text not null check (char_length(school_name) between 2 and 160),
  contact_name  text not null check (char_length(contact_name) between 2 and 120),
  phone         text not null check (phone ~ '^\+234[0-9]{10}$'),
  email         text not null check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  state         text not null check (char_length(state) between 2 and 40),
  method        text not null check (method in ('card', 'transfer', 'ussd')),
  amount        numeric(14, 2) check (amount is null or amount >= 0),  -- null: a quote was requested
  status        text not null default 'pending' check (status in ('pending', 'quote', 'paid', 'failed', 'cancelled')),
  paid_at       timestamptz,
  created_at    timestamptz not null default now()
);

create table public.parent_payments (
  id          uuid primary key default gen_random_uuid(),
  reference   text not null unique,
  school_id   uuid not null references public.schools (id) on delete restrict,
  student_id  uuid not null references public.students (id) on delete restrict,
  phone       text not null check (phone ~ '^\+234[0-9]{10}$'),
  amount      numeric(12, 2) not null check (amount > 0),
  method      text not null check (method in ('card', 'transfer', 'ussd')),
  status      text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  paid_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index parent_payments_school_idx on public.parent_payments (school_id, created_at desc);

alter table public.orders enable row level security;
alter table public.parent_payments enable row level security;

create policy orders_super_admin on public.orders
  for select to authenticated using (public.is_super_admin());
create policy orders_super_admin_update on public.orders
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());

create policy parent_payments_read on public.parent_payments
  for select to authenticated using (public.is_super_admin() or public.is_school_admin(school_id));

-- Same rule as every other table: with two-factor on, a password-only session sees nothing.
create policy mfa_required on public.orders as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());
create policy mfa_required on public.parent_payments as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());
