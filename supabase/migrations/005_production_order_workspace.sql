-- Milestone 2: organization-scoped production execution records.
begin;

create table if not exists production_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  order_line_id uuid not null references order_lines(id) on delete restrict,
  production_lot_id uuid,
  case_identifier text not null,
  quantity numeric not null check (quantity > 0),
  net_weight numeric check (net_weight is null or net_weight >= 0),
  uom text not null,
  status text not null default 'produced'
    check (status in ('produced', 'palletized', 'shipped', 'voided')),
  produced_at timestamptz not null default now(),
  produced_by uuid not null references profiles(id),
  pallet_id uuid references pallets(id) on delete set null,
  voided_by uuid references profiles(id),
  voided_at timestamptz,
  void_reason text,
  created_at timestamptz not null default now(),
  check (
    (status <> 'voided' and voided_by is null and voided_at is null)
    or status = 'voided'
  ),
  unique (organization_id, case_identifier)
);

create index if not exists production_cases_order_line_active_idx
  on production_cases (organization_id, order_id, order_line_id)
  where status <> 'voided';

alter table production_cases enable row level security;

create policy "production cases same org"
  on production_cases for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create or replace function start_lucid_production(p_order_id uuid)
returns table (order_id uuid, operational_status text, already_started boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  operational_order orders%rowtype;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot start production.'; end if;

  select * into operational_order from orders
    where id = p_order_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if operational_order.status = 'in_production' then
    return query select operational_order.id, operational_order.status, true;
    return;
  end if;
  if operational_order.status <> 'ready_for_production' then
    raise exception 'This order is not ready to start production.'; end if;

  update orders set status = 'in_production'
    where id = operational_order.id and organization_id = current_profile.organization_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'production started', 'order',
      operational_order.id::text, jsonb_build_object('po_number', operational_order.external_po));
  return query select operational_order.id, 'in_production'::text, false;
end;
$$;

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
    uom, status, produced_at, produced_by
  ) values (
    current_profile.organization_id, operational_order.id, operational_line.id,
    safe_case_identifier, p_quantity, p_net_weight, coalesce(operational_line.uom, 'CS'),
    'produced', now(), current_profile.id
  ) returning id into new_case_id;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'production case created',
      'production_case', new_case_id::text,
      jsonb_build_object('order_id', operational_order.id, 'order_line_id', operational_line.id,
        'case_identifier', safe_case_identifier, 'quantity', p_quantity));
  return query select new_case_id, safe_case_identifier, prior_quantity + p_quantity,
    operational_line.quantity_cases - (prior_quantity + p_quantity);
end;
$$;

create or replace function void_lucid_production_case(p_production_case_id uuid, p_void_reason text)
returns table (production_case_id uuid, operational_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  production_case production_cases%rowtype;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot correct production cases.'; end if;
  select * into production_case from production_cases
    where id = p_production_case_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production case was not found.'; end if;
  if production_case.status = 'voided' then
    return query select production_case.id, (select status from orders where id = production_case.order_id);
    return;
  end if;
  if nullif(btrim(p_void_reason), '') is null then raise exception 'A reason is required to void a production case.'; end if;
  update production_cases set status = 'voided', voided_by = current_profile.id,
    voided_at = now(), void_reason = btrim(p_void_reason)
    where id = production_case.id and organization_id = current_profile.organization_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'production case voided',
      'production_case', production_case.id::text,
      jsonb_build_object('order_id', production_case.order_id, 'reason', btrim(p_void_reason)));
  return query select production_case.id, (select status from orders where id = production_case.order_id);
end;
$$;

create or replace function complete_lucid_production(p_order_id uuid)
returns table (order_id uuid, operational_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_profile profiles%rowtype;
  operational_order orders%rowtype;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot complete production.'; end if;
  select * into operational_order from orders
    where id = p_order_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if operational_order.status = 'production_complete' then
    return query select operational_order.id, operational_order.status;
    return;
  end if;
  if operational_order.status <> 'in_production' then
    raise exception 'Start production before completing this order.'; end if;
  if exists (
    select 1 from order_lines line
    where line.order_id = operational_order.id
      and coalesce((select sum(production_case.quantity) from production_cases production_case
        where production_case.order_line_id = line.id and production_case.status <> 'voided'), 0) < line.quantity_cases
  ) then raise exception 'All ordered quantities must be produced before completion.'; end if;

  update orders set status = 'production_complete'
    where id = operational_order.id and organization_id = current_profile.organization_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'production completed', 'order',
      operational_order.id::text, jsonb_build_object('po_number', operational_order.external_po));
  return query select operational_order.id, 'production_complete'::text;
end;
$$;

grant execute on function start_lucid_production(uuid) to authenticated;
grant execute on function add_lucid_production_case(uuid, uuid, text, numeric, numeric) to authenticated;
grant execute on function void_lucid_production_case(uuid, text) to authenticated;
grant execute on function complete_lucid_production(uuid) to authenticated;

commit;
