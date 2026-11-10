-- Early release (office-approved sign-out before closing) and the absence watch.

create table public.early_releases (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  holder_type public.holder_type not null,
  holder_id   uuid not null,
  date        date not null,
  reason      text not null check (length(trim(reason)) between 2 and 200),
  approved_by uuid references public.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  used_at     timestamptz,                 -- when the early sign-out happened
  unique (holder_type, holder_id, date)
);
create index early_releases_school_date_idx on public.early_releases (school_id, date);

alter table public.early_releases enable row level security;
revoke all on public.early_releases from anon;
-- School admins manage all; a class teacher can release their own students.
create policy early_releases_select on public.early_releases for select to authenticated
  using (public.is_school_admin(school_id) or (holder_type = 'student' and public.can_view_student(holder_id)));
create policy early_releases_insert on public.early_releases for insert to authenticated
  with check (approved_by = auth.uid() and (public.is_school_admin(school_id) or (holder_type = 'student' and public.can_view_student(holder_id))));
create policy early_releases_delete on public.early_releases for delete to authenticated
  using (used_at is null and (public.is_school_admin(school_id) or (holder_type = 'student' and public.can_view_student(holder_id))));
create policy mfa_required on public.early_releases as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok());

alter table public.attendance add column if not exists early_release boolean not null default false;

alter table public.alert_settings
  add column if not exists early_template text not null default '{full_name} was released early from {school} at {time}. Reason: {reason}.'
  check (length(early_template) between 5 and 480);

-- Weekly watch notifications.
alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('unknown_card', 'device_offline', 'late_arrival', 'sms_failed', 'allowance', 'attendance_watch'));

-- ---------------------------------------------------------------------------
-- Absence watch: students absent 3+ school days or late 5+ times in the last N days.
-- Runs as the caller (RLS): teachers see their own classes.
-- ---------------------------------------------------------------------------
create or replace function public.attendance_watch(p_days integer default 30, p_absent integer default 3, p_late integer default 5)
returns table (student_id uuid, class_id uuid, school_days integer, absent integer, late integer)
language sql stable security invoker set search_path = '' as $$
  with s as (select (now() at time zone timezone)::date as today from public.schools where id = public.current_school_id())
  select a.student_id, a.class_id, a.school_days, a.absent, a.late
  from s, public.attendance_summary(s.today - (p_days - 1), s.today, null) a
  where a.absent >= p_absent or a.late >= p_late
  order by a.absent desc, a.late desc
$$;
revoke execute on function public.attendance_watch(integer, integer, integer) from public, anon;
grant execute on function public.attendance_watch(integer, integer, integer) to authenticated;

-- The weekly notification needs the same numbers for every school without a logged-in user.
create or replace function public.queue_watch_notifications(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  s record;
  v_today date;
  v_absent integer;
  v_late integer;
  v_count integer := 0;
begin
  for s in select id, timezone from public.schools loop
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
revoke execute on function public.queue_watch_notifications(timestamptz) from public, anon, authenticated;
grant execute on function public.queue_watch_notifications(timestamptz) to service_role;

-- Mondays 06:00 UTC (07:00 Lagos).
do $$ begin perform cron.unschedule(jobid) from cron.job where jobname = 'tapin-watch-weekly'; end $$;
select cron.schedule('tapin-watch-weekly', '0 6 * * 1', $$select public.queue_watch_notifications();$$);
