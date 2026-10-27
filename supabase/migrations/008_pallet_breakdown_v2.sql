-- Milestone 4: digital pallet building from existing production cases.
begin;

alter table pallets
  add column if not exists pallet_identifier text,
  add column if not exists created_by uuid references profiles(id) on delete set null,
  add column if not exists completed_by uuid references profiles(id) on delete set null,
  add column if not exists voided_by uuid references profiles(id) on delete set null,
  add column if not exists void_reason text;

update pallets
  set pallet_identifier = coalesce(pallet_identifier, label)
  where pallet_identifier is null;

alter table pallets
  alter column pallet_identifier set not null;

create unique index if not exists pallets_org_identifier_unique
  on pallets (organization_id, pallet_identifier);

alter table pallet_cases
  add column if not exists production_case_id uuid references production_cases(id) on delete restrict,
  add column if not exists added_by uuid references profiles(id) on delete set null,
  add column if not exists added_at timestamptz not null default now();

create unique index if not exists pallet_cases_production_case_unique
  on pallet_cases (production_case_id)
  where production_case_id is not null;

create index if not exists pallets_org_order_status_idx
  on pallets (organization_id, order_id, status, created_at desc);

create or replace function create_lucid_pallet(p_order_id uuid)
returns table (pallet_id uuid, pallet_identifier text, pallet_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  operational_order orders%rowtype;
  next_number integer;
  next_identifier text;
  new_pallet_id uuid;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot build pallets.';
  end if;

  select * into operational_order from orders
    where id = p_order_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if operational_order.status not in ('in_production', 'production_complete') then
    raise exception 'Pallets can be created after production has started.';
  end if;

  perform pg_advisory_xact_lock(hashtext(operational_order.id::text));
  select count(*) + 1 into next_number from pallets
    where organization_id = current_profile.organization_id and order_id = operational_order.id;
  next_identifier := 'PAL-' || operational_order.external_po || '-' || lpad(next_number::text, 2, '0');

  insert into pallets (organization_id, order_id, label, pallet_identifier, status, created_by)
    values (current_profile.organization_id, operational_order.id, next_identifier, next_identifier, 'building', current_profile.id)
    returning id into new_pallet_id;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'pallet created', 'pallet', new_pallet_id::text,
      jsonb_build_object('order_id', operational_order.id, 'pallet_identifier', next_identifier));
  return query select new_pallet_id, next_identifier, 'building'::text;
end;
$$;

create or replace function add_lucid_case_to_pallet(p_pallet_id uuid, p_case_identifier text)
returns table (pallet_id uuid, production_case_id uuid, case_identifier text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  target_pallet pallets%rowtype;
  target_case production_cases%rowtype;
  target_line order_lines%rowtype;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot build pallets.';
  end if;
  if nullif(btrim(p_case_identifier), '') is null then raise exception 'Enter a case ID.'; end if;

  select * into target_pallet from pallets
    where id = p_pallet_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The pallet was not found.'; end if;
  if target_pallet.status <> 'building' then raise exception 'This pallet is complete and cannot be changed.'; end if;

  select * into target_case from production_cases
    where organization_id = current_profile.organization_id
      and case_identifier = btrim(p_case_identifier)
    for update;
  if not found then raise exception 'No production case was found with that case ID.'; end if;
  if target_case.status = 'voided' then raise exception 'Voided cases cannot be added to a pallet.'; end if;
  if target_case.order_id <> target_pallet.order_id then raise exception 'This case belongs to a different order.'; end if;
  if target_case.pallet_id is not null then
    if target_case.pallet_id = target_pallet.id then raise exception 'This case is already on this pallet.'; end if;
    raise exception 'This case is already assigned to another pallet.';
  end if;
  if target_case.status <> 'produced' then raise exception 'Only available produced cases can be added to a pallet.'; end if;

  select * into target_line from order_lines where id = target_case.order_line_id;
  if not found then raise exception 'The production item for this case was not found.'; end if;

  insert into pallet_cases (pallet_id, production_case_id, scanned_code, item_id, lot_code, weight_lb, scanned_at, added_by)
    values (target_pallet.id, target_case.id, target_case.case_identifier,
      coalesce(target_line.internal_item_id, target_line.external_sku, target_line.vendor_item),
      target_line.lot_code, coalesce(target_case.net_weight, 0), now(), current_profile.id);

  update production_cases set pallet_id = target_pallet.id, status = 'palletized'
    where id = target_case.id and organization_id = current_profile.organization_id;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'case added to pallet', 'pallet', target_pallet.id::text,
      jsonb_build_object('production_case_id', target_case.id, 'case_identifier', target_case.case_identifier));
  return query select target_pallet.id, target_case.id, target_case.case_identifier;
end;
$$;

create or replace function remove_lucid_case_from_pallet(p_pallet_id uuid, p_production_case_id uuid)
returns table (pallet_id uuid, production_case_id uuid)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  target_pallet pallets%rowtype;
  target_case production_cases%rowtype;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot change pallet contents.';
  end if;

  select * into target_pallet from pallets
    where id = p_pallet_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The pallet was not found.'; end if;
  if target_pallet.status <> 'building' then raise exception 'Completed pallets cannot be changed.'; end if;

  select * into target_case from production_cases
    where id = p_production_case_id and organization_id = current_profile.organization_id
      and pallet_id = target_pallet.id
    for update;
  if not found then raise exception 'This case is not assigned to the selected pallet.'; end if;

  delete from pallet_cases where pallet_id = target_pallet.id and production_case_id = target_case.id;
  update production_cases set pallet_id = null, status = 'produced'
    where id = target_case.id and organization_id = current_profile.organization_id;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'case removed from pallet', 'pallet', target_pallet.id::text,
      jsonb_build_object('production_case_id', target_case.id, 'case_identifier', target_case.case_identifier));
  return query select target_pallet.id, target_case.id;
end;
$$;

create or replace function complete_lucid_pallet(p_pallet_id uuid)
returns table (pallet_id uuid, pallet_status text, completed_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  target_pallet pallets%rowtype;
  assigned_case_count integer;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot complete pallets.';
  end if;
  select * into target_pallet from pallets
    where id = p_pallet_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The pallet was not found.'; end if;
  if target_pallet.status = 'complete' then
    return query select target_pallet.id, target_pallet.status, target_pallet.completed_at;
    return;
  end if;
  if target_pallet.status <> 'building' then raise exception 'This pallet cannot be completed.'; end if;
  select count(*) into assigned_case_count from production_cases
    where pallet_id = target_pallet.id and organization_id = current_profile.organization_id
      and status = 'palletized';
  if assigned_case_count = 0 then raise exception 'Add at least one case before completing this pallet.'; end if;

  update pallets set status = 'complete', completed_by = current_profile.id, completed_at = now()
    where id = target_pallet.id and organization_id = current_profile.organization_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'pallet completed', 'pallet', target_pallet.id::text,
      jsonb_build_object('pallet_identifier', target_pallet.pallet_identifier, 'case_count', assigned_case_count));
  return query select target_pallet.id, 'complete'::text, now();
end;
$$;

grant execute on function create_lucid_pallet(uuid) to authenticated;
grant execute on function add_lucid_case_to_pallet(uuid, text) to authenticated;
grant execute on function remove_lucid_case_from_pallet(uuid, uuid) to authenticated;
grant execute on function complete_lucid_pallet(uuid) to authenticated;

commit;
