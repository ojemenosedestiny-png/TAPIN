-- Postgres regexes allow at most 255 repeats; {4,300} made every insert fail. Check the length separately.
alter table public.portal_links drop constraint if exists portal_links_url_check;
alter table public.portal_links add constraint portal_links_url_check
  check (url ~ '^https://[^[:space:]]+$' and length(url) between 12 and 300);
