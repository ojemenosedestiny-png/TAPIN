-- TapIn — Stage 4: alerts (build plan §5)
--  * per-school alert settings: on/off per type, editable templates, quiet hours, monthly allowance, daily summary
--  * sms_logs as the outbox: queued → sending → sent | failed (3 retries, 2 minutes apart) | skipped
--  * absence job, device-offline check and daily summaries in SQL, run by pg_cron every 15 minutes
--  * excused absences, admin/teacher notifications

-- ---------------------------------------------------------------------------
-- Alert settings (one row per school)
-- ---------------------------------------------------------------------------
create table public.alert_settings (
  school_id          uuid primary key references public.schools (id) on delete cascade,
  arrival_enabled    boolean not null default true,
  departure_enabled  boolean not null default true,
  late_enabled       boolean not null default true,
  absence_enabled    boolean not null default true,
  arrival_template   text not null default '{greeting}. {full_name} arrived at {school} at {time}.',
  departure_template text not null default '{full_name} left school at {time}.',
  late_template      text not null default '{full_name} arrived late at {school} at {time}.',
  absence_template   text not null default 'Dear parent, {full_name} has not signed in at {school} today. Please contact the school if anything is wrong.',
  summary_mode       boolean not null default false, -- combine arrival + departure into one evening SMS
  summary_time       time not null default '17:00',
  quiet_start        time not null default '20:00',  -- messages wait until quiet_end
  quiet_end          time not null default '06:00',
  monthly_allowance  integer not null default 5000 check (monthly_allowance >= 0),
  updated_at         timestamptz not null default now(),
  constraint templates_not_blank check (
    length(trim(arrival_template)) > 0 and length(trim(departure_template)) > 0 and
    length(trim(late_template)) > 0 and length(trim(absence_template)) > 0
  ),
  constraint templates_length check (
    length(arrival_template) <= 480 and length(departure_template) <= 480 and
    length(late_template) <= 480 and length(absence_template) <= 480
  )
);

insert into public.alert_settings (school_id) select id from public.schools on conflict do nothing;

