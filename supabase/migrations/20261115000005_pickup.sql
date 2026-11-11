-- Safe pickup (spec 6): approved pickup people with NFC cards, one-day pickup codes, and a full log.
-- Everything is scoped by school_id. Parents act through the server (service role) after their
-- session proves which children are theirs; logged-in staff see pickup data only as school admins.

create table if not exists public.pickup_people (
  id                      uuid primary key default gen_random_uuid(),
  school_id               uuid not null references public.schools (id) on delete cascade,
  name                    text not null check (length(trim(name)) between 2 and 120),
  phone                   text check (phone is null or phone ~ '^\+234[0-9]{10}$'),
  relationship            text check (relationship is null or length(relationship) <= 40),
  photo_url               text,
  guardian_id             uuid references public.guardians (id) on delete set null, -- when the person is a parent on record
  status                  text not null default 'active' check (status in ('active', 'pending', 'revoked')),
  added_by                text not null default 'school' check (added_by in ('school', 'parent')),
  added_by_guardian_id    uuid references public.guardians (id) on delete set null,
  approved_by_guardian_id uuid references public.guardians (id) on delete set null,
  card_uid                text unique check (card_uid is null or card_uid ~ '^[0-9A-F]{8,20}$'),
  card_blocked            boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists pickup_people_school_idx on public.pickup_people (school_id, name);

create table if not exists public.pickup_people_students (
  person_id  uuid not null references public.pickup_people (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  school_id  uuid not null references public.schools (id) on delete cascade,
  primary key (person_id, student_id)
);
create index if not exists pickup_people_students_student_idx on public.pickup_people_students (student_id);

-- One-day codes: a parent or the office gives a 6-digit code to someone collecting a child once.
create table if not exists public.pickup_codes (
  id                     uuid primary key default gen_random_uuid(),
  school_id              uuid not null references public.schools (id) on delete cascade,
  code_hash              text not null,
  person_name            text not null check (length(trim(person_name)) between 2 and 120),
  phone                  text check (phone is null or phone ~ '^\+234[0-9]{10}$'),
  valid_date             date not null,
  created_by_guardian_id uuid references public.guardians (id) on delete set null,
  created_by_user_id     uuid references public.users (id) on delete set null,
  used_at                timestamptz,
  created_at             timestamptz not null default now(),
  unique (school_id, valid_date, code_hash)
);

create table if not exists public.pickup_code_students (
  code_id    uuid not null references public.pickup_codes (id) on delete cascade,
  student_id uuid not null references public.students (id) on delete cascade,
  school_id  uuid not null references public.schools (id) on delete cascade,
  primary key (code_id, student_id)
);

-- The pickup log: every child handed over, and every refused attempt.
create table if not exists public.pickup_events (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  kind        text not null check (kind in ('picked_up', 'not_authorised')),
  student_id  uuid references public.students (id) on delete cascade,
  person_id   uuid references public.pickup_people (id) on delete set null,
  code_id     uuid references public.pickup_codes (id) on delete set null,
  picker_name text not null,
  device_id   uuid references public.devices (id) on delete set null,
  at          timestamptz not null default now()
);
create index if not exists pickup_events_school_idx on public.pickup_events (school_id, at desc);

alter table public.attendance add column if not exists picked_up_by text;

-- Rows must point at things in the same school.
create or replace function public.check_pickup_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.students where id = new.student_id and school_id = new.school_id) then
    raise exception 'student is not in this school';
  end if;
  if tg_table_name = 'pickup_people_students'
     and not exists (select 1 from public.pickup_people where id = new.person_id and school_id = new.school_id) then
    raise exception 'pickup person is not in this school';
  end if;
  if tg_table_name = 'pickup_code_students'
     and not exists (select 1 from public.pickup_codes where id = new.code_id and school_id = new.school_id) then
    raise exception 'pickup code is not in this school';
  end if;
  return new;
end;
$$;
drop trigger if exists pickup_people_students_refs on public.pickup_people_students;
create trigger pickup_people_students_refs before insert or update on public.pickup_people_students
  for each row execute function public.check_pickup_refs();
drop trigger if exists pickup_code_students_refs on public.pickup_code_students;
create trigger pickup_code_students_refs before insert or update on public.pickup_code_students
  for each row execute function public.check_pickup_refs();

-- A physical card is either a student/staff card or a pickup card, never both.
create or replace function public.check_card_uid_unused()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'cards' then
    if exists (select 1 from public.pickup_people where card_uid = new.uid) then
      raise exception 'card is already a pickup card' using errcode = '23505';
    end if;
  elsif new.card_uid is not null and exists (select 1 from public.cards where uid = new.card_uid) then
    raise exception 'card is already a student or staff card' using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists cards_uid_not_pickup on public.cards;
create trigger cards_uid_not_pickup before insert or update of uid on public.cards
  for each row execute function public.check_card_uid_unused();
drop trigger if exists pickup_card_not_student on public.pickup_people;
create trigger pickup_card_not_student before insert or update of card_uid on public.pickup_people
  for each row execute function public.check_card_uid_unused();

-- Row level security: school admins only.
alter table public.pickup_people enable row level security;
alter table public.pickup_people_students enable row level security;
alter table public.pickup_codes enable row level security;
alter table public.pickup_code_students enable row level security;
alter table public.pickup_events enable row level security;
revoke all on public.pickup_people, public.pickup_people_students, public.pickup_codes, public.pickup_code_students, public.pickup_events from anon;

create policy pickup_people_admin on public.pickup_people for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy pickup_people_students_admin on public.pickup_people_students for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy pickup_codes_admin on public.pickup_codes for select to authenticated using (public.is_school_admin(school_id));
create policy pickup_code_students_admin on public.pickup_code_students for select to authenticated using (public.is_school_admin(school_id));
create policy pickup_events_admin on public.pickup_events for select to authenticated using (public.is_school_admin(school_id));

do $$
declare t text;
begin
  foreach t in array array['pickup_people', 'pickup_people_students', 'pickup_codes', 'pickup_code_students', 'pickup_events'] loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
  end loop;
end $$;

revoke execute on function public.check_pickup_refs() from public, anon, authenticated;
revoke execute on function public.check_card_uid_unused() from public, anon, authenticated;
