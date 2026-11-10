-- Parent portal (phone sign-in) and WhatsApp alerts.

-- How each guardian wants alerts. WhatsApp falls back to SMS when it isn't set up or fails.
alter table public.guardians add column if not exists channel text not null default 'sms' check (channel in ('sms', 'whatsapp'));

-- Each queued message keeps the values it was built from, so it can also be sent as a WhatsApp
-- template ({{1}} name, {{2}} school, {{3}} time/date, {{4}} reason) and records how it went out.
alter table public.sms_logs
  add column if not exists vars    jsonb not null default '{}'::jsonb,
  add column if not exists channel text  not null default 'sms' check (channel in ('sms', 'whatsapp'));

-- ---------------------------------------------------------------------------
-- Parents: a Supabase login with a phone number (no staff profile). Everything they can see is
-- reached through the functions below, which check the phone against the school's guardians.
-- ---------------------------------------------------------------------------
create or replace function public.parent_phone()
returns text language sql stable security definer set search_path = '' as $$
  select case when u.phone is null or u.phone = '' then null else '+' || ltrim(u.phone, '+') end
  from auth.users u
  where u.id = auth.uid()
    and not exists (select 1 from public.users s where s.id = u.id) -- staff are never parents here
$$;

create or replace function public.is_parent_of(p_student uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.parent_phone() is not null and exists (
    select 1 from public.student_guardians sg join public.guardians g on g.id = sg.guardian_id
    where sg.student_id = p_student and g.phone = public.parent_phone()
  )
$$;

-- The signed-in parent's children (across schools, if they have children in more than one).
create or replace function public.parent_children()
returns table (student_id uuid, first_name text, last_name text, class_name text, school_name text, timezone text,
               resumption_time time, absence_cutoff_time time, photo_url text, guardian_id uuid, channel text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.first_name, s.last_name, c.name, sc.name, sc.timezone, sc.resumption_time, sc.absence_cutoff_time,
         case when s.consent_at is not null then s.photo_url end, g.id, g.channel
  from public.guardians g
  join public.student_guardians sg on sg.guardian_id = g.id
  join public.students s on s.id = sg.student_id and s.status = 'active'
  join public.schools sc on sc.id = s.school_id
  left join public.classes c on c.id = s.class_id
  where public.parent_phone() is not null and g.phone = public.parent_phone()
  order by s.first_name
$$;

-- One child's days (same rules as the school's reports), only for their own parent.
create or replace function public.parent_attendance(p_student uuid, p_from date, p_to date)
returns table (date date, status text, sign_in_at timestamptz, sign_out_at timestamptz, early_release boolean, excused_reason text)
language sql stable security definer set search_path = '' as $$
  with s as (
    select st.id, st.created_at, sc.id as school_id, sc.timezone, sc.resumption_time, sc.absence_cutoff_time,
           (now() at time zone sc.timezone) as local_now
    from public.students st join public.schools sc on sc.id = st.school_id
    where st.id = p_student and public.is_parent_of(p_student)
  ),
  days as (
    select d::date as date from s, generate_series(greatest(p_from, p_to - 200), least(p_to, s.local_now::date), interval '1 day') d
    where extract(isodow from d) < 6
      and not exists (select 1 from public.school_calendar c where c.school_id = s.school_id and c.date = d::date and c.is_holiday)
  )
  select days.date,
    case
      when a.sign_in_at is not null then
        case when date_trunc('minute', a.sign_in_at at time zone s.timezone)::time > s.resumption_time then 'late' else 'present' end
      when e.id is not null then 'excused'
      when days.date = s.local_now::date and s.local_now::time < s.absence_cutoff_time then 'pending'
      else 'absent'
    end,
    a.sign_in_at, a.sign_out_at, coalesce(a.early_release, false), e.reason
  from s cross join days
  left join public.attendance a on a.holder_type = 'student' and a.holder_id = s.id and a.date = days.date
  left join public.excusals e on e.student_id = s.id and e.date = days.date
  where days.date >= (s.created_at at time zone s.timezone)::date
  order by days.date desc
$$;

-- A parent chooses SMS or WhatsApp for themselves (every school row with their number).
create or replace function public.parent_set_channel(p_channel text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  if p_channel not in ('sms', 'whatsapp') then raise exception 'Invalid channel'; end if;
  if public.parent_phone() is null then raise exception 'Not a parent login'; end if;
  update public.guardians set channel = p_channel where phone = public.parent_phone();
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.parent_phone(), public.is_parent_of(uuid), public.parent_children(),
  public.parent_attendance(uuid, date, date), public.parent_set_channel(text) from public, anon;
grant execute on function public.parent_phone(), public.is_parent_of(uuid), public.parent_children(),
  public.parent_attendance(uuid, date, date), public.parent_set_channel(text) to authenticated;

-- Is this number a registered guardian anywhere? (Used before sending a sign-in code.)
create or replace function public.guardian_phone_exists(p_phone text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.guardians g join public.student_guardians sg on sg.guardian_id = g.id
                 join public.students s on s.id = sg.student_id and s.status = 'active' where g.phone = p_phone)
$$;
revoke execute on function public.guardian_phone_exists(text) from public, anon, authenticated;
grant execute on function public.guardian_phone_exists(text) to service_role;
