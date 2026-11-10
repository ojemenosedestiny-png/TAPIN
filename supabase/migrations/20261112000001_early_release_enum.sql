-- Early release: a new SMS type (own migration: new enum values can't be used in the same transaction).
alter type public.sms_type add value if not exists 'early';
