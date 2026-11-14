-- Parent handover at drop-off and pickup, bus children, WhatsApp pickup codes, parent absence reports,
-- early pickup requests and the late-pickup alert. Every row belongs to one school.

-- Bus children tap alone; parent-pickup children are handed over.
alter table public.students
  add column if not exists transport text not null default 'parent' check (transport in ('parent', 'bus'));

-- Minutes after closing before "still in school" alerts the parent.
alter table public.schools
  add column if not exists late_pickup_minutes integer not null default 30 check (late_pickup_minutes between 0 and 240);

-- A parent taps with their own card: the pickup person record linked to that parent. One per parent.
create unique index if not exists pickup_people_one_per_guardian on public.pickup_people (guardian_id) where guardian_id is not null;

-- Kiosk lock after repeated wrong pickup codes.
alter table public.devices
  add column if not exists code_failures integer not null default 0,
  add column if not exists code_locked_until timestamptz;

-- Where a pickup code came from.
alter table public.pickup_codes
  add column if not exists source text not null default 'portal' check (source in ('portal', 'whatsapp', 'school'));

-- Absences reported by a parent (WhatsApp or portal), not only by the office.
alter table public.excusals
  add column if not exists guardian_id uuid references public.guardians (id) on delete set null,
  add column if not exists source text not null default 'school' check (source in ('school', 'whatsapp', 'portal'));

-- ---------------------------------------------------------------------------------------------------
-- Handovers: one row per drop-off or pickup attempt at the kiosk.
--   drop_off: the child taps (signed in), then the parent taps within the window → matched.
--             No parent in time → no_parent (still signed in, flagged for staff).
--   pick_up:  the parent taps, then the child → matched; staff confirm the faces → confirmed (signed out).
--             A person not linked to the child → refused (child NOT released, admin alerted).
create table if not exists public.handovers (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools (id) on delete cascade,
  kind           text not null check (kind in ('drop_off', 'pick_up')),
  status         text not null default 'waiting'
                   check (status in ('waiting', 'matched', 'confirmed', 'no_parent', 'refused', 'cancelled')),
  date           date not null,                       -- school-local date
  student_id     uuid references public.students (id) on delete cascade,
  person_id      uuid references public.pickup_people (id) on delete set null,
  code_id        uuid references public.pickup_codes (id) on delete set null,
  device_id      uuid references public.devices (id) on delete set null,
  child_tap_id   bigint references public.tap_events (id) on delete set null,
  person_tap_id  bigint references public.tap_events (id) on delete set null,
  started_at     timestamptz not null default now(),
  expires_at     timestamptz not null,                -- end of the handover window
  completed_at   timestamptz,
  note           text check (note is null or length(note) <= 300),
  check (expires_at > started_at),
  check (student_id is not null or person_id is not null)
);
create index if not exists handovers_school_day on public.handovers (school_id, date desc);
create index if not exists handovers_student_day on public.handovers (student_id, date);
-- At most one open window per kiosk.
create unique index if not exists handovers_one_open_per_device on public.handovers (device_id) where status = 'waiting';

create or replace function public.check_handover_refs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.student_id is not null and not exists (select 1 from public.students s where s.id = new.student_id and s.school_id = new.school_id) then
    raise exception 'student belongs to another school';
  end if;
  if new.person_id is not null and not exists (select 1 from public.pickup_people p where p.id = new.person_id and p.school_id = new.school_id) then
    raise exception 'pickup person belongs to another school';
  end if;
  if new.device_id is not null and not exists (select 1 from public.devices d where d.id = new.device_id and d.school_id = new.school_id) then
    raise exception 'device belongs to another school';
  end if;
  return new;
end $$;
revoke execute on function public.check_handover_refs() from public, anon, authenticated;
drop trigger if exists handovers_refs on public.handovers;
create trigger handovers_refs before insert or update on public.handovers for each row execute function public.check_handover_refs();

alter table public.handovers enable row level security;
revoke all on public.handovers from anon;
create policy handovers_admin on public.handovers for select to authenticated using (public.is_school_admin(school_id));
drop policy if exists mfa_required on public.handovers;
create policy mfa_required on public.handovers as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

-- ---------------------------------------------------------------------------------------------------
-- Early pickup requests from parents ("I'm collecting Ada at 12"). The office approves or declines;
-- approval creates the early release that lets the child sign out early.
create table if not exists public.early_pickup_requests (
  id           uuid primary key default gen_random_uuid(),
  school_id    uuid not null references public.schools (id) on delete cascade,
  student_id   uuid not null references public.students (id) on delete cascade,
  guardian_id  uuid references public.guardians (id) on delete set null,
  date         date not null,
  at_time      time,
  note         text check (note is null or length(note) <= 300),
  source       text not null default 'whatsapp' check (source in ('whatsapp', 'portal')),
  status       text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  handled_by   uuid references public.users (id) on delete set null,
  handled_at   timestamptz,
  created_at   timestamptz not null default now(),
  unique (student_id, date)
);
create index if not exists early_pickup_school_day on public.early_pickup_requests (school_id, date desc);

create or replace function public.check_early_pickup_refs() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.students s where s.id = new.student_id and s.school_id = new.school_id) then
    raise exception 'student belongs to another school';
  end if;
  if new.guardian_id is not null and not exists (select 1 from public.guardians g where g.id = new.guardian_id and g.school_id = new.school_id) then
    raise exception 'guardian belongs to another school';
  end if;
  return new;
end $$;
revoke execute on function public.check_early_pickup_refs() from public, anon, authenticated;
drop trigger if exists early_pickup_refs on public.early_pickup_requests;
create trigger early_pickup_refs before insert or update on public.early_pickup_requests for each row execute function public.check_early_pickup_refs();

alter table public.early_pickup_requests enable row level security;
revoke all on public.early_pickup_requests from anon;
create policy early_pickup_admin on public.early_pickup_requests for select to authenticated using (public.is_school_admin(school_id));
drop policy if exists mfa_required on public.early_pickup_requests;
create policy mfa_required on public.early_pickup_requests as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

-- Dashboard notices. Also fixes a bug: 'pickup_denied' and 'emergency' were written by the app but never
-- allowed here, so those notices were silently rejected.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('unknown_card', 'device_offline', 'late_arrival', 'sms_failed', 'allowance', 'attendance_watch',
                  'pickup_denied', 'emergency',
                  'handover_flag', 'early_pickup', 'code_lock', 'renewal_due'));

-- Handovers are kept like tap history: with the school, deleted when it goes.
