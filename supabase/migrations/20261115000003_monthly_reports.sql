-- Monthly teacher reports (spec 8).

-- A teacher's dashboard login can be linked to their staff profile, so they see their own record.
alter table public.users add column if not exists staff_id uuid references public.staff (id) on delete set null;
create unique index if not exists users_staff_unique on public.users (staff_id) where staff_id is not null;

-- Private links to a month's report, for the director (who has no login). Only the hash of the
-- link's secret is stored. Read and written by the server (service role) only.
create table if not exists public.report_links (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools (id) on delete cascade,
  month       text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  token_hash  text not null unique,
  created_by  uuid references public.users (id) on delete set null,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);
create index if not exists report_links_school_idx on public.report_links (school_id, created_at desc);
alter table public.report_links enable row level security;
revoke all on public.report_links from anon, authenticated;

-- Daily at 08:00 Lagos: on the 1st, each school's director gets a link to last month's report.
select cron.schedule('tapin-monthly-report', '0 7 * * *', $job$
  select net.http_get(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'tapin_app_url') || '/api/cron/monthly',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tapin_cron_secret')),
    timeout_milliseconds := 30000
  );
$job$);
