-- New message types (own migration: new enum values can't be used in the same transaction).
alter type public.sms_type add value if not exists 'dropoff';      -- "Ada has checked in at 7:42 AM" after a parent hands over
alter type public.sms_type add value if not exists 'bus';          -- bus children: arrived at school / left on the bus
alter type public.sms_type add value if not exists 'late_pickup';  -- still in school 30 minutes after closing
