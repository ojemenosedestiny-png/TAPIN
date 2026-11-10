-- Scheduled SMS sending: Supabase calls the app's /api/cron/send every 2 minutes (pg_cron + pg_net).
-- The app URL and CRON_SECRET are stored encrypted in Supabase Vault, never in this file.
-- Set up (or change) with:  select public.setup_sms_sender('https://your-app.vercel.app', '<CRON_SECRET>');
create extension if not exists pg_net;

create or replace function public.setup_sms_sender(p_url text, p_secret text)
returns text language plpgsql security definer set search_path = '' as $$
begin
  if p_url !~ '^https://[a-z0-9.-]+(:[0-9]+)?/?$' then raise exception 'App URL must be https://host'; end if;
  if length(p_secret) < 16 then raise exception 'CRON_SECRET must be at least 16 characters'; end if;

  delete from vault.secrets where name in ('tapin_app_url', 'tapin_cron_secret');
  perform vault.create_secret(rtrim(p_url, '/'), 'tapin_app_url');
  perform vault.create_secret(p_secret, 'tapin_cron_secret');

  perform cron.unschedule(jobid) from cron.job where jobname = 'tapin-send-2min';
  perform cron.schedule('tapin-send-2min', '*/2 * * * *', $job$
    select net.http_get(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'tapin_app_url') || '/api/cron/send',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'tapin_cron_secret')),
      timeout_milliseconds := 55000
    );
  $job$);
  return 'SMS sender scheduled every 2 minutes for ' || rtrim(p_url, '/');
end;
$$;

revoke execute on function public.setup_sms_sender(text, text) from public, anon, authenticated;
grant execute on function public.setup_sms_sender(text, text) to service_role;
