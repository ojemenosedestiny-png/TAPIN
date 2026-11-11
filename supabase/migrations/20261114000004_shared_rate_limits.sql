-- Attempt limits shared by every server (Vercel runs many; in-memory counters alone can be dodged by hitting
-- different ones). Platform-level security table: no school_id and no policies, so nobody can read or change it
-- through the API; only the server (service role) calls rate_limit_hit(). Keys are SHA-256 hashes, so no email
-- address or phone number is stored here.
create table public.rate_limits (
  key          text primary key,
  window_start timestamptz not null default now(),
  hits         integer not null default 0
);
alter table public.rate_limits enable row level security;

-- One attempt against a limit. Returns true while the caller is still within it.
create or replace function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_hits integer;
begin
  if p_key is null or length(p_key) < 8 or p_max < 1 or p_window_seconds < 1 then
    raise exception 'bad rate limit request';
  end if;
  insert into public.rate_limits as r (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when r.window_start < now() - make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end,
    window_start = case when r.window_start < now() - make_interval(secs => p_window_seconds) then now() else r.window_start end
  returning hits into v_hits;
  return v_hits <= p_max;
end $$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Old counters are useless after a day.
select cron.schedule('tapin-rate-limits-cleanup', '17 3 * * *', $$delete from public.rate_limits where window_start < now() - interval '1 day'$$);