create or replace function public.create_alert_settings()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.alert_settings (school_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
create trigger schools_alert_settings after insert on public.schools
  for each row execute function public.create_alert_settings();

alter table public.alert_settings enable row level security;
revoke all on public.alert_settings from anon;
create policy alert_settings_select on public.alert_settings for select to authenticated
  using (public.is_school_admin(school_id));
create policy alert_settings_update on public.alert_settings for update to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

-- ---------------------------------------------------------------------------
-- sms_logs becomes the outbox
-- ---------------------------------------------------------------------------
alter table public.sms_logs
  add column if not exists guardian_id         uuid references public.guardians (id) on delete set null,
  add column if not exists next_attempt_at     timestamptz not null default now(),
  add column if not exists sending_started_at  timestamptz,
  add column if not exists sent_at             timestamptz,
  add column if not exists provider_message_id text;
create index if not exists sms_logs_outbox_idx on public.sms_logs (next_attempt_at) where status = 'queued';
create index if not exists sms_logs_school_status_idx on public.sms_logs (school_id, status, created_at desc);

-- Admins can retry a failed message (status back to queued) — nothing else.
grant update (status, next_attempt_at, attempts) on public.sms_logs to authenticated;
create policy sms_logs_retry on public.sms_logs for update to authenticated
  using (public.is_school_admin(school_id) and status = 'failed')
  with check (public.is_school_admin(school_id) and status = 'queued');

-- ---------------------------------------------------------------------------
-- Excused absences (sick note, approved leave): skipped by the absence job
-- ---------------------------------------------------------------------------
create table public.excusals (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  date        date not null,
  reason      text not null check (length(trim(reason)) between 2 and 200),
  created_by  uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (student_id, date)
);
create index excusals_school_date_idx on public.excusals (school_id, date);
alter table public.excusals enable row level security;
revoke all on public.excusals from anon;
-- School admin, or the class teacher of that student.
create policy excusals_select on public.excusals for select to authenticated
  using (public.is_school_member(school_id) and public.can_view_student(student_id));
create policy excusals_insert on public.excusals for insert to authenticated
  with check (public.is_school_member(school_id) and public.can_view_student(student_id) and created_by = auth.uid());
create policy excusals_delete on public.excusals for delete to authenticated
  using (public.is_school_member(school_id) and public.can_view_student(student_id));

-- ---------------------------------------------------------------------------
-- Dashboard notifications (unknown card, kiosk offline, late arrival, SMS problems)
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          bigint generated always as identity primary key,
  school_id   uuid not null references public.schools (id) on delete cascade,
  kind        text not null check (kind in ('unknown_card', 'device_offline', 'late_arrival', 'sms_failed', 'allowance')),
  message     text not null,
  class_id    uuid references public.classes (id) on delete cascade, -- set → also shown to that class's teacher
  dedupe_key  text not null unique,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index notifications_school_idx on public.notifications (school_id, created_at desc);
alter table public.notifications enable row level security;
revoke all on public.notifications from anon;
create policy notifications_select on public.notifications for select to authenticated
  using (public.is_school_admin(school_id) or (class_id is not null and public.teaches_class(class_id)));
grant update (read_at) on public.notifications to authenticated;
create policy notifications_mark_read on public.notifications for update to authenticated
  using (public.is_school_admin(school_id)) with check (public.is_school_admin(school_id));

alter table public.devices add column if not exists offline_notified_at timestamptz;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- '{full_name} arrived at {time}' + {"full_name": "Chioma Okafor", "time": "7:42 AM"}
create or replace function public.render_template(p_template text, p_vars jsonb)
returns text language plpgsql immutable set search_path = '' as $$
declare
  k text;
  v text;
  out text := p_template;
begin
  for k, v in select key, value from jsonb_each_text(p_vars) loop
    out := replace(out, '{' || k || '}', coalesce(v, ''));
  end loop;
  return out;
end;
$$;

create or replace function public.is_school_day(p_school uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select extract(isodow from p_date) < 6
     and not exists (select 1 from public.school_calendar c where c.school_id = p_school and c.date = p_date and c.is_holiday)
$$;

-- ---------------------------------------------------------------------------
-- Absence job (build plan §5): after each school's cutoff, on school days, one alert per guardian
-- for active students with no sign-in today and no excusal. Safe to run every 15 minutes:
-- the dedupe key (student + date + type + guardian) means a second run queues nothing new.
-- ---------------------------------------------------------------------------
create or replace function public.queue_absence_alerts(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_local timestamp;
  v_date date;
  v_count integer := 0;
  v_n integer;
begin
  for s in
    select sc.id, sc.name, sc.timezone, sc.absence_cutoff_time, sc.closing_time, a.absence_template
    from public.schools sc join public.alert_settings a on a.school_id = sc.id
    where a.absence_enabled
  loop
    v_local := p_now at time zone s.timezone;
    v_date := v_local::date;
    continue when v_local::time < s.absence_cutoff_time or v_local::time >= s.closing_time;
    continue when not public.is_school_day(s.id, v_date);

    insert into public.sms_logs (school_id, student_id, guardian_id, phone, message, type, dedupe_key)
    select s.id, st.id, g.id, g.phone,
           public.render_template(s.absence_template, jsonb_build_object(
             'full_name', st.first_name || ' ' || st.last_name, 'first_name', st.first_name,
             'school', s.name, 'date', to_char(v_date, 'FMDay FMDD FMMonth'))),
           'absence',
           st.id || ':' || v_date || ':absence:' || g.id
    from public.students st
    join public.student_guardians sg on sg.student_id = st.id
    join public.guardians g on g.id = sg.guardian_id
    where st.school_id = s.id
      and st.status = 'active'
      and st.created_at::date < v_date -- added today: no attendance history yet
      and not exists (select 1 from public.attendance at
                      where at.holder_type = 'student' and at.holder_id = st.id and at.date = v_date)
      and not exists (select 1 from public.excusals e where e.student_id = st.id and e.date = v_date)
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Device offline (build plan §5): a kiosk that hasn't checked in for 10 minutes during
-- the school day → one notification per offline spell.
-- ---------------------------------------------------------------------------
create or replace function public.check_offline_devices(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  d record;
  v_local timestamp;
  v_count integer := 0;
begin
  for d in
    select dv.id, dv.name, dv.last_seen, sc.id as school_id, sc.timezone, sc.resumption_time, sc.closing_time
    from public.devices dv join public.schools sc on sc.id = dv.school_id
    where dv.revoked_at is null
      and dv.last_seen is not null
      and dv.last_seen < p_now - interval '10 minutes'
      and (dv.offline_notified_at is null or dv.offline_notified_at < dv.last_seen)
  loop
    v_local := p_now at time zone d.timezone;
    continue when not public.is_school_day(d.school_id, v_local::date);
    -- From an hour before resumption until an hour after closing.
    continue when v_local::time < d.resumption_time - interval '1 hour' or v_local::time > d.closing_time + interval '1 hour';

    insert into public.notifications (school_id, kind, message, dedupe_key)
    values (d.school_id, 'device_offline', d.name || ' kiosk is offline.', 'offline:' || d.id || ':' || d.last_seen)
    on conflict (dedupe_key) do nothing;
    update public.devices set offline_notified_at = p_now where id = d.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Daily summary (cost saver): one evening SMS per guardian instead of arrival + departure.
-- ---------------------------------------------------------------------------
create or replace function public.queue_daily_summaries(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_local timestamp;
  v_date date;
  v_count integer := 0;
  v_n integer;
begin
  for s in
    select sc.id, sc.name, sc.timezone, a.summary_time
    from public.schools sc join public.alert_settings a on a.school_id = sc.id
    where a.summary_mode
  loop
    v_local := p_now at time zone s.timezone;
    v_date := v_local::date;
    continue when v_local::time < s.summary_time or v_local::time > s.summary_time + interval '3 hours';
    continue when not public.is_school_day(s.id, v_date);

    insert into public.sms_logs (school_id, student_id, guardian_id, phone, message, type, dedupe_key)
    select s.id, st.id, g.id, g.phone,
           st.first_name || ' ' || st.last_name || ' today at ' || s.name || ': arrived ' ||
             to_char(at.sign_in_at at time zone s.timezone, 'FMHH12:MI AM') ||
             coalesce(', left ' || to_char(at.sign_out_at at time zone s.timezone, 'FMHH12:MI AM'), ', no sign-out recorded') || '.',
           'summary',
           st.id || ':' || v_date || ':summary:' || g.id
    from public.attendance at
    join public.students st on st.id = at.holder_id and at.holder_type = 'student'
    join public.student_guardians sg on sg.student_id = st.id
    join public.guardians g on g.id = sg.guardian_id
    where at.school_id = s.id and at.date = v_date and at.sign_in_at is not null and st.status = 'active'
    on conflict (dedupe_key) do nothing;
    get diagnostics v_n = row_count;
    v_count := v_count + v_n;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Outbox: claim a batch to send. SKIP LOCKED lets several senders run safely; a
-- message stuck in 'sending' for 5 minutes (crashed sender) goes back to the queue.
-- ---------------------------------------------------------------------------
create or replace function public.claim_sms(p_limit integer default 50)
returns setof public.sms_logs language plpgsql security definer set search_path = '' as $$
begin
  update public.sms_logs set status = 'queued', sending_started_at = null
    where status = 'sending' and sending_started_at < now() - interval '5 minutes';
  return query
    update public.sms_logs l set status = 'sending', sending_started_at = now()
    where l.id in (
      select id from public.sms_logs
      where status = 'queued' and next_attempt_at <= now()
      order by created_at
      for update skip locked
      limit p_limit)
    returning l.*;
end;
$$;

-- Messages sent this calendar month (school timezone) — for the allowance.
create or replace function public.sms_sent_this_month(p_school uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::int from public.sms_logs l join public.schools s on s.id = l.school_id
  where l.school_id = p_school and l.status = 'sent'
    and date_trunc('month', l.sent_at at time zone s.timezone) = date_trunc('month', now() at time zone s.timezone)
$$;

revoke execute on function
  public.render_template(text, jsonb), public.is_school_day(uuid, date),
  public.queue_absence_alerts(timestamptz), public.check_offline_devices(timestamptz),
  public.queue_daily_summaries(timestamptz), public.claim_sms(integer), public.create_alert_settings()
from public, anon, authenticated;
grant execute on function
  public.render_template(text, jsonb), public.is_school_day(uuid, date),
  public.queue_absence_alerts(timestamptz), public.check_offline_devices(timestamptz),
  public.queue_daily_summaries(timestamptz), public.claim_sms(integer)
to service_role;
revoke execute on function public.sms_sent_this_month(uuid) from public, anon, authenticated;
grant execute on function public.sms_sent_this_month(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Schedule: every 15 minutes (pg_cron). Sending needs Termii over HTTPS, which the app
-- does — see README "Scheduled sending" for the pg_net call to /api/cron/send.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron;
select cron.schedule('tapin-alerts-15min', '*/15 * * * *',
  $$select public.queue_absence_alerts(); select public.check_offline_devices(); select public.queue_daily_summaries();$$);
