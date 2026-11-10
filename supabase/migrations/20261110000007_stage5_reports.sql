-- TapIn — Stage 5: reports and the Today dashboard.
-- These run as the CALLER (security invoker), so Row Level Security still decides what each
-- person sees: a teacher only ever gets their own classes, a super admin gets nothing.

-- One row per (active student, school day) with the day's status:
--   present | late | absent | excused | pending (today, before the absence cutoff)
-- Weekends, holidays, future days and days before the student was added are left out.
create or replace function public.attendance_days(p_from date, p_to date, p_class uuid default null)
returns table (student_id uuid, class_id uuid, date date, status text, sign_in_at timestamptz, sign_out_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  with s as (
    select id, timezone, resumption_time, absence_cutoff_time,
           (now() at time zone timezone) as local_now
    from public.schools where id = public.current_school_id()
  ),
  days as (
    select d::date as date
    from s, generate_series(p_from, least(p_to, s.local_now::date), interval '1 day') d
    where extract(isodow from d) < 6
      and not exists (select 1 from public.school_calendar c where c.school_id = s.id and c.date = d::date and c.is_holiday)
  ),
  st as (
    select x.id, x.class_id, x.created_at
    from public.students x, s
    where x.school_id = s.id and x.status = 'active' and (p_class is null or x.class_id = p_class)
  )
  select st.id, st.class_id, days.date,
    case
      when a.sign_in_at is not null then
        case when date_trunc('minute', a.sign_in_at at time zone s.timezone)::time > s.resumption_time then 'late' else 'present' end
      when e.id is not null then 'excused'
      when days.date = s.local_now::date and s.local_now::time < s.absence_cutoff_time then 'pending'
      else 'absent'
    end,
    a.sign_in_at, a.sign_out_at
  from st
  cross join days
  cross join s
  left join public.attendance a on a.holder_type = 'student' and a.holder_id = st.id and a.date = days.date
  left join public.excusals e on e.student_id = st.id and e.date = days.date
  where days.date >= (st.created_at at time zone s.timezone)::date
  order by st.id, days.date
$$;

-- Totals per student for a date range.
create or replace function public.attendance_summary(p_from date, p_to date, p_class uuid default null)
returns table (student_id uuid, class_id uuid, school_days integer, present integer, late integer, absent integer, excused integer)
language sql stable security invoker set search_path = '' as $$
  select student_id, class_id,
    count(*) filter (where status <> 'pending')::int,
    count(*) filter (where status = 'present')::int,
    count(*) filter (where status = 'late')::int,
    count(*) filter (where status = 'absent')::int,
    count(*) filter (where status = 'excused')::int
  from public.attendance_days(p_from, p_to, p_class)
  group by student_id, class_id
$$;

-- Today, per class (for the dashboard bar chart and summary cards).
create or replace function public.today_by_class()
returns table (class_id uuid, total integer, present integer, late integer, absent integer, excused integer, pending integer)
language sql stable security invoker set search_path = '' as $$
  with d as (
    select (now() at time zone s.timezone)::date as today
    from public.schools s where s.id = public.current_school_id()
  )
  select class_id,
    count(*)::int,
    count(*) filter (where status = 'present')::int,
    count(*) filter (where status = 'late')::int,
    count(*) filter (where status = 'absent')::int,
    count(*) filter (where status = 'excused')::int,
    count(*) filter (where status = 'pending')::int
  from d, public.attendance_days(d.today, d.today, null)
  group by class_id
$$;

revoke execute on function public.attendance_days(date, date, uuid), public.attendance_summary(date, date, uuid), public.today_by_class() from public, anon;
grant execute on function public.attendance_days(date, date, uuid), public.attendance_summary(date, date, uuid), public.today_by_class() to authenticated;

-- Fast lookups for these.
create index if not exists attendance_holder_date_idx on public.attendance (holder_type, holder_id, date);
create index if not exists excusals_student_date_idx on public.excusals (student_id, date);
