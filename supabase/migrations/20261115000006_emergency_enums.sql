-- Enum values for the emergency roll call. Own migration: new enum values can't be used in the same transaction.
alter type public.tap_result add value if not exists 'safe';      -- tapped at the assembly point during a roll call
alter type public.sms_type   add value if not exists 'emergency'; -- optional broadcast to parents
