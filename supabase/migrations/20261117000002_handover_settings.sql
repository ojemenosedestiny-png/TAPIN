-- Parent handover is switched on per school (off by default, so nothing changes until a school chooses it).
alter table public.schools add column if not exists handover_enabled boolean not null default false;

-- Siblings: two children can wait for the same parent at one kiosk, so drop-off rows (one per child) may be
-- open together. Only the pickup window opened by a parent's card or a code is one-per-kiosk.
drop index if exists public.handovers_one_open_per_device;
create unique index if not exists handovers_one_pickup_window_per_device on public.handovers (device_id)
  where status = 'waiting' and kind = 'pick_up' and student_id is null;
