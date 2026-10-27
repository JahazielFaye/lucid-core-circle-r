-- Atomic, Lucid-native workflow operations using the traceability foundation from 013.
-- Additive only: no existing operational, SPS, case, pallet, or provenance record is changed.
begin;

-- 013 deliberately kept ledger and shipment references generic. These nullable
-- operational labels support receiving/BOL screens without inventing vendors,
-- carriers, or accounting entities as new masters.
alter table inventory_transactions
  add column if not exists vendor_name text,
  add column if not exists purchase_order_reference text;
alter table shipments
  add column if not exists carrier_name text,
  add column if not exists carrier_reference text;

create or replace function lucid_operational_actor(p_allowed_roles text[])
returns profiles
language plpgsql
security invoker
set search_path = public
as $$
declare actor profiles%rowtype;
begin
  select * into actor from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if not actor.role = any(p_allowed_roles) then raise exception 'Your role cannot perform this operational action.'; end if;
  return actor;
end;
$$;

create or replace function create_lucid_receipt(
  p_transaction_number text, p_item_id text, p_lot_code text, p_quantity numeric,
  p_quantity_uom text, p_net_weight numeric default null, p_weight_uom text default null,
  p_warehouse_id text default null, p_source_record_id text default null,
  p_vendor_name text default null, p_purchase_order_reference text default null, p_internal_lot_number text default null,
  p_unit_cost numeric default null, p_charge numeric default 0
)
returns table (inventory_transaction_id uuid, inventory_lot_id uuid)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; receipt_id uuid; lot_id uuid;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  if nullif(btrim(p_transaction_number), '') is null or nullif(btrim(p_item_id), '') is null
    or nullif(btrim(p_lot_code), '') is null or p_quantity is null or p_quantity <= 0 then
    raise exception 'Receipt number, item, lot, and positive quantity are required.';
  end if;
  insert into inventory_transactions (organization_id, transaction_number, transaction_type, warehouse_id, vendor_name, purchase_order_reference, source_system, source_record_id, created_by)
  values (actor.organization_id, btrim(p_transaction_number), 'receipt', nullif(btrim(p_warehouse_id), ''), nullif(btrim(p_vendor_name), ''), nullif(btrim(p_purchase_order_reference), ''), 'lucid_core', nullif(btrim(p_source_record_id), ''), actor.id)
  returning id into receipt_id;
  select id into lot_id from inventory_lots
    where organization_id = actor.organization_id
      and item_id = btrim(p_item_id)
      and lot_code = btrim(p_lot_code);
  if not found then
    insert into inventory_lots (organization_id, item_id, lot_code, internal_lot_number, source_inventory_transaction_id, received_date, source_system, source_record_id, created_by)
    values (actor.organization_id, btrim(p_item_id), btrim(p_lot_code), nullif(btrim(p_internal_lot_number), ''), receipt_id, current_date, 'lucid_core', nullif(btrim(p_source_record_id), ''), actor.id)
    returning id into lot_id;
  end if;
  insert into inventory_transaction_lines (organization_id, transaction_id, item_id, inventory_lot_id, quantity, quantity_uom, net_weight, weight_uom, unit_cost, freight, charge, reason, source_system, source_record_id, created_by)
  values (actor.organization_id, receipt_id, btrim(p_item_id), lot_id, p_quantity, nullif(btrim(p_quantity_uom), ''), p_net_weight, nullif(btrim(p_weight_uom), ''), p_unit_cost, 0, coalesce(p_charge, 0), 'Receipt', 'lucid_core', nullif(btrim(p_source_record_id), ''), actor.id);
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (actor.organization_id, actor.id, 'created inventory receipt', 'inventory_transaction', receipt_id::text, jsonb_build_object('lot_id', lot_id, 'transaction_number', btrim(p_transaction_number)));
  return query select receipt_id, lot_id;
end; $$;

