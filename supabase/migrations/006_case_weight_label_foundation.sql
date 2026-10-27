-- Milestone 3: weight capture and auditable browser-label foundation.
begin;

alter table production_cases
  add column if not exists net_weight_uom text not null default 'LB',
  add column if not exists label_printed_at timestamptz,
  add column if not exists label_printed_by uuid references profiles(id),
  add column if not exists label_print_count integer not null default 0 check (label_print_count >= 0);

create or replace function add_lucid_production_case(
  p_order_id uuid,
  p_order_line_id uuid,
  p_case_identifier text,
  p_quantity numeric,
  p_net_weight numeric default null
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
  prior_quantity numeric;
  new_case_id uuid;
  safe_case_identifier text;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot record production cases.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Case quantity must be greater than zero.'; end if;
  if p_net_weight is null or p_net_weight <= 0 then raise exception 'A net weight greater than zero is required.'; end if;
  if round(p_net_weight, 2) <> p_net_weight then raise exception 'Net weight can have no more than two decimal places.'; end if;

  select * into operational_order from orders
    where id = p_order_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if operational_order.status <> 'in_production' then
    raise exception 'Start production before recording cases.'; end if;
  select * into operational_line from order_lines
    where id = p_order_line_id and order_id = operational_order.id
    for update;
  if not found then raise exception 'The selected production item was not found.'; end if;

  select coalesce(sum(quantity), 0) into prior_quantity from production_cases
    where order_line_id = operational_line.id and organization_id = current_profile.organization_id
      and status <> 'voided';
  if prior_quantity + p_quantity > operational_line.quantity_cases then
    raise exception 'This would exceed the ordered quantity.';
  end if;

  safe_case_identifier := nullif(btrim(p_case_identifier), '');
  if safe_case_identifier is null then
    safe_case_identifier := 'CRB-' || to_char(current_date, 'YYYYMMDD') || '-' ||
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  end if;

  insert into production_cases (
    organization_id, order_id, order_line_id, case_identifier, quantity, net_weight,
    net_weight_uom, uom, status, produced_at, produced_by
  ) values (
    current_profile.organization_id, operational_order.id, operational_line.id,
    safe_case_identifier, p_quantity, p_net_weight, 'LB', coalesce(operational_line.uom, 'CS'),
    'produced', now(), current_profile.id
  ) returning id into new_case_id;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'production case created',
      'production_case', new_case_id::text,
      jsonb_build_object('order_id', operational_order.id, 'order_line_id', operational_line.id,
        'case_identifier', safe_case_identifier, 'quantity', p_quantity, 'net_weight', p_net_weight,
        'net_weight_uom', 'LB'));
  return query select new_case_id, safe_case_identifier, prior_quantity + p_quantity,
    operational_line.quantity_cases - (prior_quantity + p_quantity);
end;
$$;

create or replace function record_lucid_case_label_print(p_production_case_id uuid)
returns table (production_case_id uuid, label_print_count integer, reprint boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  production_case production_cases%rowtype;
  next_print_count integer;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot print case labels.'; end if;
  select * into production_case from production_cases
    where id = p_production_case_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production case was not found.'; end if;
  if production_case.status = 'voided' then
    raise exception 'Voided production cases cannot be printed.';
  end if;

  update production_cases
    set label_printed_at = now(), label_printed_by = current_profile.id,
      label_print_count = label_print_count + 1
    where id = production_case.id and organization_id = current_profile.organization_id
    returning label_print_count into next_print_count;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id,
      case when next_print_count = 1 then 'case label printed' else 'case label reprinted' end,
      'production_case', production_case.id::text,
      jsonb_build_object('order_id', production_case.order_id, 'case_identifier', production_case.case_identifier,
        'print_count', next_print_count));
  return query select production_case.id, next_print_count, next_print_count > 1;
end;
$$;

grant execute on function add_lucid_production_case(uuid, uuid, text, numeric, numeric) to authenticated;
grant execute on function record_lucid_case_label_print(uuid) to authenticated;

commit;
