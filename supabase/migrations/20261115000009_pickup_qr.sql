-- QR pickup passes: a pickup person can carry a QR code (on paper or a phone) instead of, or as well as,
-- an NFC card. Only the hash of the pass's secret is stored; issuing a new pass cancels the old one.
alter table public.pickup_people add column if not exists qr_token_hash text unique;
alter table public.pickup_people add column if not exists qr_issued_at timestamptz;
