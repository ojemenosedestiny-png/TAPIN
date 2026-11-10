-- TapIn — pre-launch: consent, retention (NDPA 2023), two-factor enforcement, backups.

-- ---------------------------------------------------------------------------
-- Consent and leaving date
-- ---------------------------------------------------------------------------
alter table public.students
  add column if not exists consent_at          timestamptz,
  add column if not exists consent_note        text check (consent_note is null or length(consent_note) <= 200),
  add column if not exists consent_recorded_by uuid references public.users (id) on delete set null,
  add column if not exists left_at             timestamptz;

-- left_at is set when a student stops being active, cleared if they come back.
create or replace function public.track_student_left()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status <> 'active' and (tg_op = 'INSERT' or old.status = 'active') then
    new.left_at := coalesce(new.left_at, now());
  elsif new.status = 'active' then
    new.left_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists students_left_at on public.students;
create trigger students_left_at before insert or update of status on public.students
  for each row execute function public.track_student_left();
update public.students set left_at = now() where status <> 'active' and left_at is null;

-- How long a leaver's records are kept before automatic deletion.
alter table public.schools add column if not exists retention_months integer not null default 12
  check (retention_months between 1 and 84);

-- The Students table shows consent.
create or replace view public.student_overview with (security_invoker = true) as
select
  s.id, s.school_id, s.class_id, s.admission_no, s.first_name, s.last_name,
  s.first_name || ' ' || s.last_name as full_name,
  s.photo_url, s.status, s.created_at,
  c.name as class_name,
  card.id as card_id,
  card.status as card_status,
  card.verified_at as card_verified_at,
  right(card.uid, 4) as card_uid_tail,
  case
    when card.id is null then 'none'
    when card.status = 'active' and card.verified_at is not null then 'verified'
    else card.status::text
  end as card_state,
  g.name as guardian_name,
  g.phone as guardian_phone,
  s.consent_at
from public.students s
left join public.classes c on c.id = s.class_id
left join lateral (
  select k.id, k.status, k.verified_at, k.uid
  from public.cards k
  where k.holder_type = 'student' and k.holder_id = s.id
  order by (k.status = 'active') desc, k.created_at desc
  limit 1
) card on true
left join lateral (
  select gg.name, gg.phone
  from public.student_guardians sg join public.guardians gg on gg.id = sg.guardian_id
  where sg.student_id = s.id
  order by gg.created_at
  limit 1
) g on true;

-- ---------------------------------------------------------------------------
-- Retention: delete everything about leavers past the school's retention period.
-- Photos are removed by the app (storage API) before this runs for each student.
-- ---------------------------------------------------------------------------
create or replace function public.students_due_for_deletion(p_limit integer default 200)
returns table (student_id uuid, school_id uuid, photo_url text)
language sql stable security definer set search_path = '' as $$
  select s.id, s.school_id, s.photo_url
  from public.students s join public.schools sc on sc.id = s.school_id
  where s.status <> 'active' and s.left_at is not null
    and s.left_at < now() - make_interval(months => sc.retention_months)
  order by s.left_at
  limit p_limit
$$;

create or replace function public.delete_student_records(p_ids uuid[])
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_guardians uuid[];
  v_n integer;
  r record;
begin
  select array_agg(distinct guardian_id) into v_guardians from public.student_guardians where student_id = any (p_ids);

  delete from public.attendance where holder_type = 'student' and holder_id = any (p_ids);
  delete from public.tap_events where holder_type = 'student' and holder_id = any (p_ids);
  delete from public.cards where holder_type = 'student' and holder_id = any (p_ids);
  delete from public.sms_logs where student_id = any (p_ids);
  -- excusals and student_guardians cascade with the student
  for r in select school_id, count(*) as n from public.students where id = any (p_ids) group by school_id loop
    insert into public.audit_logs (school_id, action, entity, details)
    values (r.school_id, 'retention.delete', 'students', jsonb_build_object('students', r.n));
  end loop;
  delete from public.students where id = any (p_ids);
  get diagnostics v_n = row_count;

  -- Parents with no remaining children at the school go too (and their SMS history).
  if v_guardians is not null then
    delete from public.sms_logs where guardian_id = any (v_guardians)
      and not exists (select 1 from public.student_guardians sg where sg.guardian_id = sms_logs.guardian_id);
    delete from public.guardians g where g.id = any (v_guardians)
      and not exists (select 1 from public.student_guardians sg where sg.guardian_id = g.id);
  end if;
  return v_n;
end;
$$;

revoke execute on function public.students_due_for_deletion(integer), public.delete_student_records(uuid[]) from public, anon, authenticated;
grant execute on function public.students_due_for_deletion(integer), public.delete_student_records(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- Two-factor login: once someone has a verified authenticator, every table refuses their
-- data until the session has passed the code check (aal2). Enforced in the database, so a
-- password alone can't read anything even through the API. Their own profile row stays
-- readable so the app can ask for the code.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_ok()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = auth.uid() and f.status = 'verified')
$$;
revoke execute on function public.mfa_ok() from public, anon;
grant execute on function public.mfa_ok() to authenticated;

do $$
declare t text;
begin
  foreach t in array array['schools','classes','students','guardians','student_guardians','staff','cards','devices',
    'attendance','sms_logs','school_calendar','audit_logs','tap_events','alert_settings','excusals','notifications']
  loop
    execute format('drop policy if exists mfa_required on public.%I', t);
    execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
  end loop;
end $$;
drop policy if exists mfa_required on public.users;
create policy mfa_required on public.users as restrictive for all to authenticated
  using (public.mfa_ok() or id = auth.uid()) with check (public.mfa_ok());
drop policy if exists photos_mfa_required on storage.objects;
create policy photos_mfa_required on storage.objects as restrictive for all to authenticated
  using (bucket_id <> 'photos' or public.mfa_ok()) with check (bucket_id <> 'photos' or public.mfa_ok());

-- ---------------------------------------------------------------------------
-- Backups bucket: private, service role only (no policies for logged-in users).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Nightly jobs (UTC): retention at 01:00, backup at 01:30. They call the app with the same
-- URL and secret stored in Vault by setup_sms_sender().
-- ---------------------------------------------------------------------------
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('tapin-retention-nightly', 'tapin-backup-nightly');
end $$;
select cron.schedule('tapin-retention-nightly', '0 1 * * *', $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tapin_app_url') || '/api/cron/retention',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tapin_cron_secret')),
    timeout_milliseconds := 55000);
$job$);
select cron.schedule('tapin-backup-nightly', '30 1 * * *', $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tapin_app_url') || '/api/cron/backup',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tapin_cron_secret')),
    timeout_milliseconds := 55000);
$job$);