create or replace function append_lucid_receipt_line(
  p_transaction_id uuid, p_item_id text, p_lot_code text, p_quantity numeric, p_quantity_uom text,
  p_net_weight numeric default null, p_weight_uom text default null, p_internal_lot_number text default null,
  p_unit_cost numeric default null, p_charge numeric default 0
)
returns table (inventory_lot_id uuid)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; receipt inventory_transactions%rowtype; lot_id uuid;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  select * into receipt from inventory_transactions where id = p_transaction_id and organization_id = actor.organization_id for update;
  if not found or receipt.status <> 'draft' or receipt.transaction_type <> 'receipt' then raise exception 'Only a draft receipt can receive additional lines.'; end if;
  if nullif(btrim(p_item_id), '') is null or nullif(btrim(p_lot_code), '') is null or p_quantity is null or p_quantity <= 0 then raise exception 'Item, lot, and positive quantity are required.'; end if;
  select id into lot_id from inventory_lots
    where organization_id = actor.organization_id
      and item_id = btrim(p_item_id)
      and lot_code = btrim(p_lot_code);
  if not found then
    insert into inventory_lots (organization_id, item_id, lot_code, internal_lot_number, source_inventory_transaction_id, received_date, source_system, created_by)
    values (actor.organization_id, btrim(p_item_id), btrim(p_lot_code), nullif(btrim(p_internal_lot_number), ''), receipt.id, current_date, 'lucid_core', actor.id) returning id into lot_id;
  end if;
  insert into inventory_transaction_lines (organization_id, transaction_id, item_id, inventory_lot_id, quantity, quantity_uom, net_weight, weight_uom, unit_cost, freight, charge, reason, source_system, created_by)
  values (actor.organization_id, receipt.id, btrim(p_item_id), lot_id, p_quantity, nullif(btrim(p_quantity_uom), ''), p_net_weight, nullif(btrim(p_weight_uom), ''), p_unit_cost, 0, coalesce(p_charge, 0), 'Receipt', 'lucid_core', actor.id);
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (actor.organization_id, actor.id, 'added receipt line', 'inventory_transaction', receipt.id::text, jsonb_build_object('lot_id', lot_id, 'item_id', btrim(p_item_id)));
  return query select lot_id;
end; $$;

create or replace function post_lucid_inventory_transaction(p_transaction_id uuid)
returns table (inventory_transaction_id uuid, status text, posted_at timestamptz)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; posted inventory_transactions%rowtype;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  select * into posted from inventory_transactions where id = p_transaction_id and organization_id = actor.organization_id for update;
  if not found then raise exception 'Inventory transaction was not found.'; end if;
  if posted.status = 'posted' then return query select posted.id, posted.status, posted.posted_at; return; end if;
  if posted.status <> 'draft' then raise exception 'Only draft inventory transactions can be posted.'; end if;
  if not exists (select 1 from inventory_transaction_lines where transaction_id = posted.id and organization_id = actor.organization_id) then raise exception 'Add at least one inventory line before posting.'; end if;
  update inventory_transactions set status = 'posted', posted_at = now(), posted_by = actor.id where id = posted.id returning * into posted;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details) values (actor.organization_id, actor.id, 'posted inventory transaction', 'inventory_transaction', posted.id::text, jsonb_build_object('transaction_number', posted.transaction_number));
  return query select posted.id, posted.status, posted.posted_at;
end; $$;

-- 013's organization RLS establishes tenant isolation. This guard adds the
-- operational role boundary so a production profile cannot write inventory by
-- calling PostgREST directly instead of using the Receiving workspace.
create or replace function assert_lucid_inventory_write_role()
returns trigger
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; target_organization_id uuid;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  if tg_op = 'DELETE' then target_organization_id := old.organization_id;
  else target_organization_id := new.organization_id;
  end if;
  if actor.organization_id is distinct from target_organization_id then
    raise exception 'Inventory records must belong to your organization.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

drop trigger if exists enforce_inventory_transaction_write_role on inventory_transactions;
drop trigger if exists enforce_inventory_lot_write_role on inventory_lots;
drop trigger if exists enforce_inventory_line_write_role on inventory_transaction_lines;
create trigger enforce_inventory_transaction_write_role before insert or update or delete on inventory_transactions
  for each row execute function assert_lucid_inventory_write_role();
create trigger enforce_inventory_lot_write_role before insert or update or delete on inventory_lots
  for each row execute function assert_lucid_inventory_write_role();
create trigger enforce_inventory_line_write_role before insert or update or delete on inventory_transaction_lines
  for each row execute function assert_lucid_inventory_write_role();

-- The traceability foundation's RLS policies isolate organizations. These guards
-- add active-profile role enforcement for direct PostgREST writes as well as RPCs.
create or replace function assert_lucid_production_write_role()
returns trigger
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; target_organization_id uuid;
begin
  actor := lucid_operational_actor(array['production','office','leadership','lucid_admin']);
  if tg_op = 'DELETE' then target_organization_id := old.organization_id;
  else target_organization_id := new.organization_id;
  end if;
  if actor.organization_id is distinct from target_organization_id then raise exception 'Production records must belong to your organization.'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function assert_lucid_pick_allocation_write_role()
