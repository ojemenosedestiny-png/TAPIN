-- Website prices, set by the super admin on the Billing page (not in code). Empty = not shown on the website.
-- The website reads them on the server and publishes them on the pricing page; only the super admin changes them,
-- through the server.
alter table public.platform_settings
  add column if not exists starter_price      numeric(12, 2) check (starter_price is null or starter_price > 0),
  add column if not exists standard_price     numeric(12, 2) check (standard_price is null or standard_price > 0),
  add column if not exists web_setup_fee      numeric(12, 2) check (web_setup_fee is null or web_setup_fee >= 0),
  add column if not exists yearly_discount_pct numeric(5, 2) check (yearly_discount_pct is null or (yearly_discount_pct >= 0 and yearly_discount_pct < 100)),
  add column if not exists live_within_days   integer check (live_within_days is null or live_within_days between 1 and 365),
  add column if not exists whatsapp           text check (whatsapp is null or whatsapp ~ '^234[0-9]{10}$');
