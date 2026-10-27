-- Correct unqualified production-lot references in the applied Milestone 4A RPCs.
begin;

create or replace function create_or_get_lucid_production_lot(
  p_order_id uuid,
  p_order_line_id uuid,
  p_lot_code text
)
returns table (production_lot_id uuid, lot_code text, created boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  operational_order orders%rowtype;
  operational_line order_lines%rowtype;
  target_lot production_lots%rowtype;
  target_lot_code text;
begin
  select profile_row.* into current_profile
    from profiles as profile_row
    where profile_row.id = auth.uid() and profile_row.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot manage production lots.';
  end if;
  target_lot_code := nullif(btrim(p_lot_code), '');
  if target_lot_code is null then raise exception 'A production lot or Prod Code is required.'; end if;

  select order_row.* into operational_order
    from orders as order_row
    where order_row.id = p_order_id
      and order_row.organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if operational_order.status <> 'in_production' then raise exception 'Start production before selecting a production lot.'; end if;

  select line_row.* into operational_line
    from order_lines as line_row
    where line_row.id = p_order_line_id
      and line_row.order_id = operational_order.id
    for update;
  if not found then raise exception 'The selected production item was not found.'; end if;

  select lot_row.* into target_lot
    from production_lots as lot_row
    where lot_row.organization_id = current_profile.organization_id
      and lot_row.order_id = operational_order.id
      and lot_row.order_line_id = operational_line.id
      and lot_row.lot_code = target_lot_code
    for update;
  if found then
    if target_lot.status <> 'active' then raise exception 'That production lot is closed.'; end if;
    return query select target_lot.id, target_lot.lot_code, false;
    return;
  end if;

  insert into production_lots as lot_row (organization_id, order_id, order_line_id, lot_code, created_by)
    values (current_profile.organization_id, operational_order.id, operational_line.id, target_lot_code, current_profile.id)
    returning lot_row.* into target_lot;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'production lot created', 'production_lot', target_lot.id::text,
      jsonb_build_object('order_id', operational_order.id, 'order_line_id', operational_line.id, 'lot_code', target_lot.lot_code));
  return query select target_lot.id, target_lot.lot_code, true;
end;
$$;

create or replace function add_lucid_production_case(
  p_order_id uuid,
  p_order_line_id uuid,
  p_case_identifier text,
  p_quantity numeric,
  p_net_weight numeric,
  p_production_lot_id uuid
)
returns table (production_case_id uuid, case_identifier text, produced_quantity numeric, remaining_quantity numeric)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  operational_order orders%rowtype;
  operational_line order_lines%rowtype;
  target_lot production_lots%rowtype;
  prior_quantity numeric;
  new_case_id uuid;
  safe_case_identifier text;
begin
  select profile_row.* into current_profile
    from profiles as profile_row
    where profile_row.id = auth.uid() and profile_row.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot record production cases.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Case quantity must be greater than zero.'; end if;
  if p_net_weight is null or p_net_weight <= 0 then raise exception 'A net weight greater than zero is required.'; end if;
  if round(p_net_weight, 2) <> p_net_weight then raise exception 'Net weight can have no more than two decimal places.'; end if;
  if p_production_lot_id is null then raise exception 'A production lot or Prod Code is required.'; end if;

  select order_row.* into operational_order
    from orders as order_row
    where order_row.id = p_order_id
      and order_row.organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if operational_order.status <> 'in_production' then raise exception 'Start production before recording cases.'; end if;

  select line_row.* into operational_line
    from order_lines as line_row
    where line_row.id = p_order_line_id
      and line_row.order_id = operational_order.id
    for update;
  if not found then raise exception 'The selected production item was not found.'; end if;

  select lot_row.* into target_lot
    from production_lots as lot_row
    where lot_row.id = p_production_lot_id
      and lot_row.organization_id = current_profile.organization_id
      and lot_row.order_id = operational_order.id
      and lot_row.order_line_id = operational_line.id
      and lot_row.status = 'active'
    for update;
  if not found then raise exception 'The selected production lot is not available for this item.'; end if;

  select coalesce(sum(case_row.quantity), 0) into prior_quantity
    from production_cases as case_row
    where case_row.order_line_id = operational_line.id
      and case_row.organization_id = current_profile.organization_id
      and case_row.status <> 'voided';
  if prior_quantity + p_quantity > operational_line.quantity_cases then
    raise exception 'This would exceed the ordered quantity.';
  end if;

  safe_case_identifier := nullif(btrim(p_case_identifier), '');
  if safe_case_identifier is null then
    safe_case_identifier := 'CRB-' || to_char(current_date, 'YYYYMMDD') || '-' ||
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;

  insert into production_cases as case_row (
    organization_id, order_id, order_line_id, production_lot_id, case_identifier, quantity, net_weight,
    net_weight_uom, uom, status, produced_at, produced_by
  ) values (
    current_profile.organization_id, operational_order.id, operational_line.id, target_lot.id,
    safe_case_identifier, p_quantity, p_net_weight, 'LB', coalesce(operational_line.uom, 'CS'),
    'produced', now(), current_profile.id
  ) returning case_row.id into new_case_id;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'production case created',
      'production_case', new_case_id::text,
      jsonb_build_object('order_id', operational_order.id, 'order_line_id', operational_line.id,
        'production_lot_id', target_lot.id, 'lot_code', target_lot.lot_code,
        'case_identifier', safe_case_identifier, 'quantity', p_quantity, 'net_weight', p_net_weight,
        'net_weight_uom', 'LB'));
  return query select new_case_id, safe_case_identifier, prior_quantity + p_quantity,
    operational_line.quantity_cases - (prior_quantity + p_quantity);
end;
$$;

commit;
