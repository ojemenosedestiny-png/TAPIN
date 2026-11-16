-- Demo requests from offices and companies (staff count) as well as schools (pupils).
alter table public.demo_requests
  add column if not exists kind text not null default 'school' check (kind in ('school', 'organisation'));