returns trigger
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; target_organization_id uuid;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  if tg_op = 'DELETE' then target_organization_id := old.organization_id;
  else target_organization_id := new.organization_id;
  end if;
  if actor.organization_id is distinct from target_organization_id then raise exception 'Pick allocations must belong to your organization.'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

drop trigger if exists enforce_production_run_write_role on production_runs;
drop trigger if exists enforce_production_consumption_write_role on production_run_consumptions;
drop trigger if exists enforce_production_output_write_role on production_run_outputs;
drop trigger if exists enforce_production_lot_write_role on production_lots;
drop trigger if exists enforce_production_case_write_role on production_cases;
drop trigger if exists enforce_pick_allocation_write_role on case_pick_allocations;
drop trigger if exists enforce_pallet_assignment_write_role on pallet_case_assignments;
create trigger enforce_production_run_write_role before insert or update or delete on production_runs
  for each row execute function assert_lucid_production_write_role();
create trigger enforce_production_consumption_write_role before insert or update or delete on production_run_consumptions
  for each row execute function assert_lucid_production_write_role();
create trigger enforce_production_output_write_role before insert or update or delete on production_run_outputs
  for each row execute function assert_lucid_production_write_role();
create trigger enforce_production_lot_write_role before insert or update or delete on production_lots
  for each row execute function assert_lucid_production_write_role();
create trigger enforce_production_case_write_role before insert or update or delete on production_cases
  for each row execute function assert_lucid_production_write_role();
create trigger enforce_pick_allocation_write_role before insert or update or delete on case_pick_allocations
  for each row execute function assert_lucid_pick_allocation_write_role();
create trigger enforce_pallet_assignment_write_role before insert or update or delete on pallet_case_assignments
  for each row execute function assert_lucid_production_write_role();

create or replace function create_lucid_production_run(p_order_id uuid, p_output_production_lot_id uuid, p_output_item_id text, p_reference text default null)
returns table (production_run_id uuid)
language plpgsql security invoker set search_path = public as $$
  declare actor profiles%rowtype; run_id uuid; output_lot production_lots%rowtype; output_line order_lines%rowtype;
begin
  actor := lucid_operational_actor(array['production','office','leadership','lucid_admin']);
  if not exists (select 1 from orders where id = p_order_id and organization_id = actor.organization_id) then raise exception 'Production order was not found.'; end if;
  select * into output_lot from production_lots where id = p_output_production_lot_id and organization_id = actor.organization_id and order_id = p_order_id;
  if not found then raise exception 'Output production lot was not found for this order.'; end if;
  select * into output_line from order_lines where id = output_lot.order_line_id and order_id = p_order_id;
  if not found then raise exception 'Output production lot is not linked to an order item.'; end if;
  if nullif(btrim(p_output_item_id), '') is null or btrim(p_output_item_id) is distinct from coalesce(output_line.internal_item_id, output_line.external_sku, output_line.vendor_item) then
    raise exception 'Production run output item must match the production lot order item.';
  end if;
  insert into production_runs (organization_id, order_id, production_reference, output_item_id, output_production_lot_id, status, started_at, started_by, source_system, created_by)
  values (actor.organization_id, p_order_id, nullif(btrim(p_reference), ''), nullif(btrim(p_output_item_id), ''), p_output_production_lot_id, 'in_progress', now(), actor.id, 'lucid_core', actor.id) returning id into run_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details) values (actor.organization_id, actor.id, 'started production run', 'production_run', run_id::text, jsonb_build_object('order_id', p_order_id, 'production_lot_id', p_output_production_lot_id));
  return query select run_id;
end; $$;

