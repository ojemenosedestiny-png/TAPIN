-- A pickup window opened by a one-day code names the code, not a person or a child.
alter table public.handovers drop constraint if exists handovers_check1;
alter table public.handovers drop constraint if exists handovers_who_check;
alter table public.handovers add constraint handovers_who_check check (student_id is not null or person_id is not null or code_id is not null);
