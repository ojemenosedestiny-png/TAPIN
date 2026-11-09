-- TapIn â€” Stage 1 foundation schema
-- Multi-school: every tenant table carries school_id and has Row Level Security.
-- Writes that bypass RLS (taps, SMS, device tokens, user creation) happen only on
-- the server with the service role key.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role      as enum ('super_admin', 'school_admin', 'teacher');
create type public.holder_type    as enum ('student', 'staff');
create type public.card_status    as enum ('active', 'blocked', 'replaced');
create type public.student_status as enum ('active', 'inactive', 'graduated', 'withdrawn');
create type public.sms_type       as enum ('arrival', 'departure', 'absence', 'late');
create type public.sms_status     as enum ('queued', 'sent', 'failed', 'skipped');

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.schools (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null check (length(trim(name)) between 2 and 120),
  logo_url            text,
  timezone            text not null default 'Africa/Lagos',
  resumption_time     time not null default '07:45',
  closing_time        time not null default '14:00',
  absence_cutoff_time time not null default '09:00',
  sms_sender_name     text check (sms_sender_name is null or length(sms_sender_name) <= 11),
  created_at          timestamptz not null default now()
);

-- Staff logins. id = auth.users.id. super_admin has no school.
create table public.users (
  id         uuid primary key references auth.users (id) on delete cascade,
  school_id  uuid references public.schools (id) on delete cascade,
  name       text not null,
  email      text not null unique,
  role       public.user_role not null,
  created_at timestamptz not null default now(),
  constraint users_school_required check (
    (role = 'super_admin' and school_id is null) or
    (role <> 'super_admin' and school_id is not null)
  )
);
create index users_school_idx on public.users (school_id);

create table public.classes (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  name             text not null,
  class_teacher_id uuid references public.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (school_id, name)
);
create index classes_teacher_idx on public.classes (class_teacher_id);

create table public.students (
  id            uuid primary key default gen_random_uuid(),
  school_id     uuid not null references public.schools (id) on delete cascade,
  class_id      uuid references public.classes (id) on delete set null,
  admission_no  text not null,
  first_name    text not null,
  last_name     text not null,
  photo_url     text,
  status        public.student_status not null default 'active',
  created_at    timestamptz not null default now(),
  unique (school_id, admission_no)
);
create index students_class_idx on public.students (school_id, class_id);

create table public.guardians (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id) on delete cascade,
  name         text not null,
  phone        text not null,
  relationship text,
  created_at   timestamptz not null default now()
);
create index guardians_school_idx on public.guardians (school_id);