create or replace function record_lucid_production_consumption(p_production_run_id uuid, p_inventory_lot_id uuid, p_item_id text, p_quantity numeric, p_quantity_uom text default null, p_net_weight numeric default null, p_weight_uom text default null)
returns table (production_consumption_id uuid)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; run_row production_runs%rowtype; consumption_id uuid;
begin
  actor := lucid_operational_actor(array['production','office','leadership','lucid_admin']);
  select * into run_row from production_runs where id = p_production_run_id and organization_id = actor.organization_id for update;
  if not found or run_row.status not in ('planned','in_progress') then raise exception 'Production run is not available for consumption.'; end if;
  if not exists (select 1 from inventory_lots where id = p_inventory_lot_id and organization_id = actor.organization_id and status = 'active' and item_id = btrim(p_item_id)) then raise exception 'Source inventory lot is not active for the selected item.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Consumed quantity must be greater than zero.'; end if;
  if p_net_weight is not null and p_net_weight < 0 then raise exception 'Consumed weight cannot be negative.'; end if;
  insert into production_run_consumptions (organization_id, production_run_id, source_inventory_lot_id, item_id, quantity, quantity_uom, net_weight, weight_uom, recorded_by, created_by)
  values (actor.organization_id, run_row.id, p_inventory_lot_id, btrim(p_item_id), p_quantity, nullif(btrim(p_quantity_uom), ''), p_net_weight, nullif(btrim(p_weight_uom), ''), actor.id, actor.id) returning id into consumption_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (actor.organization_id, actor.id, 'recorded production consumption', 'production_run_consumption', consumption_id::text, jsonb_build_object('production_run_id', run_row.id, 'inventory_lot_id', p_inventory_lot_id));
  return query select consumption_id;
end; $$;

create or replace function record_lucid_production_output(p_production_run_id uuid, p_item_id text, p_quantity numeric, p_quantity_uom text default null, p_weight numeric default null, p_weight_uom text default null)
returns table (production_output_id uuid)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; run_row production_runs%rowtype; output_id uuid;
begin
  actor := lucid_operational_actor(array['production','office','leadership','lucid_admin']);
  select * into run_row from production_runs where id = p_production_run_id and organization_id = actor.organization_id for update;
  if not found or run_row.status not in ('planned','in_progress') then raise exception 'Production run is not available for output.'; end if;
  if p_quantity is null or p_quantity <= 0 then raise exception 'Produced quantity must be greater than zero.'; end if;
  if p_weight is not null and p_weight < 0 then raise exception 'Produced weight cannot be negative.'; end if;
  if nullif(btrim(p_item_id), '') is null or btrim(p_item_id) is distinct from run_row.output_item_id then raise exception 'Production output item must match the production run output item.'; end if;
  insert into production_run_outputs (organization_id, production_run_id, output_production_lot_id, output_inventory_lot_id, item_id, produced_quantity, quantity_uom, produced_weight, weight_uom, recorded_by, created_by)
  values (actor.organization_id, run_row.id, run_row.output_production_lot_id, run_row.output_inventory_lot_id, btrim(p_item_id), p_quantity, nullif(btrim(p_quantity_uom), ''), p_weight, nullif(btrim(p_weight_uom), ''), actor.id, actor.id) returning id into output_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (actor.organization_id, actor.id, 'recorded production output', 'production_run_output', output_id::text, jsonb_build_object('production_run_id', run_row.id, 'production_lot_id', run_row.output_production_lot_id));
  return query select output_id;
end; $$;

create or replace function link_lucid_case_to_production_run(p_production_case_id uuid, p_production_run_id uuid)
returns void language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; run_row production_runs%rowtype; target_case production_cases%rowtype; output_lot production_lots%rowtype;
begin
  actor := lucid_operational_actor(array['production','office','leadership','lucid_admin']);
  select * into run_row from production_runs where id = p_production_run_id and organization_id = actor.organization_id;
  if not found then raise exception 'Production run was not found.'; end if;
  select * into target_case from production_cases where id = p_production_case_id and organization_id = actor.organization_id and order_id = run_row.order_id;
  if not found then raise exception 'Production case was not found for this production run order.'; end if;
  select * into output_lot from production_lots where id = run_row.output_production_lot_id and organization_id = actor.organization_id;
  if not found or target_case.order_line_id is distinct from output_lot.order_line_id then raise exception 'Production case must belong to the production run output item.'; end if;
  update production_cases set production_run_id = run_row.id, output_inventory_lot_id = run_row.output_inventory_lot_id
    where id = p_production_case_id and organization_id = actor.organization_id and order_id = run_row.order_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (actor.organization_id, actor.id, 'linked case to production run', 'production_case', target_case.id::text, jsonb_build_object('production_run_id', run_row.id));
end; $$;

