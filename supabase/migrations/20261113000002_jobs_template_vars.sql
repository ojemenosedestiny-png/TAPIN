-- Absence and summary messages also record their values ({{1}} name, {{2}} school, {{3}} date or times)
-- so they can be sent as WhatsApp templates.
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

    insert into public.sms_logs (school_id, student_id, guardian_id, phone, message, type, dedupe_key, vars)
    select s.id, st.id, g.id, g.phone,
           public.render_template(s.absence_template, jsonb_build_object(
             'full_name', st.first_name || ' ' || st.last_name, 'first_name', st.first_name,
             'school', s.name, 'date', to_char(v_date, 'FMDay FMDD FMMonth'))),
           'absence',
           st.id || ':' || v_date || ':absence:' || g.id,
           jsonb_build_object('1', st.first_name || ' ' || st.last_name, '2', s.name, '3', to_char(v_date, 'FMDay FMDD FMMonth'))
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

    insert into public.sms_logs (school_id, student_id, guardian_id, phone, message, type, dedupe_key, vars)
    select s.id, st.id, g.id, g.phone,
           st.first_name || ' ' || st.last_name || ' today at ' || s.name || ': arrived ' ||
             to_char(at.sign_in_at at time zone s.timezone, 'FMHH12:MI AM') ||
             coalesce(', left ' || to_char(at.sign_out_at at time zone s.timezone, 'FMHH12:MI AM'), ', no sign-out recorded') || '.',
           'summary',
           st.id || ':' || v_date || ':summary:' || g.id,
           jsonb_build_object('1', st.first_name || ' ' || st.last_name, '2', s.name,
             '3', 'arrived ' || to_char(at.sign_in_at at time zone s.timezone, 'FMHH12:MI AM') ||
                  coalesce(', left ' || to_char(at.sign_out_at at time zone s.timezone, 'FMHH12:MI AM'), ''))
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
