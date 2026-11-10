-- Staff attendance report. Runs as the caller: staff attendance is visible to school admins only
-- (teachers get nothing), and a school sees only its own staff.
create or replace function public.staff_summary(p_from date, p_to date)
returns table (staff_id uuid, school_days integer, present integer, late integer, absent integer,
               early_leaves integer, avg_arrival time, avg_minutes_on_site integer)
language sql stable security invoker set search_path = '' as $$
  with s as (
    select id, timezone, resumption_time, (now() at time zone timezone) as local_now
    from public.schools where id = public.current_school_id()
  ),
  days as (
    select d::date as date
    from s, generate_series(p_from, least(p_to, s.local_now::date), interval '1 day') d
    where extract(isodow from d) < 6
      and not exists (select 1 from public.school_calendar c where c.school_id = s.id and c.date = d::date and c.is_holiday)
  ),
  rows as (
    select st.id as staff_id, days.date, a.sign_in_at, a.sign_out_at, coalesce(a.early_release, false) as early,
           (a.sign_in_at at time zone s.timezone)::time as arrived, s.resumption_time
    from public.staff st cross join days cross join s
    left join public.attendance a on a.holder_type = 'staff' and a.holder_id = st.id and a.date = days.date
    where st.school_id = s.id and st.status = 'active' and days.date >= (st.created_at at time zone s.timezone)::date
  )
  select staff_id,
    count(*)::int,
    count(*) filter (where sign_in_at is not null)::int,
    count(*) filter (where date_trunc('minute', arrived) > resumption_time)::int,
    count(*) filter (where sign_in_at is null)::int,
    count(*) filter (where early)::int,
    (avg(arrived - time '00:00') + time '00:00')::time(0),
    (avg(extract(epoch from (sign_out_at - sign_in_at)) / 60) filter (where sign_out_at is not null))::int
  from rows
  group by staff_id
$$;
revoke execute on function public.staff_summary(date, date) from public, anon;
grant execute on function public.staff_summary(date, date) to authenticated;