create or replace function allocate_lucid_case(p_order_id uuid, p_order_line_id uuid, p_production_case_id uuid)
returns table (pick_allocation_id uuid)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; allocation_id uuid;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  if not exists (select 1 from production_cases where id = p_production_case_id and organization_id = actor.organization_id and status <> 'voided') then raise exception 'Produced case was not found.'; end if;
  insert into case_pick_allocations (organization_id, order_id, order_line_id, production_case_id, allocated_by, source_system)
  values (actor.organization_id, p_order_id, p_order_line_id, p_production_case_id, actor.id, 'lucid_core') returning id into allocation_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details) values (actor.organization_id, actor.id, 'allocated case to order line', 'case_pick_allocation', allocation_id::text, jsonb_build_object('production_case_id', p_production_case_id, 'order_id', p_order_id, 'order_line_id', p_order_line_id));
  return query select allocation_id;
end; $$;

create or replace function remove_lucid_case_allocation(p_pick_allocation_id uuid, p_reason text)
returns void language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  if nullif(btrim(p_reason), '') is null then raise exception 'A reallocation reason is required.'; end if;
  update case_pick_allocations set status = 'removed', removed_at = now(), removed_by = actor.id, removal_reason = btrim(p_reason)
    where id = p_pick_allocation_id and organization_id = actor.organization_id and status = 'active';
  if not found then raise exception 'Active pick allocation was not found.'; end if;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (actor.organization_id, actor.id, 'removed case allocation', 'case_pick_allocation', p_pick_allocation_id::text, jsonb_build_object('reason', btrim(p_reason)));
end; $$;

create or replace function create_lucid_shipment(p_order_id uuid, p_bol_reference text default null, p_carrier_name text default null, p_carrier_reference text default null)
returns table (shipment_id uuid)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; shipment_id uuid;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  insert into shipments (organization_id, order_id, customer_id, ship_to_id, bol_reference, carrier_name, carrier_reference, status, source_system, created_by)
  select actor.organization_id, o.id, o.customer_id, o.ship_to_id, nullif(btrim(p_bol_reference), ''), nullif(btrim(p_carrier_name), ''), nullif(btrim(p_carrier_reference), ''), 'building', 'lucid_core', actor.id from orders o where o.id = p_order_id and o.organization_id = actor.organization_id returning id into shipment_id;
  if shipment_id is null then raise exception 'Order was not found.'; end if;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details) values (actor.organization_id, actor.id, 'created shipment', 'shipment', shipment_id::text, jsonb_build_object('order_id', p_order_id));
  return query select shipment_id;
end; $$;

-- Shipment records use the same organization RLS as the traceability
-- foundation, with an explicit operational-role guard for direct table writes.
create or replace function assert_lucid_shipment_write_role()
returns trigger
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; target_organization_id uuid;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  if tg_op = 'DELETE' then target_organization_id := old.organization_id;
  else target_organization_id := new.organization_id;
  end if;
  if actor.organization_id is distinct from target_organization_id then
    raise exception 'Shipment records must belong to your organization.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create or replace function protect_lucid_completed_shipment_contents()
returns trigger
language plpgsql security invoker set search_path = public as $$
declare target_shipment_id uuid; target_status text;
begin
  if tg_op = 'DELETE' then target_shipment_id := old.shipment_id;
  else target_shipment_id := new.shipment_id;
  end if;
  select status into target_status from shipments where id = target_shipment_id;
  if target_status = 'completed' then
    raise exception 'Completed shipment contents cannot be changed.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

drop trigger if exists enforce_shipment_write_role on shipments;
drop trigger if exists enforce_shipment_content_write_role on shipment_contents;
drop trigger if exists protect_completed_shipment_contents on shipment_contents;
create trigger enforce_shipment_write_role before insert or update or delete on shipments
  for each row execute function assert_lucid_shipment_write_role();
create trigger enforce_shipment_content_write_role before insert or update or delete on shipment_contents
  for each row execute function assert_lucid_shipment_write_role();
create trigger protect_completed_shipment_contents before insert or update or delete on shipment_contents
  for each row execute function protect_lucid_completed_shipment_contents();

