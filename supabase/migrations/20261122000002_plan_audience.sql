-- Plans are for schools (sized by students) or for organisations (sized by staff). Existing plans are school plans.
alter table public.subscription_plans
  add column if not exists audience text not null default 'school' check (audience in ('school', 'organisation'));
