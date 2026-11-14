-- Pricing and subscriptions (spec feature 7). Only the TapIn super admin can read or change any of this.
-- No price is hard-coded: the rows below start at ₦0 and inactive until the super admin sets them.

-- One-time setup items: kiosks, cards, wristbands, replacements, and anything added later.
create table if not exists public.price_items (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(trim(name)) between 2 and 80),
  description  text check (description is null or length(description) <= 300),
  unit         text not null default 'each' check (length(trim(unit)) between 1 and 30),   -- "per kiosk", "per card"
  unit_price   numeric(12, 2) not null default 0 check (unit_price >= 0),
  active       boolean not null default false,
  sort         integer not null default 0,
  updated_by   uuid references public.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Monthly plans by school size. tier decides which features the school gets (basic | premium).
create table if not exists public.subscription_plans (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) between 2 and 40),
  min_students   integer not null default 0 check (min_students >= 0),
  max_students   integer check (max_students is null or max_students >= min_students),   -- null = no upper limit
  monthly_price  numeric(12, 2) not null default 0 check (monthly_price >= 0),
  features       text[] not null default '{}',
  tier           text not null default 'basic' check (tier in ('basic', 'premium')),
  active         boolean not null default false,
  sort           integer not null default 0,
  updated_by     uuid references public.users (id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Paying yearly: this many months free (0 = no discount).
alter table public.platform_settings
  add column if not exists annual_free_months integer not null default 0 check (annual_free_months between 0 and 6),
  add column if not exists pricing_updated_by uuid references public.users (id) on delete set null;

-- Every price change, with who and when. Written by triggers, never by hand.
create table if not exists public.price_history (
  id          bigint generated always as identity primary key,
  entity      text not null check (entity in ('item', 'plan', 'settings', 'subscription')),
  entity_id   text not null,
  name        text not null,
  field       text not null,
  old_value   text,
  new_value   text,
  changed_by  uuid references public.users (id) on delete set null,
  changed_at  timestamptz not null default now()
);
create index if not exists price_history_at on public.price_history (changed_at desc);

-- What each school pays. agreed_monthly_price is fixed when the school signs up and only changes when the
-- super admin chooses to update it: changing a plan's price does not touch existing schools.
create table if not exists public.subscriptions (
  school_id             uuid primary key references public.schools (id) on delete cascade,
  plan_id               uuid not null references public.subscription_plans (id) on delete restrict,
  agreed_monthly_price  numeric(12, 2) not null check (agreed_monthly_price >= 0),
  billing               text not null default 'monthly' check (billing in ('monthly', 'annual')),
  started_on            date not null,
  renews_on             date not null,
  suspended             boolean not null default false,
  reminded_for          date,                      -- the renewal date the last reminder was sent for
  notes                 text check (notes is null or length(notes) <= 500),
  updated_by            uuid references public.users (id) on delete set null,
  updated_at            timestamptz not null default now(),
  check (renews_on >= started_on)
);

-- Quotes sent to schools (the PDF is the printable page of one of these).
create table if not exists public.quotes (
  id               uuid primary key default gen_random_uuid(),
  number           text not null unique,
  school_id        uuid references public.schools (id) on delete set null,
  school_name      text not null check (length(trim(school_name)) between 2 and 160),
  plan_id          uuid references public.subscription_plans (id) on delete set null,
  plan_name        text not null,
  monthly_price    numeric(12, 2) not null check (monthly_price >= 0),
  billing          text not null default 'monthly' check (billing in ('monthly', 'annual')),
  lines            jsonb not null default '[]',    -- [{item_id, name, unit, quantity, unit_price, amount}] at today's prices
  setup_total      numeric(14, 2) not null check (setup_total >= 0),
  discount_kind    text check (discount_kind in ('percent', 'fixed')),
  discount_value   numeric(12, 2) check (discount_value is null or discount_value >= 0),
  discount_note    text check (discount_note is null or length(discount_note) <= 300),
  discount_amount  numeric(14, 2) not null default 0 check (discount_amount >= 0),
  first_payment    numeric(14, 2) not null check (first_payment >= 0),
  valid_until      date not null,
  created_by       uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  check ((discount_kind is null) = (discount_value is null))
);

-- ---------------------------------------------------------------------------------------------------
-- Price history triggers.
create or replace function public.log_price_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_entity text := tg_argv[0];
  v_who uuid;
  v_name text;
  v_id text;
begin
  if v_entity = 'item' then
    v_who := new.updated_by; v_name := new.name; v_id := new.id::text;
    if tg_op = 'INSERT' then
      insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values (v_entity, v_id, v_name, 'created', null, new.unit_price::text, v_who);
    else
      if new.unit_price is distinct from old.unit_price then insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values (v_entity, v_id, v_name, 'unit_price', old.unit_price::text, new.unit_price::text, v_who); end if;
      if new.active is distinct from old.active then insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values (v_entity, v_id, v_name, 'active', old.active::text, new.active::text, v_who); end if;
      if new.name is distinct from old.name then insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values (v_entity, v_id, v_name, 'name', old.name, new.name, v_who); end if;
    end if;
  elsif v_entity = 'plan' then
    v_who := new.updated_by; v_name := new.name; v_id := new.id::text;
    if tg_op = 'INSERT' then
      insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values (v_entity, v_id, v_name, 'created', null, new.monthly_price::text, v_who);
    else
      if new.monthly_price is distinct from old.monthly_price then insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values (v_entity, v_id, v_name, 'monthly_price', old.monthly_price::text, new.monthly_price::text, v_who); end if;
      if new.active is distinct from old.active then insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values (v_entity, v_id, v_name, 'active', old.active::text, new.active::text, v_who); end if;
      if new.name is distinct from old.name then insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values (v_entity, v_id, v_name, 'name', old.name, new.name, v_who); end if;
      if (new.min_students, new.max_students) is distinct from (old.min_students, old.max_students) then insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values (v_entity, v_id, v_name, 'students', old.min_students || '–' || coalesce(old.max_students::text, '∞'), new.min_students || '–' || coalesce(new.max_students::text, '∞'), v_who); end if;
    end if;
  elsif v_entity = 'settings' then
    if new.annual_free_months is distinct from old.annual_free_months then
      insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values ('settings', 'platform', 'Annual discount', 'annual_free_months', old.annual_free_months::text, new.annual_free_months::text, new.pricing_updated_by);
    end if;
  elsif v_entity = 'subscription' then
    select s.name into v_name from public.schools s where s.id = new.school_id;
    if tg_op = 'INSERT' then
      insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values ('subscription', new.school_id::text, coalesce(v_name, 'School'), 'agreed_monthly_price', null, new.agreed_monthly_price::text, new.updated_by);
    elsif new.agreed_monthly_price is distinct from old.agreed_monthly_price or new.plan_id is distinct from old.plan_id then
      insert into public.price_history (entity, entity_id, name, field, old_value, new_value, changed_by) values ('subscription', new.school_id::text, coalesce(v_name, 'School'), 'agreed_monthly_price', old.agreed_monthly_price::text, new.agreed_monthly_price::text, new.updated_by);
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.log_price_change() from public, anon, authenticated;

drop trigger if exists price_items_history on public.price_items;
create trigger price_items_history after insert or update on public.price_items for each row execute function public.log_price_change('item');
drop trigger if exists subscription_plans_history on public.subscription_plans;
create trigger subscription_plans_history after insert or update on public.subscription_plans for each row execute function public.log_price_change('plan');
drop trigger if exists platform_settings_history on public.platform_settings;
create trigger platform_settings_history after update on public.platform_settings for each row execute function public.log_price_change('settings');
drop trigger if exists subscriptions_history on public.subscriptions;
create trigger subscriptions_history after insert or update on public.subscriptions for each row execute function public.log_price_change('subscription');

-- ---------------------------------------------------------------------------------------------------
-- Status of a subscription: suspended, overdue (renewal date passed), due (within 7 days), or active.
create or replace function public.subscription_status(p_renews_on date, p_suspended boolean, p_today date default (now() at time zone 'Africa/Lagos')::date)
returns text language sql stable as $$
  select case
    when p_suspended then 'suspended'
    when p_renews_on < p_today then 'overdue'
    when p_renews_on <= p_today + 7 then 'due'
    else 'active'
  end
$$;

-- A school admin sees their own plan name, renewal date and status. Never any price.
create or replace function public.my_subscription()
returns table (plan_name text, renews_on date, status text)
language sql stable security definer set search_path = '' as $$
  select p.name, s.renews_on, public.subscription_status(s.renews_on, s.suspended)
  from public.subscriptions s
  join public.subscription_plans p on p.id = s.plan_id
  where s.school_id = public.current_school_id() and public.is_school_admin(s.school_id) and public.mfa_ok()
$$;
revoke execute on function public.my_subscription() from public, anon;
grant execute on function public.my_subscription() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Row-level security: super admin only. All writes go through the server after a super-admin check.
do $$
declare t text;
begin
  foreach t in array array['price_items', 'subscription_plans', 'price_history', 'subscriptions', 'quotes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('drop policy if exists %I on public.%I', t || '_super', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_super_admin())', t || '_super', t);
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Starting rows, at ₦0 and switched off: the super admin sets the real prices in the Pricing section.
insert into public.price_items (name, description, unit, sort)
select v.name, v.description, v.unit, v.sort from (values
  ('Kiosk setup', 'Tablet, stand and installation at the gate', 'per kiosk', 1),
  ('Standard NFC card', 'Printed student or staff ID card', 'per card', 2),
  ('Premium NFC wristband', 'Waterproof wristband for younger children', 'per wristband', 3),
  ('Replacement card', 'A new card for one that was lost or damaged', 'per card', 4),
  ('Replacement wristband', 'A new wristband for one that was lost or damaged', 'per wristband', 5)
) as v(name, description, unit, sort)
where not exists (select 1 from public.price_items);

insert into public.subscription_plans (name, min_students, max_students, features, tier, sort)
select v.name, v.min_s, v.max_s, v.features, v.tier, v.sort from (values
  ('Starter', 0, 300, array['1 kiosk', 'Arrival, departure and absence alerts', 'Admin dashboard'], 'basic', 1),
  ('Standard', 301, 800, array['Up to 3 kiosks', 'Parent handover and safe pickup', 'WhatsApp assistant', 'Staff attendance and reports'], 'basic', 2),
  ('Premium', 801, null::integer, array['Unlimited kiosks', 'Everything in Standard', 'Emergency roll call', 'Priority support'], 'premium', 3)
) as v(name, min_s, max_s, features, tier, sort)
where not exists (select 1 from public.subscription_plans);

revoke execute on function public.subscription_status(date, boolean, date) from public, anon;
grant execute on function public.subscription_status(date, boolean, date) to authenticated, service_role;
