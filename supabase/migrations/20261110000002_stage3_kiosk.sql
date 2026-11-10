-- TapIn — Stage 3: kiosk taps
-- Every tap is logged (including unknown / blocked cards), which powers:
--   * the 5-minute duplicate rule
--   * "Unrecognised card tapped at Main Gate" for admins
--   * the live tap feed (Stage 5)

create type public.tap_result as enum ('signed_in', 'signed_out', 'duplicate', 'unknown', 'blocked');

create table public.tap_events (
  id          bigint generated always as identity primary key,
  school_id   uuid not null references public.schools (id) on delete cascade,
  device_id   uuid references public.devices (id) on delete set null,
  uid         text not null,
  holder_type public.holder_type,
  holder_id   uuid,
  result      public.tap_result not null,
  late        boolean not null default false,
  tapped_at   timestamptz not null,           -- when the card touched the kiosk (offline taps arrive later)
  received_at timestamptz not null default now(),
  client_id   text,                           -- kiosk-generated id: replays of the same offline tap are ignored
  constraint tap_events_client_unique unique (device_id, client_id)
);
create index tap_events_holder_idx on public.tap_events (holder_type, holder_id, tapped_at desc);
create index tap_events_school_idx on public.tap_events (school_id, tapped_at desc);

alter table public.tap_events enable row level security;
revoke all on public.tap_events from anon;
-- Written only by /api/tap (service role). Admins read their school's taps.
create policy tap_events_select on public.tap_events for select to authenticated
  using (public.is_school_admin(school_id));

-- Kiosk lookups by token hash must be fast.
create index if not exists devices_token_active_idx on public.devices (token_hash) where revoked_at is null;
