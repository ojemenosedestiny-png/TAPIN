-- Website orders now use the monthly plans from the Pricing page (spec feature 7).
-- plan holds the plan's name at the time of the order; plan_id links to it while it exists.
-- Old orders (starter/standard/campus, per term or year) stay valid.
alter table public.orders drop constraint if exists orders_plan_check;
alter table public.orders drop constraint if exists orders_billing_check;
alter table public.orders
  add constraint orders_plan_check check (char_length(plan) between 1 and 60),
  add constraint orders_billing_check check (billing in ('term', 'year', 'monthly', 'annual')),
  add column if not exists plan_id uuid references public.subscription_plans (id) on delete set null;
