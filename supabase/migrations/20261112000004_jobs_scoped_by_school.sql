-- Scheduled jobs can be limited to one school (p_school). The real schedule passes nothing and
-- runs for every school; tests pass their throwaway school so they never touch real schools.
drop function if exists public.queue_absence_alerts(timestamptz);
drop function if exists public.check_offline_devices(timestamptz);
drop function if exists public.queue_daily_summaries(timestamptz);
drop function if exists public.queue_watch_notifications(timestamptz);

create or replace function public.queue_absence_alerts(p_now timestamptz default now(), p_school uuid default null)
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
    where a.absence_enabled and (p_school is null or sc.id = p_school)
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

create or replace function public.check_offline_devices(p_now timestamptz default now(), p_school uuid default null)
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
      and (p_school is null or dv.school_id = p_school)
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

create or replace function public.queue_daily_summaries(p_now timestamptz default now(), p_school uuid default null)
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
    where a.summary_mode and (p_school is null or sc.id = p_school)
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

create or replace function public.queue_watch_notifications(p_now timestamptz default now(), p_school uuid default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_today date;
  v_absent integer;
  v_late integer;
  v_count integer := 0;
begin
  for s in select id, timezone from public.schools where p_school is null or id = p_school loop
    v_today := (p_now at time zone s.timezone)::date;
    with days as (
      select d::date as date from generate_series(v_today - 29, v_today - 1, interval '1 day') d
      where extract(isodow from d) < 6 and public.is_school_day(s.id, d::date)
    ), per as (
      select st.id,
        count(*) filter (where a.sign_in_at is null and e.id is null) as absent,
        count(*) filter (where date_trunc('minute', a.sign_in_at at time zone s.timezone)::time > sc.resumption_time) as late
      from public.students st
      join public.schools sc on sc.id = st.school_id
      cross join days
      left join public.attendance a on a.holder_type = 'student' and a.holder_id = st.id and a.date = days.date
      left join public.excusals e on e.student_id = st.id and e.date = days.date
      where st.school_id = s.id and st.status = 'active' and days.date >= (st.created_at at time zone s.timezone)::date
      group by st.id
    )
    select count(*) filter (where absent >= 3), count(*) filter (where late >= 5) into v_absent, v_late from per;
    continue when coalesce(v_absent, 0) + coalesce(v_late, 0) = 0;
    insert into public.notifications (school_id, kind, message, dedupe_key)
    values (s.id, 'attendance_watch',
      concat_ws(' ', case when v_absent > 0 then v_absent || ' student' || case when v_absent = 1 then '' else 's' end || ' missed 3 or more days' end,
                     case when v_absent > 0 and v_late > 0 then 'and' end,
                     case when v_late > 0 then v_late || ' were late 5 or more times' end) || ' in the last 30 days.',
      'watch:' || s.id || ':' || to_char(v_today, 'IYYY-IW'))
    on conflict (dedupe_key) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke execute on function
  public.queue_absence_alerts(timestamptz, uuid), public.check_offline_devices(timestamptz, uuid),
  public.queue_daily_summaries(timestamptz, uuid), public.queue_watch_notifications(timestamptz, uuid)
from public, anon, authenticated;
grant execute on function
  public.queue_absence_alerts(timestamptz, uuid), public.check_offline_devices(timestamptz, uuid),
  public.queue_daily_summaries(timestamptz, uuid), public.queue_watch_notifications(timestamptz, uuid)
to service_role;
