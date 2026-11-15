-- A child matched at pickup belongs to the window the parent's card (or a code) opened.
alter table public.handovers add column if not exists window_id uuid references public.handovers (id) on delete cascade;
create index if not exists handovers_window on public.handovers (window_id) where window_id is not null;
