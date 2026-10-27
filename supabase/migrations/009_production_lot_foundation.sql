-- Milestone 4A: organization-scoped production lot traceability for weighed cases.
begin;

create table if not exists production_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  order_line_id uuid not null references order_lines(id) on delete restrict,
  lot_code text not null check (length(btrim(lot_code)) > 0),
  status text not null default 'active' check (status in ('active', 'closed')),
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'active' and closed_at is null) or (status = 'closed' and closed_at is not null)),
  unique (organization_id, order_id, order_line_id, lot_code)
);

create index if not exists production_lots_active_lookup_idx
  on production_lots (organization_id, order_id, order_line_id, created_at desc)
  where status = 'active';

alter table production_lots enable row level security;

create policy "production lots same org"
  on production_lots for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

alter table production_cases
  add constraint production_cases_production_lot_fk
  foreign key (production_lot_id) references production_lots(id) on delete restrict;

create index if not exists production_cases_lot_idx
  on production_cases (organization_id, production_lot_id)
  where production_lot_id is not null;

create or replace function validate_lucid_production_case_lot()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_lot production_lots%rowtype;
begin
  if new.production_lot_id is null then
    raise exception 'A production lot is required for new production cases.';
  end if;

  select * into target_lot from production_lots
    where id = new.production_lot_id;
  if not found then
    raise exception 'The selected production lot was not found.';
  end if;
  if target_lot.status <> 'active' then
    raise exception 'The selected production lot is closed.';
  end if;
  if target_lot.organization_id <> new.organization_id
    or target_lot.order_id <> new.order_id
    or target_lot.order_line_id <> new.order_line_id then
    raise exception 'The selected production lot does not belong to this order item.';
  end if;
  return new;
end;
$$;

drop trigger if exists validate_lucid_production_case_lot_trigger on production_cases;
create trigger validate_lucid_production_case_lot_trigger
  before insert or update of production_lot_id on production_cases
  for each row execute function validate_lucid_production_case_lot();

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
  safe_lot_code text;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot manage production lots.';
  end if;
  safe_lot_code := nullif(btrim(p_lot_code), '');
  if safe_lot_code is null then raise exception 'A production lot or Prod Code is required.'; end if;

  select * into operational_order from orders
    where id = p_order_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if operational_order.status <> 'in_production' then raise exception 'Start production before selecting a production lot.'; end if;
  select * into operational_line from order_lines
    where id = p_order_line_id and order_id = operational_order.id
    for update;
  if not found then raise exception 'The selected production item was not found.'; end if;

  select * into target_lot from production_lots
    where organization_id = current_profile.organization_id
      and order_id = operational_order.id
      and order_line_id = operational_line.id
      and lot_code = safe_lot_code
    for update;
  if found then
    if target_lot.status <> 'active' then raise exception 'That production lot is closed.'; end if;
    return query select target_lot.id, target_lot.lot_code, false;
    return;
  end if;

  insert into production_lots (organization_id, order_id, order_line_id, lot_code, created_by)
    values (current_profile.organization_id, operational_order.id, operational_line.id, safe_lot_code, current_profile.id)
    returning * into target_lot;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (current_profile.organization_id, current_profile.id, 'production lot created', 'production_lot', target_lot.id::text,
      jsonb_build_object('order_id', operational_order.id, 'order_line_id', operational_line.id, 'lot_code', target_lot.lot_code));
  return query select target_lot.id, target_lot.lot_code, true;
end;
$$;

create function add_lucid_production_case(
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
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('production', 'office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot record production cases.';
  end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Case quantity must be greater than zero.'; end if;
  if p_net_weight is null or p_net_weight <= 0 then raise exception 'A net weight greater than zero is required.'; end if;
  if round(p_net_weight, 2) <> p_net_weight then raise exception 'Net weight can have no more than two decimal places.'; end if;
  if p_production_lot_id is null then raise exception 'A production lot or Prod Code is required.'; end if;

  select * into operational_order from orders
    where id = p_order_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The production order was not found.'; end if;
  if operational_order.status <> 'in_production' then raise exception 'Start production before recording cases.'; end if;
  select * into operational_line from order_lines
    where id = p_order_line_id and order_id = operational_order.id
    for update;
  if not found then raise exception 'The selected production item was not found.'; end if;
  select * into target_lot from production_lots
    where id = p_production_lot_id
      and organization_id = current_profile.organization_id
      and order_id = operational_order.id
      and order_line_id = operational_line.id
      and status = 'active'
    for update;
  if not found then raise exception 'The selected production lot is not available for this item.'; end if;

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
    organization_id, order_id, order_line_id, production_lot_id, case_identifier, quantity, net_weight,
    net_weight_uom, uom, status, produced_at, produced_by
  ) values (
    current_profile.organization_id, operational_order.id, operational_line.id, target_lot.id,
    safe_case_identifier, p_quantity, p_net_weight, 'LB', coalesce(operational_line.uom, 'CS'),
    'produced', now(), current_profile.id
  ) returning id into new_case_id;

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

revoke execute on function add_lucid_production_case(uuid, uuid, text, numeric, numeric) from public, authenticated;
revoke execute on function create_or_get_lucid_production_lot(uuid, uuid, text) from public;
revoke execute on function add_lucid_production_case(uuid, uuid, text, numeric, numeric, uuid) from public;
grant execute on function create_or_get_lucid_production_lot(uuid, uuid, text) to authenticated;
grant execute on function add_lucid_production_case(uuid, uuid, text, numeric, numeric, uuid) to authenticated;

commit;
