-- Teacher lesson check (spec 2), director alerts (spec 4) and the Basic/Premium plan switch.
-- Everything is scoped by school_id. The kiosk writes lessons through the service role only.

-- ---------------------------------------------------------------------------
-- Plans: Basic (website "Starter") and Premium (website "Standard").
-- ---------------------------------------------------------------------------
alter table public.schools add column if not exists plan text not null default 'basic'
  check (plan in ('basic', 'premium'));

-- ---------------------------------------------------------------------------
-- Lesson rules and director alerts, one row per school.
-- ---------------------------------------------------------------------------
create table if not exists public.lesson_settings (
  school_id             uuid primary key references public.schools (id) on delete cascade,
  enabled               boolean not null default false, -- off: staff taps work exactly as before
  min_minutes           integer not null default 20 check (min_minutes between 1 and 600),
  max_minutes           integer not null default 90 check (max_minutes between 2 and 720),
  autoclose_time        time not null default '17:00',  -- open lessons close and teachers are signed out
  director_phone        text check (director_phone is null or director_phone ~ '^\+234[0-9]{10}$'),
  director_alerts       text not null default 'off' check (director_alerts in ('off', 'every', 'flagged', 'daily')),
  director_summary_time time not null default '17:30',
  updated_at            timestamptz not null default now(),
  check (max_minutes > min_minutes)
);

-- ---------------------------------------------------------------------------
-- Subjects, and which teacher teaches which class and subject (the kiosk offers these first).
-- ---------------------------------------------------------------------------
create table if not exists public.subjects (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  name       text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now(),
  unique (school_id, name)
);

create table if not exists public.teacher_assignments (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools (id) on delete cascade,
  staff_id   uuid not null references public.staff (id) on delete cascade,
  class_id   uuid not null references public.classes (id) on delete cascade,
  subject_id uuid not null references public.subjects (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (staff_id, class_id, subject_id)
);
create index if not exists teacher_assignments_school_idx on public.teacher_assignments (school_id, staff_id);

-- ---------------------------------------------------------------------------
-- Lessons. Class and subject names are copied in, so the log survives renames and deletions.
-- ---------------------------------------------------------------------------
create table if not exists public.lessons (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools (id) on delete cascade,
  staff_id         uuid not null references public.staff (id) on delete cascade,
  class_id         uuid references public.classes (id) on delete set null,
  subject_id       uuid references public.subjects (id) on delete set null,
  class_name       text not null,
  subject_name     text not null,
  date             date not null,                      -- school-local date the lesson started
  started_at       timestamptz not null,
  ended_at         timestamptz,
  duration_minutes integer generated always as (
    case when ended_at is null then null else floor(extract(epoch from (ended_at - started_at)) / 60)::integer end
  ) stored,
  status           text not null default 'open' check (status in ('open', 'closed', 'auto_closed')),
  flags            text[] not null default '{}',        -- too_short, too_long, auto_closed
  start_device_id  uuid references public.devices (id) on delete set null,
  end_device_id    uuid references public.devices (id) on delete set null,
  start_tap_id     bigint unique references public.tap_events (id) on delete set null,
  created_at       timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at),
  check ((status = 'open') = (ended_at is null))
);
-- A teacher has at most one open lesson.
create unique index if not exists lessons_one_open on public.lessons (staff_id) where status = 'open';
create index if not exists lessons_school_date_idx on public.lessons (school_id, date desc, started_at desc);
create index if not exists lessons_staff_idx on public.lessons (staff_id, started_at desc);

-- Staff signed out automatically at the auto-close time.
alter table public.attendance add column if not exists auto_signed_out boolean not null default false;

-- Rows must point at things in the same school.
create or replace function public.check_lesson_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.staff where id = new.staff_id and school_id = new.school_id) then
    raise exception 'staff member is not in this school';
  end if;
  if new.class_id is not null and not exists (select 1 from public.classes where id = new.class_id and school_id = new.school_id) then
    raise exception 'class is not in this school';
  end if;
  if new.subject_id is not null and not exists (select 1 from public.subjects where id = new.subject_id and school_id = new.school_id) then
    raise exception 'subject is not in this school';
  end if;
  return new;
end;
$$;
drop trigger if exists teacher_assignments_refs on public.teacher_assignments;
create trigger teacher_assignments_refs before insert or update on public.teacher_assignments
  for each row execute function public.check_lesson_refs();
drop trigger if exists lessons_refs on public.lessons;
create trigger lessons_refs before insert or update of staff_id, class_id, subject_id, school_id on public.lessons
  for each row execute function public.check_lesson_refs();

-- ---------------------------------------------------------------------------
-- Row level security: school admins only.
-- ---------------------------------------------------------------------------
alter table public.lesson_settings enable row level security;
alter table public.subjects enable row level security;
alter table public.teacher_assignments enable row level security;
alter table public.lessons enable row level security;
revoke all on public.lesson_settings, public.subjects, public.teacher_assignments, public.lessons from anon;

create policy lesson_settings_select on public.lesson_settings for select to authenticated using (public.is_school_admin(school_id));
create policy lesson_settings_write on public.lesson_settings for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy subjects_select on public.subjects for select to authenticated using (public.is_school_member(school_id));
create policy subjects_write on public.subjects for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
create policy teacher_assignments_select on public.teacher_assignments for select to authenticated using (public.is_school_admin(school_id));
create policy teacher_assignments_write on public.teacher_assignments for all to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));
-- Lessons are written by the kiosk (service role) only.
create policy lessons_select on public.lessons for select to authenticated using (public.is_school_admin(school_id));

