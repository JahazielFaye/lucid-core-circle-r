-- Correct output-column ambiguity in the applied pallet case RPCs.
begin;

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
  target_case_identifier text;
begin
  select profile_row.* into current_profile
    from profiles as profile_row
    where profile_row.id = auth.uid() and profile_row.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot build pallets.';
  end if;
  target_case_identifier := nullif(btrim(p_case_identifier), '');
  if target_case_identifier is null then raise exception 'Enter a case ID.'; end if;

  select pallet_row.* into target_pallet
    from pallets as pallet_row
    where pallet_row.id = p_pallet_id
      and pallet_row.organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The pallet was not found.'; end if;
  if target_pallet.status <> 'building' then raise exception 'This pallet is complete and cannot be changed.'; end if;

  select case_row.* into target_case
    from production_cases as case_row
    where case_row.organization_id = current_profile.organization_id
      and case_row.case_identifier = target_case_identifier
    for update;
  if not found then raise exception 'No production case was found with that case ID.'; end if;
  if target_case.status = 'voided' then raise exception 'Voided cases cannot be added to a pallet.'; end if;
  if target_case.order_id <> target_pallet.order_id then raise exception 'This case belongs to a different order.'; end if;
  if target_case.pallet_id is not null then
    if target_case.pallet_id = target_pallet.id then raise exception 'This case is already on this pallet.'; end if;
    raise exception 'This case is already assigned to another pallet.';
  end if;
  if target_case.status <> 'produced' then raise exception 'Only available produced cases can be added to a pallet.'; end if;

  select line_row.* into target_line
    from order_lines as line_row
    where line_row.id = target_case.order_line_id;
  if not found then raise exception 'The production item for this case was not found.'; end if;

  insert into pallet_cases as pallet_case_row (
    pallet_id, production_case_id, scanned_code, item_id, lot_code, weight_lb, scanned_at, added_by
  ) values (
    target_pallet.id, target_case.id, target_case.case_identifier,
    coalesce(target_line.internal_item_id, target_line.external_sku, target_line.vendor_item),
    target_line.lot_code, coalesce(target_case.net_weight, 0), now(), current_profile.id
  );

  update production_cases as case_row
    set pallet_id = target_pallet.id, status = 'palletized'
    where case_row.id = target_case.id
      and case_row.organization_id = current_profile.organization_id;

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
  select profile_row.* into current_profile
    from profiles as profile_row
    where profile_row.id = auth.uid() and profile_row.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot change pallet contents.';
  end if;

  select pallet_row.* into target_pallet
    from pallets as pallet_row
    where pallet_row.id = p_pallet_id
      and pallet_row.organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The pallet was not found.'; end if;
  if target_pallet.status <> 'building' then raise exception 'Completed pallets cannot be changed.'; end if;

  select case_row.* into target_case
    from production_cases as case_row
    where case_row.id = p_production_case_id
      and case_row.organization_id = current_profile.organization_id
      and case_row.pallet_id = target_pallet.id
    for update;
  if not found then raise exception 'This case is not assigned to the selected pallet.'; end if;

  delete from pallet_cases as pallet_case_row
    where pallet_case_row.pallet_id = target_pallet.id
      and pallet_case_row.production_case_id = target_case.id;
  update production_cases as case_row
    set pallet_id = null, status = 'produced'
    where case_row.id = target_case.id
      and case_row.organization_id = current_profile.organization_id;

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
  select profile_row.* into current_profile
    from profiles as profile_row
    where profile_row.id = auth.uid() and profile_row.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot complete pallets.';
  end if;
  select pallet_row.* into target_pallet
    from pallets as pallet_row
    where pallet_row.id = p_pallet_id
      and pallet_row.organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The pallet was not found.'; end if;
  if target_pallet.status = 'complete' then
    return query select target_pallet.id, target_pallet.status, target_pallet.completed_at;
    return;
  end if;
  if target_pallet.status <> 'building' then raise exception 'This pallet cannot be completed.'; end if;

  select count(*) into assigned_case_count
    from production_cases as case_row
    where case_row.pallet_id = target_pallet.id
      and case_row.organization_id = current_profile.organization_id
      and case_row.status = 'palletized';
  if assigned_case_count = 0 then raise exception 'Add at least one case before completing this pallet.'; end if;

  update pallets as pallet_row
    set status = 'complete', completed_by = current_profile.id, completed_at = now()
    where pallet_row.id = target_pallet.id
      and pallet_row.organization_id = current_profile.organization_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'pallet completed', 'pallet', target_pallet.id::text,
      jsonb_build_object('pallet_identifier', target_pallet.pallet_identifier, 'case_count', assigned_case_count));
  return query select target_pallet.id, 'complete'::text, now();
end;
$$;

commit;
