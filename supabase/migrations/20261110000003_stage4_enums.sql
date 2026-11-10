-- TapIn — Stage 4 (part 1): new enum values. Kept in their own migration because
-- Postgres can't use a newly added enum value in the same transaction that adds it.
alter type public.sms_status add value if not exists 'sending';
alter type public.sms_type add value if not exists 'summary';
