-- Emergency roll call (spec 9, Premium). Everyone tapped in today is on the roll; people are marked
-- safe by tapping at the assembly point or being ticked on a phone. Scoped by school_id.

-- The kiosk's Emergency button needs this PIN (stored as a salted scrypt hash).
create table if not exists public.emergency_settings (
  school_id  uuid primary key references public.schools (id) on delete cascade,
  pin_hash   text,
  updated_at timestamptz not null default now()
);

create table if not exists public.emergencies (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  kind             text not null default 'real' check (kind in ('real', 'drill')),
  reason           text check (reason is null or length(reason) <= 200),
  started_at       timestamptz not null default now(),
  started_by_user  uuid references public.users (id) on delete set null,
  started_device   uuid references public.devices (id) on delete set null,
  ended_at         timestamptz,
  ended_by_user    uuid references public.users (id) on delete set null,
  broadcast_at     timestamptz,
  created_at       timestamptz not null default now()
);
-- One roll call at a time per school.
create unique index if not exists emergencies_one_active on public.emergencies (school_id) where ended_at is null;
create index if not exists emergencies_school_idx on public.emergencies (school_id, started_at desc);

create table if not exists public.emergency_people (
  id           uuid primary key default gen_random_uuid(),
  emergency_id uuid not null references public.emergencies (id) on delete cascade,
  school_id    uuid not null references public.schools (id) on delete cascade,
  holder_type  public.holder_type not null,
  holder_id    uuid not null,
  name         text not null,
  group_name   text not null,              -- class name, or "Staff"
  on_roster    boolean not null default true, -- false: wasn't tapped in, but turned up at the assembly point
  safe_at      timestamptz,
  marked_by    text,                       -- "Kiosk: Main gate" or the staff member's name
  unique (emergency_id, holder_type, holder_id)
);
create index if not exists emergency_people_emergency_idx on public.emergency_people (emergency_id, group_name, name);

-- Row level security: everyone on the school's team can see the roll call (teachers tick on their phones);
-- changes go through the server. The PIN is server only.
alter table public.emergency_settings enable row level security;
alter table public.emergencies enable row level security;
alter table public.emergency_people enable row level security;
revoke all on public.emergency_settings from anon, authenticated;
revoke all on public.emergencies, public.emergency_people from anon;
create policy emergencies_select on public.emergencies for select to authenticated using (public.is_school_member(school_id));
create policy emergency_people_select on public.emergency_people for select to authenticated using (public.is_school_member(school_id));

do $$
declare t text;
begin
  foreach t in array array['emergencies', 'emergency_people'] loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
  end loop;
end $$;

-- Live updates on the dashboard (Supabase Realtime respects the policies above).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.emergencies, public.emergency_people;
    exception when duplicate_object then null;
    end;
  end if;
end $$;
