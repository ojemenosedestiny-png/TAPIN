-- Organisations: offices and companies that use TapIn for staff only (no students, classes, parents or pickup).
-- They live in the schools table with kind = 'organisation'; everything staff-related works the same.
alter table public.schools
  add column if not exists kind text not null default 'school' check (kind in ('school', 'organisation'));
