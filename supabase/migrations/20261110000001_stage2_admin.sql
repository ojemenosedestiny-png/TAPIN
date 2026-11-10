-- TapIn — Stage 2: admin dashboard support
--  * card link / replace / reassign / verify / block / undo as single transactions with audit rows
--  * guardian phone uniqueness per school (so imports don't duplicate parents)
--  * staff columns for active/inactive

alter table public.staff add column if not exists status text not null default 'active'
  check (status in ('active', 'inactive'));

-- One guardian record per phone number per school.
create unique index if not exists guardians_school_phone_key on public.guardians (school_id, phone);

-- Fast "who holds this card" lookups for the cards page.
create index if not exists cards_holder_idx on public.cards (holder_type, holder_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Display name + class for a card holder. Used in conflict messages.
create or replace function public.holder_label(p_type public.holder_type, p_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case p_type
    when 'student' then (
      select jsonb_build_object('name', s.first_name || ' ' || s.last_name, 'class', c.name, 'photo_url', s.photo_url)
      from public.students s left join public.classes c on c.id = s.class_id where s.id = p_id)
    else (
      select jsonb_build_object('name', st.name, 'class', 'Staff', 'photo_url', st.photo_url)
      from public.staff st where st.id = p_id)
  end
$$;

-- ---------------------------------------------------------------------------
-- assign_card: build plan §10 step 4, all in one transaction.
--   UID free                       → link it
--   UID linked to another person   → return conflict unless p_confirm_reassign
--   Person already has active card → old card becomes 'replaced'
-- Called only by the server (service role) after it has checked the caller is a
-- school admin of p_school_id.
-- ---------------------------------------------------------------------------
create or replace function public.assign_card(
  p_school_id uuid,
  p_actor_id uuid,
  p_uid text,
  p_holder_type public.holder_type,
  p_holder_id uuid,
  p_confirm_reassign boolean default false
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.cards;
  v_old_active public.cards;
  v_card public.cards;
  v_holder_ok boolean;
begin
  if p_uid !~ '^[0-9A-F]{8,20}$' then
    return jsonb_build_object('status', 'invalid_uid');
  end if;

  -- Holder must belong to this school and be active.
  if p_holder_type = 'student' then
    select exists (select 1 from public.students where id = p_holder_id and school_id = p_school_id and status = 'active') into v_holder_ok;
  else
    select exists (select 1 from public.staff where id = p_holder_id and school_id = p_school_id and status = 'active') into v_holder_ok;
  end if;
  if not v_holder_ok then
    return jsonb_build_object('status', 'holder_not_found');
  end if;

  -- Serialise everything touching this UID or this holder.
  perform pg_advisory_xact_lock(hashtext('card-uid:' || p_uid));
  perform pg_advisory_xact_lock(hashtext('card-holder:' || p_holder_id::text));

  select * into v_existing from public.cards where uid = p_uid for update;

  if found then
    if v_existing.school_id <> p_school_id then
      -- Never reveal another school's data.
      return jsonb_build_object('status', 'other_school');
    end if;

    if v_existing.holder_type = p_holder_type and v_existing.holder_id = p_holder_id then
      if v_existing.status = 'active' then
        return jsonb_build_object('status', 'already_linked', 'card_id', v_existing.id,
          'verified', v_existing.verified_at is not null);
      end if;
      -- Re-activating this person's own old (replaced/blocked) card needs confirmation too.
      if not p_confirm_reassign then
        return jsonb_build_object('status', 'conflict', 'card_id', v_existing.id, 'card_status', v_existing.status,
          'holder', public.holder_label(v_existing.holder_type, v_existing.holder_id), 'same_holder', true);
      end if;
    elsif not p_confirm_reassign then
      return jsonb_build_object('status', 'conflict', 'card_id', v_existing.id, 'card_status', v_existing.status,
        'holder', public.holder_label(v_existing.holder_type, v_existing.holder_id), 'same_holder', false);
    end if;
  end if;

  -- Retire the person's current active card (if it is a different card).
  select * into v_old_active from public.cards
    where holder_type = p_holder_type and holder_id = p_holder_id and status = 'active' and uid <> p_uid
    for update;
  if found then
    update public.cards set status = 'replaced' where id = v_old_active.id;
  end if;

  if v_existing.id is not null then
    update public.cards
      set holder_type = p_holder_type, holder_id = p_holder_id, status = 'active', verified_at = null
      where id = v_existing.id
      returning * into v_card;
  else
    insert into public.cards (school_id, uid, holder_type, holder_id, status)
      values (p_school_id, p_uid, p_holder_type, p_holder_id, 'active')
      returning * into v_card;
  end if;

  insert into public.audit_logs (school_id, actor_id, action, entity, entity_id, details)
  values (p_school_id, p_actor_id,
    case when v_existing.id is not null then 'card.reassign' else 'card.link' end,
    'cards', v_card.id::text,
    jsonb_build_object(
      'uid_last4', right(p_uid, 4),
      'holder_type', p_holder_type, 'holder_id', p_holder_id,
      'previous_holder', case when v_existing.id is not null
        then jsonb_build_object('type', v_existing.holder_type, 'id', v_existing.holder_id, 'status', v_existing.status) end,
      'replaced_card_id', v_old_active.id));

  return jsonb_build_object(
    'status', case when v_existing.id is not null then 'reassigned' else 'linked' end,
    'card_id', v_card.id,
    'replaced_card_id', v_old_active.id,
    'holder', public.holder_label(p_holder_type, p_holder_id));
exception when unique_violation then
  -- Two admins raced on the same card: the other one won.
  return jsonb_build_object('status', 'race_conflict');
end;
$$;

-- ---------------------------------------------------------------------------
-- verify_card: the "Test card" step. The tapped UID must be the holder's active
-- card, and the holder must have a photo (so every tap shows a face).
-- ---------------------------------------------------------------------------
create or replace function public.verify_card(
  p_school_id uuid, p_actor_id uuid, p_uid text, p_holder_type public.holder_type, p_holder_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_card public.cards;
  v_photo text;
begin
  select * into v_card from public.cards where uid = p_uid and school_id = p_school_id for update;
  if not found or v_card.status <> 'active' then
    return jsonb_build_object('status', 'unknown_card');
  end if;
  if v_card.holder_type <> p_holder_type or v_card.holder_id <> p_holder_id then
    return jsonb_build_object('status', 'wrong_person', 'holder', public.holder_label(v_card.holder_type, v_card.holder_id));
  end if;

  if p_holder_type = 'student' then
    select photo_url into v_photo from public.students where id = p_holder_id;
  else
    select photo_url into v_photo from public.staff where id = p_holder_id;
  end if;
  if v_photo is null then
    return jsonb_build_object('status', 'photo_required');
  end if;

  update public.cards set verified_at = now() where id = v_card.id returning * into v_card;
  insert into public.audit_logs (school_id, actor_id, action, entity, entity_id, details)
    values (p_school_id, p_actor_id, 'card.verify', 'cards', v_card.id::text, jsonb_build_object('uid_last4', right(p_uid, 4)));
  return jsonb_build_object('status', 'verified', 'card_id', v_card.id, 'verified_at', v_card.verified_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- set_card_status: block (lost card) or unblock.
-- ---------------------------------------------------------------------------
create or replace function public.set_card_status(
  p_school_id uuid, p_actor_id uuid, p_card_id uuid, p_status public.card_status
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_card public.cards;
begin
  if p_status not in ('active', 'blocked') then
    return jsonb_build_object('status', 'invalid_status');
  end if;
  select * into v_card from public.cards where id = p_card_id and school_id = p_school_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if p_status = 'active' and exists (
    select 1 from public.cards
    where holder_type = v_card.holder_type and holder_id = v_card.holder_id and status = 'active' and id <> v_card.id
  ) then
    return jsonb_build_object('status', 'holder_has_active_card');
  end if;

  update public.cards set status = p_status where id = p_card_id returning * into v_card;
  insert into public.audit_logs (school_id, actor_id, action, entity, entity_id, details)
    values (p_school_id, p_actor_id, case when p_status = 'blocked' then 'card.block' else 'card.unblock' end,
      'cards', v_card.id::text, jsonb_build_object('uid_last4', right(v_card.uid, 4)));
  return jsonb_build_object('status', 'ok', 'card', to_jsonb(v_card));
end;
$$;

-- ---------------------------------------------------------------------------
-- undo_card_link: class-enrollment "Undo". Only removes a card that was linked
-- moments ago, has never been verified, and restores the card it replaced.
-- ---------------------------------------------------------------------------
create or replace function public.undo_card_link(
  p_school_id uuid, p_actor_id uuid, p_card_id uuid, p_replaced_card_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_card public.cards;
begin
  select * into v_card from public.cards where id = p_card_id and school_id = p_school_id for update;
  if not found then
    return jsonb_build_object('status', 'not_found');
  end if;
  if v_card.verified_at is not null or v_card.created_at < now() - interval '30 minutes' then
    return jsonb_build_object('status', 'too_late');
  end if;

  delete from public.cards where id = v_card.id;
  if p_replaced_card_id is not null then
    update public.cards set status = 'active'
      where id = p_replaced_card_id and school_id = p_school_id and status = 'replaced'
        and holder_type = v_card.holder_type and holder_id = v_card.holder_id;
  end if;
  insert into public.audit_logs (school_id, actor_id, action, entity, entity_id, details)
    values (p_school_id, p_actor_id, 'card.undo', 'cards', v_card.id::text,
      jsonb_build_object('uid_last4', right(v_card.uid, 4), 'holder_id', v_card.holder_id));
  return jsonb_build_object('status', 'ok');
end;
$$;

-- Server-only: these bypass RLS and trust p_school_id / p_actor_id from the caller.
revoke execute on function
  public.holder_label(public.holder_type, uuid),
  public.assign_card(uuid, uuid, text, public.holder_type, uuid, boolean),
  public.verify_card(uuid, uuid, text, public.holder_type, uuid),
  public.set_card_status(uuid, uuid, uuid, public.card_status),
  public.undo_card_link(uuid, uuid, uuid, uuid)
from public, anon, authenticated;
grant execute on function
  public.holder_label(public.holder_type, uuid),
  public.assign_card(uuid, uuid, text, public.holder_type, uuid, boolean),
  public.verify_card(uuid, uuid, text, public.holder_type, uuid),
  public.set_card_status(uuid, uuid, uuid, public.card_status),
  public.undo_card_link(uuid, uuid, uuid, uuid)
to service_role;

-- Card writes go through the functions above only; admins keep read access.
drop policy if exists cards_all on public.cards;
create policy cards_select on public.cards for select to authenticated
  using (public.is_school_admin(school_id));
revoke insert, update, delete on public.cards from authenticated;

-- ---------------------------------------------------------------------------
-- SMS history per student (filled from Stage 4)
-- ---------------------------------------------------------------------------
alter table public.sms_logs add column if not exists student_id uuid references public.students (id) on delete set null;
create index if not exists sms_logs_student_idx on public.sms_logs (student_id, created_at desc);

-- ---------------------------------------------------------------------------
-- student_overview: one row per student for the Students table.
-- security_invoker = true → the caller's RLS applies to every table it reads,
-- so teachers get null card/guardian columns and other schools get nothing.
-- ---------------------------------------------------------------------------
create or replace view public.student_overview with (security_invoker = true) as
select
  s.id, s.school_id, s.class_id, s.admission_no, s.first_name, s.last_name,
  s.first_name || ' ' || s.last_name as full_name,
  s.photo_url, s.status, s.created_at,
  c.name as class_name,
  card.id as card_id,
  card.status as card_status,
  card.verified_at as card_verified_at,
  right(card.uid, 4) as card_uid_tail,
  case
    when card.id is null then 'none'
    when card.status = 'active' and card.verified_at is not null then 'verified'
    else card.status::text
  end as card_state,
  g.name as guardian_name,
  g.phone as guardian_phone
from public.students s
left join public.classes c on c.id = s.class_id
left join lateral (
  select k.id, k.status, k.verified_at, k.uid
  from public.cards k
  where k.holder_type = 'student' and k.holder_id = s.id
  order by (k.status = 'active') desc, k.created_at desc
  limit 1
) card on true
left join lateral (
  select gg.name, gg.phone
  from public.student_guardians sg join public.guardians gg on gg.id = sg.guardian_id
  where sg.student_id = s.id
  order by gg.created_at
  limit 1
) g on true;

revoke all on public.student_overview from anon;
grant select on public.student_overview to authenticated;

-- Same idea for staff.
create or replace view public.staff_overview with (security_invoker = true) as
select
  st.id, st.school_id, st.name, st.phone, st.photo_url, st.status, st.created_at,
  card.id as card_id,
  card.status as card_status,
  card.verified_at as card_verified_at,
  right(card.uid, 4) as card_uid_tail,
  case
    when card.id is null then 'none'
    when card.status = 'active' and card.verified_at is not null then 'verified'
    else card.status::text
  end as card_state
from public.staff st
left join lateral (
  select k.id, k.status, k.verified_at, k.uid
  from public.cards k
  where k.holder_type = 'staff' and k.holder_id = st.id
  order by (k.status = 'active') desc, k.created_at desc
  limit 1
) card on true;

revoke all on public.staff_overview from anon;
grant select on public.staff_overview to authenticated;
