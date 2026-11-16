-- Staff check-in security, chosen per school in Settings:
--   * card + the person's own 4-digit PIN (5 wrong tries lock that person for 15 minutes),
--   * a photo from the kiosk camera at every staff check-in and check-out (kept 30 days),
--   * alerts for late arrival, leaving early, wrong-PIN lockouts and not checking out,
--   * staff may only check in between set hours (and only ever on the school's registered kiosks).

alter table public.schools
  add column if not exists staff_pin_required boolean not null default false,
  add column if not exists staff_photo        boolean not null default false,
  add column if not exists staff_alerts       boolean not null default false,
  add column if not exists staff_from         time,
  add column if not exists staff_until        time;

-- PINs live apart from staff rows (which school admins can read): row-level security with no policies,
-- so only the server (service role) ever sees a hash. has_pin is exposed through staff_pin_status() below.
create table if not exists public.staff_pins (
  staff_id      uuid primary key references public.staff (id) on delete cascade,
  school_id     uuid not null references public.schools (id) on delete cascade,
  pin_hash      text not null,
  failures      integer not null default 0 check (failures >= 0),
  locked_until  timestamptz,
  set_at        timestamptz not null default now()
);
alter table public.staff_pins enable row level security;
revoke all on public.staff_pins from anon, authenticated;

-- For the school admin: which staff have a PIN, and who is locked out. Never the hash.
create or replace function public.staff_pin_status()
returns table (staff_id uuid, has_pin boolean, locked_until timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.staff_id, true, p.locked_until
  from public.staff_pins p
  where p.school_id = public.current_school_id() and public.is_school_admin(p.school_id) and public.mfa_ok()
$$;
revoke execute on function public.staff_pin_status() from public, anon;
grant execute on function public.staff_pin_status() to authenticated;

-- What was checked at each staff tap: pin_checked null = no PIN asked, true = right PIN, false = let through without
-- one (no PIN set yet, or an offline tap). photo_path = the kiosk's photo in the private photos bucket.
alter table public.tap_events
  add column if not exists pin_checked boolean,
  add column if not exists photo_path  text check (photo_path is null or length(photo_path) <= 300);

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('unknown_card', 'device_offline', 'late_arrival', 'sms_failed', 'allowance', 'attendance_watch',
                  'pickup_denied', 'emergency',
                  'handover_flag', 'early_pickup', 'code_lock', 'renewal_due',
                  'staff_late', 'staff_early', 'staff_pin', 'staff_no_checkout'));
