-- Paying an invoice online with OPay (card, bank transfer, USSD). One row per attempt; the invoice is marked paid
-- only after TapIn's server asks OPay for the status and the amount matches.
create table if not exists public.invoice_payments (
  id          uuid primary key default gen_random_uuid(),
  invoice_id  uuid not null references public.invoices (id) on delete restrict,
  school_id   uuid not null references public.schools (id) on delete restrict,
  reference   text not null unique check (reference ~ '^TAPIN-INV-[0-9A-F]{12}$'),
  provider    text not null default 'opay' check (provider in ('opay')),
  amount      numeric(14, 2) not null check (amount > 0),
  status      text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled')),
  provider_order text check (provider_order is null or length(provider_order) <= 64),
  started_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);
create index if not exists invoice_payments_invoice_idx on public.invoice_payments (invoice_id, created_at desc);

alter table public.invoice_payments enable row level security;
revoke all on public.invoice_payments from anon;
drop policy if exists invoice_payments_select on public.invoice_payments;
create policy invoice_payments_select on public.invoice_payments for select to authenticated
  using (public.is_super_admin() or public.is_school_admin(school_id));
drop policy if exists mfa_required on public.invoice_payments;
create policy mfa_required on public.invoice_payments as restrictive for all to authenticated
  using (public.mfa_ok()) with check (public.mfa_ok());
