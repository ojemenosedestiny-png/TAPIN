-- Fix: check_pickup_refs referenced new.person_id / new.code_id in one expression, which fails on the
-- table that lacks that column. Each table's check now sits in its own branch.
create or replace function public.check_pickup_refs()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.students where id = new.student_id and school_id = new.school_id) then
    raise exception 'student is not in this school';
  end if;
  if tg_table_name = 'pickup_people_students' then
    if not exists (select 1 from public.pickup_people where id = new.person_id and school_id = new.school_id) then
      raise exception 'pickup person is not in this school';
    end if;
  elsif tg_table_name = 'pickup_code_students' then
    if not exists (select 1 from public.pickup_codes where id = new.code_id and school_id = new.school_id) then
      raise exception 'pickup code is not in this school';
    end if;
  end if;
  return new;
end;
$$;
revoke execute on function public.check_pickup_refs() from public, anon, authenticated;
