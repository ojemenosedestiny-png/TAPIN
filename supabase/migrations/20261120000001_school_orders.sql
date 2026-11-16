-- Schools pay for everything: when a school needs more cards, wristbands or kiosks, its admin orders them in
-- TapIn. Each order gets an invoice (bank details printed on it); the super admin marks it paid, then delivered.

-- Invoices: monthly (one per school per month, as before) or for an order (any number).
alter table public.invoices add column if not exists kind text not null default 'monthly' check (kind in ('monthly', 'order'));
alter table public.invoices drop constraint if exists invoices_school_id_period_key;
create unique index if not exists invoices_one_monthly_per_school on public.invoices (school_id, period) where kind = 'monthly';

create table if not exists public.school_orders (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools (id) on delete restrict,
  invoice_id    uuid references public.invoices (id) on delete set null,
  lines         jsonb not null,                       -- [{item_id, description, quantity, unit_price, amount}] at the day's prices
  total         numeric(14, 2) not null check (total > 0),
  note          text check (note is null or length(note) <= 500),
  status        text not null default 'awaiting_payment' check (status in ('awaiting_payment', 'paid', 'delivered', 'cancelled')),
  requested_by  uuid references public.users (id) on delete set null,
  created_at    timestamptz not null default now(),
  paid_at       timestamptz,
  delivered_at  timestamptz
);
create index if not exists school_orders_school_idx on public.school_orders (school_id, created_at desc);
create index if not exists school_orders_open_idx on public.school_orders (status) where status in ('awaiting_payment', 'paid');

-- Read: the super admin, and the school's own admins. Writes go through the server after a role check.
alter table public.school_orders enable row level security;
revoke all on public.school_orders from anon;
drop policy if exists school_orders_select on public.school_orders;
create policy school_orders_select on public.school_orders for select to authenticated
  using (public.is_super_admin() or public.is_school_admin(school_id));
drop policy if exists mfa_required on public.school_orders;
create policy mfa_required on public.school_orders as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());
