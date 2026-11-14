-- Backups now include price_history (an identity table): let the restore put its rows back with their ids.
create or replace function public.restore_identity_rows(p_table text, p_rows jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if p_table not in ('tap_events', 'notifications', 'audit_logs', 'price_history') then
    raise exception 'Not a restorable identity table: %', p_table;
  end if;
  execute format(
    'insert into public.%1$I overriding system value select * from jsonb_populate_recordset(null::public.%1$I, $1)', p_table
  ) using p_rows;
  get diagnostics v_n = row_count;
  execute format(
    'select setval(pg_get_serial_sequence(''public.%1$I'', ''id''), greatest((select coalesce(max(id), 0) from public.%1$I), 1))', p_table
  );
  return v_n;
end;
$$;
revoke execute on function public.restore_identity_rows(text, jsonb) from public, anon, authenticated;
grant execute on function public.restore_identity_rows(text, jsonb) to service_role;
