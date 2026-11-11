-- New enum values for teacher lessons. Kept in their own migration: a value added to an enum
-- cannot be used in the same transaction that adds it.
alter type public.tap_result add value if not exists 'menu';           -- teacher tapped; kiosk offers Start lesson / Sign out
alter type public.tap_result add value if not exists 'lesson_ended';
alter type public.sms_type   add value if not exists 'director';       -- lesson alerts and daily summary for the director