create or replace function add_lucid_shipment_content(p_shipment_id uuid, p_production_case_id uuid default null, p_pallet_id uuid default null)
returns table (shipment_content_id uuid)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; content_id uuid; shipment_row shipments%rowtype;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  if ((p_production_case_id is not null)::integer + (p_pallet_id is not null)::integer) <> 1 then raise exception 'Add either one case or one pallet to a shipment.'; end if;
  select * into shipment_row from shipments where id = p_shipment_id and organization_id = actor.organization_id for update;
  if not found or shipment_row.status <> 'building' then raise exception 'Only a building shipment can receive contents.'; end if;
  if p_production_case_id is not null and not exists (
    select 1 from production_cases where id = p_production_case_id and organization_id = actor.organization_id and status <> 'voided'
  ) then raise exception 'Only an active produced case can be added to a shipment.'; end if;
  if p_production_case_id is not null and exists (
    select 1 from production_cases as case_row join pallets as pallet_row on pallet_row.id = case_row.pallet_id
      where case_row.id = p_production_case_id and pallet_row.organization_id = actor.organization_id and pallet_row.status = 'complete'
  ) then raise exception 'A case on a completed pallet must ship with its pallet.'; end if;
  if p_pallet_id is not null and not exists (
    select 1 from pallets where id = p_pallet_id and organization_id = actor.organization_id and status = 'complete'
  ) then raise exception 'Only a completed pallet can be added to a shipment.'; end if;
  insert into shipment_contents (organization_id, shipment_id, production_case_id, pallet_id, added_by, source_system)
  values (actor.organization_id, p_shipment_id, p_production_case_id, p_pallet_id, actor.id, 'lucid_core') returning id into content_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (actor.organization_id, actor.id, 'added shipment content', 'shipment_content', content_id::text, jsonb_build_object('shipment_id', shipment_row.id, 'production_case_id', p_production_case_id, 'pallet_id', p_pallet_id));
  return query select content_id;
end; $$;

create or replace function complete_lucid_shipment(p_shipment_id uuid, p_invoice_number text default null, p_external_accounting_id text default null, p_invoice_status text default null)
returns table (shipment_id uuid, status text)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; completed shipments%rowtype;
begin
  actor := lucid_operational_actor(array['office','leadership','lucid_admin']);
  select * into completed from shipments where id = p_shipment_id and organization_id = actor.organization_id for update;
  if not found then raise exception 'Shipment was not found.'; end if;
  if completed.status = 'completed' then return query select completed.id, completed.status; return; end if;
  if nullif(btrim(completed.bol_reference), '') is null then raise exception 'A BOL reference is required before completing a shipment.'; end if;
  if not exists (select 1 from shipment_contents where shipment_id = completed.id and organization_id = actor.organization_id and status = 'active') then raise exception 'Add at least one case or pallet before completing shipment.'; end if;
  update shipments set status = 'completed', shipped_at = now(), completed_by = actor.id, invoice_number = coalesce(nullif(btrim(p_invoice_number), ''), invoice_number), external_accounting_id = coalesce(nullif(btrim(p_external_accounting_id), ''), external_accounting_id), invoice_status = coalesce(nullif(btrim(p_invoice_status), ''), invoice_status) where id = completed.id returning * into completed;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details) values (actor.organization_id, actor.id, 'completed shipment', 'shipment', completed.id::text, jsonb_build_object('bol_reference', completed.bol_reference, 'invoice_number', completed.invoice_number));
  return query select completed.id, completed.status;
end; $$;

grant execute on function create_lucid_receipt(text,text,text,numeric,text,numeric,text,text,text,text,text,text,numeric,numeric) to authenticated;
grant execute on function append_lucid_receipt_line(uuid,text,text,numeric,text,numeric,text,text,numeric,numeric) to authenticated;
grant execute on function post_lucid_inventory_transaction(uuid) to authenticated;
grant execute on function create_lucid_production_run(uuid,uuid,text,text) to authenticated;
grant execute on function record_lucid_production_consumption(uuid,uuid,text,numeric,text,numeric,text) to authenticated;
grant execute on function record_lucid_production_output(uuid,text,numeric,text,numeric,text) to authenticated;
grant execute on function link_lucid_case_to_production_run(uuid,uuid) to authenticated;
grant execute on function allocate_lucid_case(uuid,uuid,uuid) to authenticated;
grant execute on function remove_lucid_case_allocation(uuid,text) to authenticated;
grant execute on function create_lucid_shipment(uuid,text,text,text) to authenticated;
grant execute on function add_lucid_shipment_content(uuid,uuid,uuid) to authenticated;
grant execute on function complete_lucid_shipment(uuid,text,text,text) to authenticated;

commit;
