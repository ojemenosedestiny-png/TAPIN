-- Deleting a staff member entered by mistake: their attendance, taps and cards go with them, in one step.
-- Server only (service role), after the app has checked the caller is that school's admin.
create or replace function public.delete_staff_records(p_id uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer;
begin
  delete from public.attendance where holder_type = 'staff' and holder_id = p_id;
  delete from public.tap_events where holder_type = 'staff' and holder_id = p_id;
  delete from public.cards where holder_type = 'staff' and holder_id = p_id;
  delete from public.early_releases where holder_type = 'staff' and holder_id = p_id;
  delete from public.staff where id = p_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.delete_staff_records(uuid) from public, anon, authenticated;
grant execute on function public.delete_staff_records(uuid) to service_role;

-- The same lock for the existing student deletion (used by the retention job and now by admins).
revoke execute on function public.delete_student_records(uuid[]) from public, anon, authenticated;
grant execute on function public.delete_student_records(uuid[]) to service_role;
