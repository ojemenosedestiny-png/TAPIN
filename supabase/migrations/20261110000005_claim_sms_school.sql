-- claim_sms can be limited to one school (used by tests and by an admin's "Send now",
-- so one school's button never sends another school's queue).
drop function if exists public.claim_sms(integer);

create or replace function public.claim_sms(p_limit integer default 50, p_school uuid default null)
returns setof public.sms_logs language plpgsql security definer set search_path = '' as $$
begin
  update public.sms_logs set status = 'queued', sending_started_at = null
    where status = 'sending' and sending_started_at < now() - interval '5 minutes'
      and (p_school is null or school_id = p_school);
  return query
    update public.sms_logs l set status = 'sending', sending_started_at = now()
    where l.id in (
      select id from public.sms_logs
      where status = 'queued' and next_attempt_at <= now()
        and (p_school is null or school_id = p_school)
      order by created_at
      for update skip locked
      limit p_limit)
    returning l.*;
end;
$$;

revoke execute on function public.claim_sms(integer, uuid) from public, anon, authenticated;
grant execute on function public.claim_sms(integer, uuid) to service_role;
