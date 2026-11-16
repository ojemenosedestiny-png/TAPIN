-- The TapIn WhatsApp number parents message (the assistant), shown on the parent page and the consent form.
-- Digits only, country code first (2349167080638). Separate from platform_settings.whatsapp (sales chat on the website).
alter table public.platform_settings
  add column if not exists assistant_whatsapp text check (assistant_whatsapp is null or assistant_whatsapp ~ '^[1-9][0-9]{9,14}$');
