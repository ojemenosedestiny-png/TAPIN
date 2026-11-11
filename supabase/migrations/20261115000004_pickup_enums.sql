-- Enum values for Safe pickup. Own migration: new enum values can't be used in the same transaction.
alter type public.tap_result add value if not exists 'pickup';   -- a pickup card or code; kiosk shows the children to confirm
alter type public.sms_type   add value if not exists 'pickup';   -- "[Child] was picked up by [person] at [time]"
