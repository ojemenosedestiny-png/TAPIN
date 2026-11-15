-- Tap results for the handover flows (own migration: new enum values can't be used in the same transaction).
alter type public.tap_result add value if not exists 'handover';  -- a parent's card matched a drop-off
alter type public.tap_result add value if not exists 'held';      -- a parent-pickup child tapped out alone: wait for the parent
