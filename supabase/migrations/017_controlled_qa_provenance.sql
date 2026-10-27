-- Controlled QA provenance for Lucid operational workflows.
-- This is intentionally additive: QA uses the same RLS, role, immutability,
-- audit, allocation, genealogy, and shipment protections as normal operations.
begin;

-- QA is a provenance marker, not an alternate permission model. A QA source
-- reference must be obvious everywhere it appears in an operational workflow.
create or replace function assert_lucid_qa_reference(p_source_system text, p_source_record_id text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if p_source_system = 'lucid_qa'
     and (nullif(btrim(coalesce(p_source_record_id, '')), '') is null
          or upper(btrim(p_source_record_id)) not like 'QA-%') then
    raise exception 'Controlled QA records require a QA- source reference.';
  end if;
end;
$$;

-- Downstream operational records inherit provenance from their durable parent.
-- `to_jsonb(NEW)` is used only to read table-specific keys so this shared
-- trigger never references a field that is absent on one of its target tables.
create or replace function enforce_lucid_operational_provenance()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  row_json jsonb := to_jsonb(new);
  parent_source text;
  parent_reference text;
  related_source text;
begin
  case tg_table_name
    when 'inventory_lots' then
      select source_system, source_record_id into parent_source, parent_reference
      from inventory_transactions where id = (row_json ->> 'source_inventory_transaction_id')::uuid;
    when 'inventory_transaction_lines' then
      select source_system, source_record_id into parent_source, parent_reference
      from inventory_transactions where id = (row_json ->> 'transaction_id')::uuid;
    when 'production_lots' then
      select source_system, source_record_id into parent_source, parent_reference
      from orders where id = (row_json ->> 'order_id')::uuid;
    when 'production_cases' then
      select source_system, source_record_id into parent_source, parent_reference
      from production_lots where id = (row_json ->> 'production_lot_id')::uuid;
    when 'production_runs' then
      select source_system, source_record_id into parent_source, parent_reference
      from orders where id = (row_json ->> 'order_id')::uuid;
      select source_system into related_source from production_lots where id = (row_json ->> 'output_production_lot_id')::uuid;
      if related_source is distinct from parent_source then
        raise exception 'Production run provenance must match its order and output lot.';
      end if;
    when 'production_run_consumptions' then
      select source_system, source_record_id into parent_source, parent_reference
      from production_runs where id = (row_json ->> 'production_run_id')::uuid;
      select source_system into related_source from inventory_lots where id = (row_json ->> 'source_inventory_lot_id')::uuid;
      if related_source is distinct from parent_source then
        raise exception 'Production consumption cannot mix QA and operational inventory lots.';
      end if;
    when 'production_run_outputs' then
      select source_system, source_record_id into parent_source, parent_reference
      from production_runs where id = (row_json ->> 'production_run_id')::uuid;
    when 'case_pick_allocations' then
      select source_system, source_record_id into parent_source, parent_reference
      from production_cases where id = (row_json ->> 'production_case_id')::uuid;
      select source_system into related_source from orders where id = (row_json ->> 'order_id')::uuid;
      if related_source is distinct from parent_source then
        raise exception 'Case allocation cannot mix QA and operational orders or cases.';
      end if;
    when 'pallets' then
      select source_system, source_record_id into parent_source, parent_reference
      from orders where id = (row_json ->> 'order_id')::uuid;
    when 'pallet_case_assignments' then
      select source_system, source_record_id into parent_source, parent_reference
      from pallets where id = (row_json ->> 'pallet_id')::uuid;
      select source_system into related_source from production_cases where id = (row_json ->> 'production_case_id')::uuid;
      if related_source is distinct from parent_source then
        raise exception 'Pallet assignment cannot mix QA and operational pallets or cases.';
      end if;
    when 'shipments' then
      select source_system, source_record_id into parent_source, parent_reference
      from orders where id = (row_json ->> 'order_id')::uuid;
      if parent_source = 'lucid_qa'
         and ((row_json ->> 'bol_reference' is not null and upper(row_json ->> 'bol_reference') not like 'QA-%')
           or (row_json ->> 'carrier_reference' is not null and upper(row_json ->> 'carrier_reference') not like 'QA-%')) then
        raise exception 'QA shipment BOL and carrier references must begin with QA-.';
      end if;
    when 'shipment_contents' then
      select source_system, source_record_id into parent_source, parent_reference
      from shipments where id = (row_json ->> 'shipment_id')::uuid;
      if row_json ? 'production_case_id' and row_json ->> 'production_case_id' is not null then
        select source_system into related_source from production_cases where id = (row_json ->> 'production_case_id')::uuid;
      elsif row_json ? 'pallet_id' and row_json ->> 'pallet_id' is not null then
        select source_system into related_source from pallets where id = (row_json ->> 'pallet_id')::uuid;
      end if;
      if related_source is not null and related_source is distinct from parent_source then
        raise exception 'Shipment contents cannot mix QA and operational records.';
      end if;
  end case;

  if parent_source is not null then
    new.source_system := parent_source;
    new.source_record_id := coalesce(parent_reference, new.source_record_id);
  end if;

  perform assert_lucid_qa_reference(new.source_system, new.source_record_id);
  if new.source_system = 'lucid_qa' then
    new.is_historical := false;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_inventory_lot_provenance on inventory_lots;
drop trigger if exists enforce_inventory_line_provenance on inventory_transaction_lines;
drop trigger if exists enforce_production_lot_provenance on production_lots;
drop trigger if exists enforce_production_case_provenance on production_cases;
drop trigger if exists enforce_production_run_provenance on production_runs;
drop trigger if exists enforce_production_consumption_provenance on production_run_consumptions;
drop trigger if exists enforce_production_output_provenance on production_run_outputs;
drop trigger if exists enforce_pick_allocation_provenance on case_pick_allocations;
drop trigger if exists enforce_pallet_provenance on pallets;
drop trigger if exists enforce_pallet_assignment_provenance on pallet_case_assignments;
drop trigger if exists enforce_shipment_provenance on shipments;
drop trigger if exists enforce_shipment_content_provenance on shipment_contents;

create trigger enforce_inventory_lot_provenance before insert or update on inventory_lots for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_inventory_line_provenance before insert or update on inventory_transaction_lines for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_production_lot_provenance before insert or update on production_lots for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_production_case_provenance before insert or update on production_cases for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_production_run_provenance before insert or update on production_runs for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_production_consumption_provenance before insert or update on production_run_consumptions for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_production_output_provenance before insert or update on production_run_outputs for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_pick_allocation_provenance before insert or update on case_pick_allocations for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_pallet_provenance before insert or update on pallets for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_pallet_assignment_provenance before insert or update on pallet_case_assignments for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_shipment_provenance before insert or update on shipments for each row execute function enforce_lucid_operational_provenance();
create trigger enforce_shipment_content_provenance before insert or update on shipment_contents for each row execute function enforce_lucid_operational_provenance();

-- A QA order is deliberately explicit and Admin-only. It creates no master data,
-- does not copy a real order, and gives controlled production tests an isolated
-- parent so QA cases can never affect a real PO's quantities or shipment state.
create or replace function create_lucid_qa_order(
  p_qa_reference text,
  p_customer text,
  p_ship_to text,
  p_item_code text,
  p_description text,
  p_quantity_cases numeric,
  p_uom text default 'CS'
)
returns table (order_id uuid, order_line_id uuid)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; qa_order_id uuid; qa_line_id uuid; qa_reference text;
begin
  actor := lucid_operational_actor(array['lucid_admin']);
  qa_reference := nullif(btrim(p_qa_reference), '');
  perform assert_lucid_qa_reference('lucid_qa', qa_reference);
  if nullif(btrim(p_customer), '') is null or nullif(btrim(p_item_code), '') is null
     or nullif(btrim(p_description), '') is null or p_quantity_cases is null or p_quantity_cases <= 0 then
    raise exception 'QA customer, item, description, and positive quantity are required.';
  end if;
  insert into orders (organization_id, external_po, customer, ship_to, source, status, source_system, source_record_id, created_by)
  values (actor.organization_id, qa_reference, btrim(p_customer), nullif(btrim(p_ship_to), ''), 'qa', 'ready_for_production', 'lucid_qa', qa_reference, actor.id)
  returning id into qa_order_id;
  insert into order_lines (order_id, external_sku, internal_item_id, description, quantity_cases, uom, source_system, source_record_id)
  values (qa_order_id, btrim(p_item_code), btrim(p_item_code), btrim(p_description), p_quantity_cases, coalesce(nullif(btrim(p_uom), ''), 'CS'), 'lucid_qa', qa_reference)
  returning id into qa_line_id;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (actor.organization_id, actor.id, 'created controlled QA order', 'order', qa_order_id::text,
    jsonb_build_object('qa_reference', qa_reference, 'order_line_id', qa_line_id));
  return query select qa_order_id, qa_line_id;
end;
$$;

-- A deliberately separate root RPC is the only operational entry point that
-- creates QA inventory. Existing receipt RPCs remain lucid_core-only.
create or replace function create_lucid_qa_receipt(
  p_transaction_number text, p_item_id text, p_lot_code text, p_quantity numeric,
  p_quantity_uom text, p_net_weight numeric default null, p_weight_uom text default null,
  p_warehouse_id text default null, p_source_record_id text default null,
  p_vendor_name text default null, p_purchase_order_reference text default null, p_internal_lot_number text default null,
  p_unit_cost numeric default null, p_charge numeric default 0
)
returns table (inventory_transaction_id uuid, inventory_lot_id uuid)
language plpgsql security invoker set search_path = public as $$
declare actor profiles%rowtype; receipt_id uuid; lot_id uuid; qa_reference text;
begin
  actor := lucid_operational_actor(array['lucid_admin']);
  qa_reference := coalesce(nullif(btrim(p_source_record_id), ''), nullif(btrim(p_transaction_number), ''));
  perform assert_lucid_qa_reference('lucid_qa', qa_reference);
  if nullif(btrim(p_transaction_number), '') is null or upper(btrim(p_transaction_number)) not like 'QA-%'
    or nullif(btrim(p_item_id), '') is null or nullif(btrim(p_lot_code), '') is null or p_quantity is null or p_quantity <= 0 then
    raise exception 'QA receipt number, item, lot, and positive quantity are required.';
  end if;
  insert into inventory_transactions (organization_id, transaction_number, transaction_type, warehouse_id, vendor_name, purchase_order_reference, source_system, source_record_id, created_by)
  values (actor.organization_id, btrim(p_transaction_number), 'receipt', nullif(btrim(p_warehouse_id), ''), nullif(btrim(p_vendor_name), ''), nullif(btrim(p_purchase_order_reference), ''), 'lucid_qa', qa_reference, actor.id)
  returning id into receipt_id;
  select id into lot_id from inventory_lots where organization_id = actor.organization_id and item_id = btrim(p_item_id) and lot_code = btrim(p_lot_code);
  if found and exists (select 1 from inventory_lots where id = lot_id and source_system <> 'lucid_qa') then
    raise exception 'A QA receipt cannot reuse an operational inventory lot.';
  end if;
  if not found then
    insert into inventory_lots (organization_id, item_id, lot_code, internal_lot_number, source_inventory_transaction_id, received_date, source_system, source_record_id, created_by)
    values (actor.organization_id, btrim(p_item_id), btrim(p_lot_code), nullif(btrim(p_internal_lot_number), ''), receipt_id, current_date, 'lucid_qa', qa_reference, actor.id) returning id into lot_id;
  end if;
  insert into inventory_transaction_lines (organization_id, transaction_id, item_id, inventory_lot_id, quantity, quantity_uom, net_weight, weight_uom, unit_cost, freight, charge, reason, source_system, source_record_id, created_by)
  values (actor.organization_id, receipt_id, btrim(p_item_id), lot_id, p_quantity, nullif(btrim(p_quantity_uom), ''), p_net_weight, nullif(btrim(p_weight_uom), ''), p_unit_cost, 0, coalesce(p_charge, 0), 'QA receipt', 'lucid_qa', qa_reference, actor.id);
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (actor.organization_id, actor.id, 'created controlled QA inventory receipt', 'inventory_transaction', receipt_id::text, jsonb_build_object('qa_reference', qa_reference, 'lot_id', lot_id));
  return query select receipt_id, lot_id;
end;
$$;

revoke all on function create_lucid_qa_receipt(text,text,text,numeric,text,numeric,text,text,text,text,text,text,numeric,numeric) from public;
grant execute on function create_lucid_qa_receipt(text,text,text,numeric,text,numeric,text,text,text,text,text,text,numeric,numeric) to authenticated;
revoke all on function create_lucid_qa_order(text,text,text,text,text,numeric,text) from public;
grant execute on function create_lucid_qa_order(text,text,text,text,text,numeric,text) to authenticated;

commit;
