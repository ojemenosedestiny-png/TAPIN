-- The two-factor rule (mfa_required) covered the original tables only. Apply it to every table added since,
-- so a password alone (without the 6-digit code, for users who turned two-factor on) can't read them either.
do $$
declare t text;
begin
  foreach t in array array['emergencies','emergency_people','emergency_settings','lesson_settings','lessons',
    'pickup_code_students','pickup_codes','pickup_events','pickup_people','pickup_people_students',
    'subjects','teacher_assignments','report_links','rate_limits']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists mfa_required on public.%I', t);
      execute format('create policy mfa_required on public.%I as restrictive for all to authenticated using (public.mfa_ok()) with check (public.mfa_ok())', t);
    end if;
  end loop;
end $$;

-- lesson_flags is a pure calculation, only used inside auto_close_lessons: nobody else needs to call it.
revoke execute on function public.lesson_flags(integer, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.lesson_flags(integer, integer, integer, boolean) to service_role;