do $$
declare t text;
begin
  foreach t in array array['lesson_settings', 'subjects', 'teacher_assignments', 'lessons'] loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Flags for a finished lesson. Same rules as lib/lessons.ts (unit tested there).
-- ---------------------------------------------------------------------------
create or replace function public.lesson_flags(p_minutes integer, p_min integer, p_max integer, p_auto boolean)
returns text[] language sql immutable set search_path = '' as $$
  select array_remove(array[
    case when p_minutes < p_min then 'too_short' end,
    case when p_minutes > p_max then 'too_long' end,
    case when p_auto then 'auto_closed' end
  ], null)
$$;

-- ---------------------------------------------------------------------------
-- Auto-close: at the school's auto-close time, open lessons end (flag auto_closed) and teachers
-- still signed in are signed out. Also catches anything left open from earlier days.
-- ---------------------------------------------------------------------------
create or replace function public.auto_close_lessons(p_now timestamptz default now(), p_school uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s record;
  l record;
  v_local timestamp;
  v_end timestamptz;
  v_flags text[];
  v_count integer := 0;
begin
  for s in
    select sc.id, sc.name, sc.timezone, ls.autoclose_time, ls.min_minutes, ls.max_minutes, ls.director_phone, ls.director_alerts
    from public.schools sc join public.lesson_settings ls on ls.school_id = sc.id
    where ls.enabled and (p_school is null or sc.id = p_school)
  loop
    v_local := p_now at time zone s.timezone;

    for l in
      select le.* from public.lessons le
      where le.school_id = s.id and le.status = 'open'
        and (le.date < v_local::date or v_local::time >= s.autoclose_time)
    loop
      v_end := greatest(l.started_at, least(p_now, (l.date + s.autoclose_time) at time zone s.timezone));
      v_flags := public.lesson_flags(floor(extract(epoch from (v_end - l.started_at)) / 60)::integer, s.min_minutes, s.max_minutes, true);
      update public.lessons set ended_at = v_end, status = 'auto_closed', flags = v_flags
        where id = l.id and status = 'open';
      if found then
        v_count := v_count + 1;
        if s.director_phone is not null and s.director_alerts in ('every', 'flagged') then
          insert into public.sms_logs (school_id, phone, message, type, dedupe_key)
          select s.id, s.director_phone,
            st.name || ' did not end ' || l.class_name || ' ' || l.subject_name || ' (started ' ||
              to_char(l.started_at at time zone s.timezone, 'FMHH12:MI AM') || '). Closed automatically. ' || s.name || ', TapIn.',
            'director', 'lesson:' || l.id
          from public.staff st where st.id = l.staff_id
          on conflict (dedupe_key) do nothing;
        end if;
      end if;
    end loop;

    -- Teachers who forgot to sign out (today after the auto-close time, or yesterday).
    update public.attendance a
      set sign_out_at = greatest(a.sign_in_at, least(p_now, (a.date + s.autoclose_time) at time zone s.timezone)),
          auto_signed_out = true
      where a.school_id = s.id and a.holder_type = 'staff' and a.sign_in_at is not null and a.sign_out_at is null
        and a.date >= v_local::date - 1
        and (a.date < v_local::date or v_local::time >= s.autoclose_time);
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Director daily summary, sent once after the summary time on school days.
-- ---------------------------------------------------------------------------
create or replace function public.queue_director_summaries(p_now timestamptz default now(), p_school uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_local timestamp;
  v_date date;
  v_lessons integer;
  v_minutes integer;
  v_flagged integer;
  v_in integer;
  v_staff integer;
  v_count integer := 0;
begin
  for s in
    select sc.id, sc.name, sc.timezone, ls.director_phone, ls.director_summary_time
    from public.schools sc join public.lesson_settings ls on ls.school_id = sc.id
    where ls.enabled and ls.director_alerts = 'daily' and ls.director_phone is not null
      and (p_school is null or sc.id = p_school)
  loop
    v_local := p_now at time zone s.timezone;
    v_date := v_local::date;
    continue when v_local::time < s.director_summary_time or v_local::time > s.director_summary_time + interval '3 hours';
    continue when not public.is_school_day(s.id, v_date);

    select count(*), coalesce(sum(duration_minutes), 0), count(*) filter (where cardinality(flags) > 0)
      into v_lessons, v_minutes, v_flagged
      from public.lessons where school_id = s.id and date = v_date;
    select count(*) into v_staff from public.staff where school_id = s.id and status = 'active';
    select count(*) into v_in from public.attendance
      where school_id = s.id and holder_type = 'staff' and date = v_date and sign_in_at is not null;

    insert into public.sms_logs (school_id, phone, message, type, dedupe_key)
    values (s.id, s.director_phone,
      s.name || ' today: ' || v_in || ' of ' || v_staff || ' teachers in. ' || v_lessons || ' lessons, ' ||
        (v_minutes / 60) || 'h ' || (v_minutes % 60) || 'm taught' ||
        case when v_flagged > 0 then ', ' || v_flagged || ' flagged' else '' end || '. TapIn.',
      'director', 'director:' || s.id || ':' || v_date)
    on conflict (dedupe_key) do nothing;
    if found then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end;
$$;

revoke execute on function public.auto_close_lessons(timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.queue_director_summaries(timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.check_lesson_refs() from public, anon, authenticated;

select cron.schedule('tapin-lessons-15min', '*/15 * * * *',
  $$select public.auto_close_lessons(); select public.queue_director_summaries();$$);
