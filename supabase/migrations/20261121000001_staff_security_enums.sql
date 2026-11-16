-- Staff check-in security: a staff tap refused at the kiosk (wrong PIN, locked, or outside the set hours).
alter type public.tap_result add value if not exists 'staff_refused';