create table public.student_guardians (
  school_id   uuid not null references public.schools (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  guardian_id uuid not null references public.guardians (id) on delete cascade,
  primary key (student_id, guardian_id)
);
create index student_guardians_guardian_idx on public.student_guardians (guardian_id);

create table public.staff (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  name       text not null,
  photo_url  text,
  phone      text,
  created_at timestamptz not null default now()
);
create index staff_school_idx on public.staff (school_id);

create table public.cards (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  uid         text not null check (uid ~ '^[0-9A-F]{8,20}$'),
  holder_type public.holder_type not null,
  holder_id   uuid not null,
  status      public.card_status not null default 'active',
  verified_at timestamptz,
  created_at  timestamptz not null default now()
);
-- A physical card can only be linked once, platform-wide.
create unique index cards_uid_key on public.cards (uid);
-- A person can hold at most one active card.
create unique index cards_one_active_per_holder
  on public.cards (holder_type, holder_id) where status = 'active';
create index cards_school_idx on public.cards (school_id);

create table public.devices (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  name       text not null,
  token_hash text not null unique,
  last_seen  timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index devices_school_idx on public.devices (school_id);

create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  holder_type public.holder_type not null,
  holder_id   uuid not null,
  date        date not null,
  sign_in_at  timestamptz,
  sign_out_at timestamptz,
  device_id   uuid references public.devices (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (school_id, holder_type, holder_id, date)
);
create index attendance_school_date_idx on public.attendance (school_id, date);

create table public.sms_logs (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  phone      text not null,
  message    text not null,
  type       public.sms_type not null,
  status     public.sms_status not null default 'queued',
  -- student + date + alert type (+ phone) â€” stops duplicate alerts.
  dedupe_key text not null unique,
  attempts   int not null default 0,
  last_error text,
  created_at timestamptz not null default now()
);
create index sms_logs_school_idx on public.sms_logs (school_id, created_at desc);

create table public.school_calendar (
  school_id  uuid not null references public.schools (id) on delete cascade,
  date       date not null,
  is_holiday boolean not null default true,
  note       text,
  primary key (school_id, date)
);

create table public.audit_logs (
  id         bigint generated always as identity primary key,
  school_id  uuid references public.schools (id) on delete cascade,
  actor_id   uuid references public.users (id) on delete set null,
  action     text not null,
  entity     text not null,
  entity_id  text,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_school_idx on public.audit_logs (school_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer so policies don't recurse into users RLS)
-- ---------------------------------------------------------------------------
create or replace function public.current_school_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select school_id from public.users where id = auth.uid()
$$;

create or replace function public.app_role()
returns public.user_role language sql stable security definer set search_path = '' as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public.is_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select role = 'super_admin' from public.users where id = auth.uid()), false)
$$;

create or replace function public.is_school_admin(target_school uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'school_admin' and school_id = target_school
  )
$$;

create or replace function public.is_school_member(target_school uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.users where id = auth.uid() and school_id = target_school
  )
$$;

-- True when the current user is the class teacher of the given class.
create or replace function public.teaches_class(target_class uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.classes where id = target_class and class_teacher_id = auth.uid()
  )
$$;

-- True when the current user may see the given student (school admin, or class teacher).
create or replace function public.can_view_student(target_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.students s
    join public.users u on u.id = auth.uid() and u.school_id = s.school_id
    left join public.classes c on c.id = s.class_id
    where s.id = target_student
      and (u.role = 'school_admin' or (u.role = 'teacher' and c.class_teacher_id = u.id))
  )
$$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.current_school_id(), public.app_role(), public.is_super_admin(),
  public.is_school_admin(uuid), public.is_school_member(uuid),
  public.teaches_class(uuid), public.can_view_student(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------
alter table public.schools           enable row level security;
alter table public.users             enable row level security;
alter table public.classes           enable row level security;
alter table public.students          enable row level security;
alter table public.guardians         enable row level security;
alter table public.student_guardians enable row level security;
alter table public.staff             enable row level security;
alter table public.cards             enable row level security;
alter table public.devices           enable row level security;
alter table public.attendance        enable row level security;
alter table public.sms_logs          enable row level security;
alter table public.school_calendar   enable row level security;
alter table public.audit_logs        enable row level security;

-- Nothing is readable without logging in.
revoke all on all tables in schema public from anon;

-- schools: members read their own; super admin reads all (platform health).
create policy schools_select on public.schools for select to authenticated
  using (id = public.current_school_id() or public.is_super_admin());
create policy schools_update on public.schools for update to authenticated
  using (public.is_school_admin(id)) with check (public.is_school_admin(id));
create policy schools_insert on public.schools for insert to authenticated
  with check (public.is_super_admin());

-- users: see yourself, colleagues in your school; super admin sees all logins.
-- No write policies â€” accounts are created/changed server-side with the service role.
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or school_id = public.current_school_id() or public.is_super_admin());

-- classes: whole school can read; school admin writes.
create policy classes_select on public.classes for select to authenticated
  using (public.is_school_member(school_id));
create policy classes_write on public.classes for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

-- students: school admin sees all in school; teachers only their own classes.
-- Super admin has NO routine access to student records.
create policy students_select on public.students for select to authenticated
  using (public.is_school_admin(school_id) or
         (public.is_school_member(school_id) and public.teaches_class(class_id)));
create policy students_write on public.students for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

-- guardians + links: school admin only (phone numbers are sensitive).
create policy guardians_all on public.guardians for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy student_guardians_all on public.student_guardians for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

-- staff: school members read; admin writes.
create policy staff_select on public.staff for select to authenticated
  using (public.is_school_member(school_id));
create policy staff_write on public.staff for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

-- cards: school admin only. (Link/replace/reassign go through server transactions.)
create policy cards_all on public.cards for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

-- devices: school admin reads/updates (revoke); super admin reads (platform health).
-- Creation happens server-side so the token can be hashed.
create policy devices_select on public.devices for select to authenticated
  using (public.is_school_admin(school_id) or public.is_super_admin());
create policy devices_update on public.devices for update to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
-- The token hash never leaves the server.
revoke select on public.devices from authenticated;
grant select (id, school_id, name, last_seen, revoked_at, created_at) on public.devices to authenticated;
revoke insert, update on public.devices from authenticated;
grant update (name, revoked_at) on public.devices to authenticated;

-- attendance: admin sees whole school; teachers see students in their classes.
-- Rows are written by /api/tap with the service role.
create policy attendance_select on public.attendance for select to authenticated
  using (public.is_school_admin(school_id) or
         (holder_type = 'student' and public.can_view_student(holder_id)));

-- sms_logs: school admin reads.
create policy sms_logs_select on public.sms_logs for select to authenticated
  using (public.is_school_admin(school_id));

-- calendar: school reads, admin writes.
create policy calendar_select on public.school_calendar for select to authenticated
  using (public.is_school_member(school_id));
create policy calendar_write on public.school_calendar for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

-- audit logs: school admin reads own school; super admin reads all. Written server-side.
create policy audit_select on public.audit_logs for select to authenticated
  using (public.is_school_admin(school_id) or public.is_super_admin());

-- ---------------------------------------------------------------------------
-- Storage: private photos bucket, path = <school_id>/<file>
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 204800, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy photos_select on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.current_school_id()::text);
create policy photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (storage.foldername(name))[1] = public.current_school_id()::text and public.app_role() = 'school_admin');
create policy photos_update on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.current_school_id()::text and public.app_role() = 'school_admin');
create policy photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (storage.foldername(name))[1] = public.current_school_id()::text and public.app_role() = 'school_admin');
