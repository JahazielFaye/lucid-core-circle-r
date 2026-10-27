-- Durable Lucid-native traceability foundation.
-- This migration is additive: existing SPS, production, case, pallet, and audit behavior remains intact.
begin;

-- A batch is the common provenance boundary for future historical imports.
create table if not exists integration_import_batches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  source_system text not null check (length(btrim(source_system)) > 0),
  source_reference text,
  status text not null default 'started' check (status in ('started', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_by uuid references profiles(id) on delete set null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check ((status = 'completed' and completed_at is not null) or status <> 'completed')
);

alter table integration_import_batches enable row level security;
create policy "trace import batches same org" on integration_import_batches for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());

-- Native customer references are deliberately separate from source-system mapping records.
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  customer_code text,
  name text not null check (length(btrim(name)) > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, customer_code)
);

create table if not exists customer_ship_tos (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  location_code text,
  name text not null check (length(btrim(name)) > 0),
  address_summary text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, customer_id, location_code)
);

alter table customers enable row level security;
alter table customer_ship_tos enable row level security;
create policy "trace customers same org" on customers for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "trace ship tos same org" on customer_ship_tos for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());

-- Preserve existing text customer/ship-to fields for backward compatibility, while allowing
-- new native operational records to carry durable references and source provenance.
alter table orders
  add column if not exists customer_id uuid references customers(id) on delete restrict,
  add column if not exists ship_to_id uuid references customer_ship_tos(id) on delete restrict,
  add column if not exists source_system text not null default 'lucid_core',
  add column if not exists source_record_id text,
  add column if not exists import_batch_id uuid references integration_import_batches(id) on delete restrict,
  add column if not exists is_historical boolean not null default false,
  add column if not exists invoice_number text,
  add column if not exists external_accounting_id text,
  add column if not exists invoice_status text;

alter table order_lines
  add column if not exists source_system text not null default 'lucid_core',
  add column if not exists source_record_id text,
  add column if not exists import_batch_id uuid references integration_import_batches(id) on delete restrict,
  add column if not exists is_historical boolean not null default false;

alter table production_lots
  add column if not exists source_system text not null default 'lucid_core',
  add column if not exists source_record_id text,
  add column if not exists import_batch_id uuid references integration_import_batches(id) on delete restrict,
  add column if not exists is_historical boolean not null default false;

alter table production_cases
  add column if not exists source_system text not null default 'lucid_core',
  add column if not exists source_record_id text,
  add column if not exists import_batch_id uuid references integration_import_batches(id) on delete restrict,
  add column if not exists is_historical boolean not null default false;

alter table pallets
  add column if not exists source_system text not null default 'lucid_core',
  add column if not exists source_record_id text,
  add column if not exists import_batch_id uuid references integration_import_batches(id) on delete restrict,
  add column if not exists is_historical boolean not null default false;

alter table orders add constraint orders_trace_source_system_present
  check (length(btrim(source_system)) > 0);
alter table order_lines add constraint order_lines_trace_source_system_present
  check (length(btrim(source_system)) > 0);
alter table production_lots add constraint production_lots_trace_source_system_present
  check (length(btrim(source_system)) > 0);
alter table production_cases add constraint production_cases_trace_source_system_present
  check (length(btrim(source_system)) > 0);
alter table pallets add constraint pallets_trace_source_system_present
  check (length(btrim(source_system)) > 0);

-- Immutable inventory ledger: a posted transaction is never edited or deleted; corrections
-- use a new reversal transaction linked back to the original record.
create table if not exists inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  transaction_number text not null check (length(btrim(transaction_number)) > 0),
  transaction_type text not null check (length(btrim(transaction_type)) > 0),
  status text not null default 'draft' check (status in ('draft', 'posted', 'voided', 'reversed')),
  warehouse_id text,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  transaction_date timestamptz not null default now(),
  posted_at timestamptz,
  posted_by uuid references profiles(id) on delete set null,
  reversal_of_transaction_id uuid references inventory_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  unique (organization_id, transaction_number),
  check ((status = 'posted' and posted_at is not null and posted_by is not null) or status <> 'posted')
);

create table if not exists inventory_lots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  item_id text,
  lot_code text not null check (length(btrim(lot_code)) > 0),
  internal_lot_number text,
  source_inventory_transaction_id uuid references inventory_transactions(id) on delete restrict,
  received_date date,
  production_date date,
  sell_by_date date,
  expiration_date date,
  status text not null default 'active' check (status in ('active', 'closed', 'quarantined', 'voided')),
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  closed_at timestamptz,
  unique (organization_id, item_id, lot_code)
);

create table if not exists inventory_transaction_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  transaction_id uuid not null references inventory_transactions(id) on delete restrict,
  item_id text not null,
  inventory_lot_id uuid references inventory_lots(id) on delete restrict,
  quantity numeric not null,
  quantity_uom text,
  net_weight numeric,
  weight_uom text,
  unit_cost numeric,
  cost_uom text,
  freight numeric not null default 0,
  charge numeric not null default 0,
  reason text,
  return_flag boolean not null default false,
  source_order_line_id uuid references order_lines(id) on delete restrict,
  source_po_line_id uuid references sps_staged_order_lines(id) on delete restrict,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

alter table inventory_transactions enable row level security;
alter table inventory_lots enable row level security;
alter table inventory_transaction_lines enable row level security;
create policy "trace inventory transactions same org" on inventory_transactions for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "trace inventory lots same org" on inventory_lots for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "trace inventory transaction lines same org" on inventory_transaction_lines for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());

-- Production genealogy separates consumed inventory lots from finished production output lots.
create table if not exists production_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  order_id uuid references orders(id) on delete restrict,
  production_reference text,
  output_item_id text,
  output_production_lot_id uuid references production_lots(id) on delete restrict,
  output_inventory_lot_id uuid references inventory_lots(id) on delete restrict,
  status text not null default 'planned' check (status in ('planned', 'in_progress', 'completed', 'voided')),
  started_at timestamptz,
  started_by uuid references profiles(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references profiles(id) on delete set null,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  check ((status = 'completed' and completed_at is not null and completed_by is not null) or status <> 'completed')
);

create table if not exists production_run_consumptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  production_run_id uuid not null references production_runs(id) on delete restrict,
  source_inventory_lot_id uuid not null references inventory_lots(id) on delete restrict,
  item_id text not null,
  quantity numeric not null,
  quantity_uom text,
  net_weight numeric,
  weight_uom text,
  reversal_of_consumption_id uuid references production_run_consumptions(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references profiles(id) on delete set null,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

create table if not exists production_run_outputs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  production_run_id uuid not null references production_runs(id) on delete restrict,
  output_production_lot_id uuid references production_lots(id) on delete restrict,
  output_inventory_lot_id uuid references inventory_lots(id) on delete restrict,
  item_id text not null,
  produced_quantity numeric not null,
  quantity_uom text,
  produced_weight numeric,
  weight_uom text,
  reversal_of_output_id uuid references production_run_outputs(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references profiles(id) on delete set null,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null
);

alter table production_runs enable row level security;
alter table production_run_consumptions enable row level security;
alter table production_run_outputs enable row level security;
create policy "trace production runs same org" on production_runs for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "trace production consumptions same org" on production_run_consumptions for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "trace production outputs same org" on production_run_outputs for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());

alter table production_cases
  add column if not exists production_run_id uuid references production_runs(id) on delete restrict,
  add column if not exists output_inventory_lot_id uuid references inventory_lots(id) on delete restrict;

-- Shipment is a foundation only. Contents retain their own active/removed history and may
-- reference either an actual finished case or a completed pallet.
create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  order_id uuid references orders(id) on delete restrict,
  customer_id uuid references customers(id) on delete restrict,
  ship_to_id uuid references customer_ship_tos(id) on delete restrict,
  bol_reference text,
  status text not null default 'planned' check (status in ('planned', 'building', 'completed', 'voided')),
  shipped_at timestamptz,
  completed_by uuid references profiles(id) on delete set null,
  invoice_number text,
  external_accounting_id text,
  invoice_status text,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists shipment_contents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  shipment_id uuid not null references shipments(id) on delete restrict,
  production_case_id uuid references production_cases(id) on delete restrict,
  pallet_id uuid references pallets(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'removed')),
  added_at timestamptz not null default now(),
  added_by uuid references profiles(id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references profiles(id) on delete set null,
  removal_reason text,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_at timestamptz not null default now(),
  check (((production_case_id is not null)::integer + (pallet_id is not null)::integer) = 1),
  check ((status = 'removed' and removed_at is not null) or status = 'active')
);

alter table shipments enable row level security;
alter table shipment_contents enable row level security;
create policy "trace shipments same org" on shipments for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "trace shipment contents same org" on shipment_contents for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());

-- Pick allocation is separate from pallet membership and has its own durable removal history.
create table if not exists case_pick_allocations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  order_id uuid not null references orders(id) on delete restrict,
  order_line_id uuid not null references order_lines(id) on delete restrict,
  production_case_id uuid not null references production_cases(id) on delete restrict,
  shipment_id uuid references shipments(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'removed')),
  allocated_at timestamptz not null default now(),
  allocated_by uuid references profiles(id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references profiles(id) on delete set null,
  removal_reason text,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_at timestamptz not null default now(),
  check ((status = 'removed' and removed_at is not null) or status = 'active')
);

alter table case_pick_allocations enable row level security;
create policy "trace case pick allocations same org" on case_pick_allocations for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());

-- Existing pallet_cases remains the live pallet workspace join. This append-only companion
-- retains the full case-to-pallet assignment history when a case is later removed or corrected.
create table if not exists pallet_case_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  pallet_id uuid not null references pallets(id) on delete restrict,
  production_case_id uuid not null references production_cases(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'removed')),
  assigned_at timestamptz not null default now(),
  assigned_by uuid references profiles(id) on delete set null,
  removed_at timestamptz,
  removed_by uuid references profiles(id) on delete set null,
  removal_reason text,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_at timestamptz not null default now(),
  check ((status = 'removed' and removed_at is not null) or status = 'active')
);

alter table pallet_case_assignments enable row level security;
create policy "trace pallet case assignments same org" on pallet_case_assignments for all
  using (organization_id = current_org_id()) with check (organization_id = current_org_id());

create unique index if not exists case_pick_allocations_one_active_case_idx
  on case_pick_allocations (production_case_id) where status = 'active';
create unique index if not exists pallet_case_assignments_one_active_case_idx
  on pallet_case_assignments (production_case_id) where status = 'active';
create unique index if not exists shipment_contents_one_active_case_idx
  on shipment_contents (production_case_id) where status = 'active' and production_case_id is not null;
create unique index if not exists shipment_contents_one_active_pallet_idx
  on shipment_contents (pallet_id) where status = 'active' and pallet_id is not null;

-- Cross-organization and relationship checks are database-enforced for all new links.
create or replace function validate_lucid_traceability_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  payload jsonb := to_jsonb(new);
  target_organization_id uuid := (to_jsonb(new) ->> 'organization_id')::uuid;
  target_record_id uuid := (to_jsonb(new) ->> 'id')::uuid;
  related_organization_id uuid;
  related_order_id uuid;
  related_order_line_id uuid;
  related_run_id uuid;
  shipment_order_id uuid;
begin
  if payload ->> 'import_batch_id' is not null then
    select organization_id into related_organization_id
      from integration_import_batches where id = (payload ->> 'import_batch_id')::uuid;
    if related_organization_id is distinct from target_organization_id then
      raise exception 'The import batch must belong to the same organization.';
    end if;
  end if;

  if tg_table_name = 'customer_ship_tos' then
    select organization_id into related_organization_id from customers where id = (payload ->> 'customer_id')::uuid;
    if related_organization_id is distinct from target_organization_id then
      raise exception 'The ship-to customer must belong to the same organization.';
    end if;
  elsif tg_table_name = 'orders' then
    if payload ->> 'customer_id' is not null then
      select organization_id into related_organization_id from customers where id = (payload ->> 'customer_id')::uuid;
      if related_organization_id is distinct from target_organization_id then
        raise exception 'The order customer must belong to the same organization.';
      end if;
    end if;
    if payload ->> 'ship_to_id' is not null then
      select organization_id into related_organization_id from customer_ship_tos where id = (payload ->> 'ship_to_id')::uuid;
      if related_organization_id is distinct from target_organization_id then
        raise exception 'The order ship-to must belong to the same organization.';
      end if;
      if payload ->> 'customer_id' is not null and not exists (
        select 1 from customer_ship_tos
          where id = (payload ->> 'ship_to_id')::uuid and customer_id = (payload ->> 'customer_id')::uuid
      ) then
        raise exception 'The order ship-to must belong to the selected customer.';
      end if;
    end if;
  elsif tg_table_name = 'inventory_lots' and payload ->> 'source_inventory_transaction_id' is not null then
    select organization_id into related_organization_id from inventory_transactions where id = (payload ->> 'source_inventory_transaction_id')::uuid;
    if related_organization_id is distinct from target_organization_id then
      raise exception 'The source inventory transaction must belong to the same organization.';
    end if;
  elsif tg_table_name = 'inventory_transaction_lines' then
    select organization_id into related_organization_id from inventory_transactions where id = (payload ->> 'transaction_id')::uuid;
    if related_organization_id is distinct from target_organization_id then
      raise exception 'The inventory transaction line must belong to its transaction organization.';
    end if;
    if payload ->> 'inventory_lot_id' is not null then
      select organization_id into related_organization_id from inventory_lots where id = (payload ->> 'inventory_lot_id')::uuid;
      if related_organization_id is distinct from target_organization_id then
        raise exception 'The inventory lot must belong to the same organization.';
      end if;
    end if;
    if payload ->> 'source_order_line_id' is not null then
      select order_row.organization_id into related_organization_id
        from order_lines as line_row join orders as order_row on order_row.id = line_row.order_id
        where line_row.id = (payload ->> 'source_order_line_id')::uuid;
      if related_organization_id is distinct from target_organization_id then
        raise exception 'The source order line must belong to the same organization.';
      end if;
    end if;
    if payload ->> 'source_po_line_id' is not null then
      select organization_id into related_organization_id from sps_staged_order_lines where id = (payload ->> 'source_po_line_id')::uuid;
      if related_organization_id is distinct from target_organization_id then
        raise exception 'The source PO line must belong to the same organization.';
      end if;
    end if;
  elsif tg_table_name = 'production_runs' then
    if payload ->> 'order_id' is not null then
      select organization_id into related_organization_id from orders where id = (payload ->> 'order_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The production order must belong to the same organization.'; end if;
    end if;
    if payload ->> 'output_production_lot_id' is not null then
      select organization_id, order_id into related_organization_id, related_order_id from production_lots where id = (payload ->> 'output_production_lot_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The output production lot must belong to the same organization.'; end if;
      if payload ->> 'order_id' is not null and related_order_id is distinct from (payload ->> 'order_id')::uuid then
        raise exception 'The output production lot must belong to the production order.';
      end if;
    end if;
    if payload ->> 'output_inventory_lot_id' is not null then
      select organization_id into related_organization_id from inventory_lots where id = (payload ->> 'output_inventory_lot_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The output inventory lot must belong to the same organization.'; end if;
    end if;
  elsif tg_table_name = 'production_run_consumptions' then
    select organization_id into related_organization_id from production_runs where id = (payload ->> 'production_run_id')::uuid;
    if related_organization_id is distinct from target_organization_id then raise exception 'The production run must belong to the same organization.'; end if;
    select organization_id into related_organization_id from inventory_lots where id = (payload ->> 'source_inventory_lot_id')::uuid;
    if related_organization_id is distinct from target_organization_id then raise exception 'The consumed inventory lot must belong to the same organization.'; end if;
    if payload ->> 'reversal_of_consumption_id' is not null then
      select production_run_id, organization_id into related_run_id, related_organization_id
        from production_run_consumptions where id = (payload ->> 'reversal_of_consumption_id')::uuid;
      if related_run_id is distinct from (payload ->> 'production_run_id')::uuid
        or related_organization_id is distinct from target_organization_id then
        raise exception 'A consumption reversal must reference the same production run and organization.';
      end if;
    end if;
  elsif tg_table_name = 'production_run_outputs' then
    select organization_id into related_organization_id from production_runs where id = (payload ->> 'production_run_id')::uuid;
    if related_organization_id is distinct from target_organization_id then raise exception 'The production run must belong to the same organization.'; end if;
    if payload ->> 'output_production_lot_id' is not null then
      select organization_id into related_organization_id from production_lots where id = (payload ->> 'output_production_lot_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The output production lot must belong to the same organization.'; end if;
    end if;
    if payload ->> 'output_inventory_lot_id' is not null then
      select organization_id into related_organization_id from inventory_lots where id = (payload ->> 'output_inventory_lot_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The output inventory lot must belong to the same organization.'; end if;
    end if;
    if payload ->> 'reversal_of_output_id' is not null then
      select production_run_id, organization_id into related_run_id, related_organization_id
        from production_run_outputs where id = (payload ->> 'reversal_of_output_id')::uuid;
      if related_run_id is distinct from (payload ->> 'production_run_id')::uuid
        or related_organization_id is distinct from target_organization_id then
        raise exception 'An output reversal must reference the same production run and organization.';
      end if;
    end if;
  elsif tg_table_name = 'production_cases' then
    if payload ->> 'production_run_id' is not null then
      select organization_id into related_organization_id from production_runs where id = (payload ->> 'production_run_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The production run must belong to the same organization.'; end if;
    end if;
    if payload ->> 'output_inventory_lot_id' is not null then
      select organization_id into related_organization_id from inventory_lots where id = (payload ->> 'output_inventory_lot_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The output inventory lot must belong to the same organization.'; end if;
    end if;
  elsif tg_table_name = 'shipments' then
    if payload ->> 'order_id' is not null then
      select organization_id into related_organization_id from orders where id = (payload ->> 'order_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The shipment order must belong to the same organization.'; end if;
    end if;
    if payload ->> 'customer_id' is not null then
      select organization_id into related_organization_id from customers where id = (payload ->> 'customer_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The shipment customer must belong to the same organization.'; end if;
    end if;
    if payload ->> 'ship_to_id' is not null then
      select organization_id into related_organization_id from customer_ship_tos where id = (payload ->> 'ship_to_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The shipment ship-to must belong to the same organization.'; end if;
      if payload ->> 'customer_id' is not null and not exists (
        select 1 from customer_ship_tos
          where id = (payload ->> 'ship_to_id')::uuid and customer_id = (payload ->> 'customer_id')::uuid
      ) then
        raise exception 'The shipment ship-to must belong to the selected customer.';
      end if;
    end if;
  elsif tg_table_name = 'shipment_contents' then
    select organization_id, order_id into related_organization_id, shipment_order_id from shipments where id = (payload ->> 'shipment_id')::uuid;
    if related_organization_id is distinct from target_organization_id then raise exception 'Shipment contents must belong to the shipment organization.'; end if;
    if payload ->> 'production_case_id' is not null then
      select organization_id, order_id into related_organization_id, related_order_id from production_cases where id = (payload ->> 'production_case_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The production case must belong to the same organization.'; end if;
      if shipment_order_id is not null and related_order_id is distinct from shipment_order_id then
        raise exception 'The production case must belong to the shipment order.';
      end if;
      if exists (
        select 1
          from pallet_case_assignments as assignment_row
          join shipment_contents as pallet_content
            on pallet_content.pallet_id = assignment_row.pallet_id
           and pallet_content.status = 'active'
         where assignment_row.production_case_id = (payload ->> 'production_case_id')::uuid
           and assignment_row.status = 'active'
           and pallet_content.id <> target_record_id
      ) then
        raise exception 'This case is already represented by an active pallet shipment.';
      end if;
    end if;
    if payload ->> 'pallet_id' is not null then
      select organization_id, order_id into related_organization_id, related_order_id from pallets where id = (payload ->> 'pallet_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The pallet must belong to the same organization.'; end if;
      if shipment_order_id is not null and related_order_id is distinct from shipment_order_id then
        raise exception 'The pallet must belong to the shipment order.';
      end if;
      if exists (
        select 1
          from pallet_case_assignments as assignment_row
          join shipment_contents as case_content
            on case_content.production_case_id = assignment_row.production_case_id
           and case_content.status = 'active'
         where assignment_row.pallet_id = (payload ->> 'pallet_id')::uuid
           and assignment_row.status = 'active'
           and case_content.id <> target_record_id
      ) then
        raise exception 'A case on this pallet is already represented by an active shipment.';
      end if;
    end if;
  elsif tg_table_name = 'case_pick_allocations' then
    select organization_id into related_organization_id from orders where id = (payload ->> 'order_id')::uuid;
    if related_organization_id is distinct from target_organization_id then raise exception 'The allocation order must belong to the same organization.'; end if;
    select line_order.id, line_order.organization_id into related_order_id, related_organization_id
      from order_lines as line_row join orders as line_order on line_order.id = line_row.order_id
      where line_row.id = (payload ->> 'order_line_id')::uuid;
    if related_order_id is distinct from (payload ->> 'order_id')::uuid or related_organization_id is distinct from target_organization_id then
      raise exception 'The allocated order line must belong to the selected order and organization.';
    end if;
    select order_id, order_line_id, organization_id into related_order_id, related_order_line_id, related_organization_id
      from production_cases where id = (payload ->> 'production_case_id')::uuid;
    if related_order_id is distinct from (payload ->> 'order_id')::uuid
      or related_order_line_id is distinct from (payload ->> 'order_line_id')::uuid
      or related_organization_id is distinct from target_organization_id then
      raise exception 'The production case must belong to the selected order item and organization.';
    end if;
    if payload ->> 'shipment_id' is not null then
      select organization_id into related_organization_id from shipments where id = (payload ->> 'shipment_id')::uuid;
      if related_organization_id is distinct from target_organization_id then raise exception 'The shipment must belong to the same organization.'; end if;
    end if;
  elsif tg_table_name = 'pallet_case_assignments' then
    select organization_id, order_id into related_organization_id, related_order_id from pallets where id = (payload ->> 'pallet_id')::uuid;
    if related_organization_id is distinct from target_organization_id then
      raise exception 'The pallet assignment must belong to the pallet organization.';
    end if;
    select organization_id, order_id into related_organization_id, shipment_order_id from production_cases where id = (payload ->> 'production_case_id')::uuid;
    if related_organization_id is distinct from target_organization_id or shipment_order_id is distinct from related_order_id then
      raise exception 'The production case must belong to the selected pallet order and organization.';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_trace_ship_to_scope before insert or update on customer_ship_tos
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_order_scope before insert or update of organization_id, customer_id, ship_to_id, import_batch_id on orders
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_inventory_lot_scope before insert or update on inventory_lots
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_inventory_line_scope before insert or update on inventory_transaction_lines
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_production_run_scope before insert or update on production_runs
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_production_consumption_scope before insert or update on production_run_consumptions
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_production_output_scope before insert or update on production_run_outputs
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_case_scope before insert or update of organization_id, production_run_id, output_inventory_lot_id on production_cases
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_shipment_scope before insert or update on shipments
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_shipment_contents_scope before insert or update on shipment_contents
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_pick_allocation_scope before insert or update on case_pick_allocations
  for each row execute function validate_lucid_traceability_scope();
create trigger validate_trace_pallet_assignment_scope before insert or update on pallet_case_assignments
  for each row execute function validate_lucid_traceability_scope();

-- Every actor and import-batch reference is tenant-checked; profile FKs alone do not
-- guarantee this because a UUID from another organization could otherwise be supplied.
create or replace function validate_lucid_traceability_actor_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor_key text;
  actor_text text;
  target_actor_id uuid;
  related_organization_id uuid;
  batch_text text;
begin
  batch_text := to_jsonb(new) ->> 'import_batch_id';
  if batch_text is not null then
    select organization_id into related_organization_id
      from integration_import_batches where id = batch_text::uuid;
    if related_organization_id is distinct from new.organization_id then
      raise exception 'The import batch must belong to the same organization.';
    end if;
  end if;

  foreach actor_key in array array[
    'created_by', 'posted_by', 'started_by', 'completed_by', 'recorded_by',
    'added_by', 'removed_by', 'allocated_by', 'assigned_by', 'produced_by',
    'voided_by', 'original_completed_by', 'reopened_by'
  ] loop
    actor_text := to_jsonb(new) ->> actor_key;
    if actor_text is not null then
      target_actor_id := actor_text::uuid;
      select organization_id into related_organization_id from profiles where id = target_actor_id;
      if related_organization_id is distinct from new.organization_id then
        raise exception 'The recorded actor must belong to the same organization.';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create or replace function validate_lucid_order_line_traceability_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  line_organization_id uuid;
  batch_organization_id uuid;
begin
  select organization_id into line_organization_id from orders where id = new.order_id;
  if line_organization_id is null then
    raise exception 'The order line must belong to an existing order.';
  end if;
  if new.import_batch_id is not null then
    select organization_id into batch_organization_id from integration_import_batches where id = new.import_batch_id;
    if batch_organization_id is distinct from line_organization_id then
      raise exception 'The import batch must belong to the order organization.';
    end if;
  end if;
  return new;
end;
$$;

create trigger validate_trace_import_batch_scope before insert or update on integration_import_batches
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_customer_actor_scope before insert or update on customers
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_ship_to_actor_scope before insert or update on customer_ship_tos
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_order_actor_scope before insert or update on orders
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_order_line_scope before insert or update of order_id, import_batch_id on order_lines
  for each row execute function validate_lucid_order_line_traceability_scope();
create trigger validate_trace_production_lot_actor_scope before insert or update on production_lots
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_production_case_actor_scope before insert or update on production_cases
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_pallet_actor_scope before insert or update on pallets
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_inventory_transaction_actor_scope before insert or update on inventory_transactions
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_inventory_lot_actor_scope before insert or update on inventory_lots
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_inventory_line_actor_scope before insert or update on inventory_transaction_lines
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_production_run_actor_scope before insert or update on production_runs
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_consumption_actor_scope before insert or update on production_run_consumptions
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_output_actor_scope before insert or update on production_run_outputs
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_shipment_actor_scope before insert or update on shipments
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_shipment_content_actor_scope before insert or update on shipment_contents
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_pick_allocation_actor_scope before insert or update on case_pick_allocations
  for each row execute function validate_lucid_traceability_actor_scope();
create trigger validate_trace_pallet_assignment_actor_scope before insert or update on pallet_case_assignments
  for each row execute function validate_lucid_traceability_actor_scope();

-- Inventory history is immutable once posted. Allocation and shipment-content corrections
-- retain their row and change it from active to removed.
create or replace function protect_posted_inventory_history()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_table_name = 'inventory_transactions' then
    if tg_op = 'DELETE' then
      raise exception 'Inventory transaction history cannot be deleted.';
    end if;
    if old.status in ('posted', 'voided', 'reversed') then
      raise exception 'Posted inventory transaction history cannot be modified; create a reversal transaction instead.';
    end if;
  elsif tg_table_name = 'inventory_transaction_lines' then
    if tg_op = 'INSERT' then
      if exists (
        select 1 from inventory_transactions
          where id = new.transaction_id and status <> 'draft'
      ) then
        raise exception 'Lines cannot be added to a posted inventory transaction.';
      end if;
      return new;
    end if;
    if tg_op = 'DELETE' then
      raise exception 'Inventory transaction lines cannot be deleted.';
    end if;
    if exists (select 1 from inventory_transactions where id = old.transaction_id and status <> 'draft') then
      raise exception 'Lines on a posted inventory transaction cannot be modified.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function protect_lucid_production_genealogy_history()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  new_payload jsonb;
  old_payload jsonb;
  run_status text;
  target_run_id uuid;
begin
  if tg_op = 'INSERT' then
    new_payload := to_jsonb(new);
    target_run_id := (new_payload ->> 'production_run_id')::uuid;
  elsif tg_op = 'DELETE' then
    old_payload := to_jsonb(old);
    target_run_id := (old_payload ->> 'production_run_id')::uuid;
  else
    new_payload := to_jsonb(new);
    target_run_id := (new_payload ->> 'production_run_id')::uuid;
  end if;
  select status into run_status from production_runs where id = target_run_id;
  if tg_op = 'INSERT' and run_status in ('completed', 'voided') then
    if tg_table_name = 'production_run_consumptions' then
      if new_payload ->> 'reversal_of_consumption_id' is null or not exists (
        select 1 from production_run_consumptions
          where id = (new_payload ->> 'reversal_of_consumption_id')::uuid
            and production_run_id = (new_payload ->> 'production_run_id')::uuid
      ) then
        raise exception 'A completed production run accepts only a reversal of an existing consumption.';
      end if;
    elsif tg_table_name = 'production_run_outputs' then
      if new_payload ->> 'reversal_of_output_id' is null or not exists (
        select 1 from production_run_outputs
          where id = (new_payload ->> 'reversal_of_output_id')::uuid
            and production_run_id = (new_payload ->> 'production_run_id')::uuid
      ) then
        raise exception 'A completed production run accepts only a reversal of an existing output.';
      end if;
    end if;
    return new;
  end if;
  if run_status in ('completed', 'voided') then
    raise exception 'Committed production genealogy cannot be modified; record a reversal or correction instead.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function protect_lucid_production_run_history()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Production runs cannot be deleted; void or correct the run instead.';
  end if;
  if old.status in ('completed', 'voided') then
    raise exception 'Completed production runs cannot be modified; record a correction instead.';
  end if;
  return new;
end;
$$;

create or replace function prevent_lucid_traceability_record_delete()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  raise exception 'Traceability records cannot be deleted; close, void, or supersede the record instead.';
end;
$$;

create or replace function protect_lucid_allocation_history()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Traceability allocations cannot be deleted; mark them removed with a reason.';
  end if;
  if old.status = 'removed' then
    raise exception 'A removed traceability allocation cannot be modified.';
  end if;
  if old.status = 'active' and new.status <> 'removed' then
    raise exception 'An allocation correction must change the status to removed.';
  end if;
  return new;
end;
$$;

create trigger prevent_inventory_transaction_delete before delete on inventory_transactions
  for each row execute function protect_posted_inventory_history();
create trigger protect_posted_inventory_transaction before update on inventory_transactions
  for each row execute function protect_posted_inventory_history();
create trigger prevent_inventory_line_delete before delete on inventory_transaction_lines
  for each row execute function protect_posted_inventory_history();
create trigger prevent_inventory_line_insert_after_posting before insert on inventory_transaction_lines
  for each row execute function protect_posted_inventory_history();
create trigger protect_posted_inventory_line before update on inventory_transaction_lines
  for each row execute function protect_posted_inventory_history();
create trigger prevent_inventory_lot_delete before delete on inventory_lots
  for each row execute function prevent_lucid_traceability_record_delete();
create trigger prevent_production_run_delete before delete on production_runs
  for each row execute function protect_lucid_production_run_history();
create trigger protect_completed_production_run before update on production_runs
  for each row execute function protect_lucid_production_run_history();
create trigger protect_production_consumption_insert before insert on production_run_consumptions
  for each row execute function protect_lucid_production_genealogy_history();
create trigger prevent_production_consumption_delete before delete on production_run_consumptions
  for each row execute function protect_lucid_production_genealogy_history();
create trigger prevent_production_consumption_update before update on production_run_consumptions
  for each row execute function protect_lucid_production_genealogy_history();
create trigger protect_production_output_insert before insert on production_run_outputs
  for each row execute function protect_lucid_production_genealogy_history();
create trigger prevent_production_output_delete before delete on production_run_outputs
  for each row execute function protect_lucid_production_genealogy_history();
create trigger prevent_production_output_update before update on production_run_outputs
  for each row execute function protect_lucid_production_genealogy_history();
create trigger prevent_pick_allocation_delete before delete on case_pick_allocations
  for each row execute function protect_lucid_allocation_history();
create trigger protect_pick_allocation_history before update on case_pick_allocations
  for each row execute function protect_lucid_allocation_history();
create trigger prevent_pallet_assignment_delete before delete on pallet_case_assignments
  for each row execute function protect_lucid_allocation_history();
create trigger protect_pallet_assignment_history before update on pallet_case_assignments
  for each row execute function protect_lucid_allocation_history();
create trigger prevent_shipment_content_delete before delete on shipment_contents
  for each row execute function protect_lucid_allocation_history();
create trigger protect_shipment_content_history before update on shipment_contents
  for each row execute function protect_lucid_allocation_history();
create trigger prevent_shipment_delete before delete on shipments
  for each row execute function prevent_lucid_traceability_record_delete();

-- Keep the current pallet workspace API intact while preserving a durable assignment history.
-- The legacy pallet_cases row may still be removed by the existing correction RPC, but its
-- corresponding pallet_case_assignments row is retained and marked removed.
create or replace function sync_lucid_pallet_case_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  target_organization_id uuid;
begin
  if tg_op = 'INSERT' then
    if new.production_case_id is null then
      return new;
    end if;
    select organization_id into target_organization_id from pallets where id = new.pallet_id;
    insert into pallet_case_assignments (
      organization_id, pallet_id, production_case_id, assigned_by, source_system
    )
    select target_organization_id, new.pallet_id, new.production_case_id, auth.uid(), 'lucid_core'
    where not exists (
      select 1 from pallet_case_assignments
        where production_case_id = new.production_case_id and status = 'active'
    );
    return new;
  end if;

  if old.production_case_id is not null then
    update pallet_case_assignments as assignment_row
      set status = 'removed',
        removed_at = now(),
        removed_by = auth.uid(),
        removal_reason = coalesce(nullif(assignment_row.removal_reason, ''), 'Removed from pallet')
      where assignment_row.pallet_id = old.pallet_id
        and assignment_row.production_case_id = old.production_case_id
        and assignment_row.status = 'active';
  end if;
  return old;
end;
$$;

insert into pallet_case_assignments (
  organization_id, pallet_id, production_case_id, assigned_at, assigned_by, source_system, is_historical
)
select pallet_row.organization_id, pallet_case_row.pallet_id, pallet_case_row.production_case_id,
  pallet_case_row.scanned_at, null, 'lucid_core', false
from pallet_cases as pallet_case_row
join pallets as pallet_row on pallet_row.id = pallet_case_row.pallet_id
where pallet_case_row.production_case_id is not null
  and not exists (
    select 1 from pallet_case_assignments as existing_assignment
      where existing_assignment.production_case_id = pallet_case_row.production_case_id
        and existing_assignment.status = 'active'
  );

create trigger sync_trace_pallet_case_assignment_insert
  after insert on pallet_cases
  for each row execute function sync_lucid_pallet_case_assignment();
create trigger sync_trace_pallet_case_assignment_delete
  after delete on pallet_cases
  for each row execute function sync_lucid_pallet_case_assignment();

-- Directional lookup indexes for future Unified Trace / Recall queries.
create index if not exists customers_org_name_idx on customers (organization_id, name);
create index if not exists customers_source_idx on customers (organization_id, source_system, source_record_id);
create index if not exists customer_ship_tos_org_customer_idx on customer_ship_tos (organization_id, customer_id, name);
create index if not exists customer_ship_tos_source_idx on customer_ship_tos (organization_id, source_system, source_record_id);
create index if not exists orders_trace_source_idx on orders (organization_id, source_system, source_record_id);
create index if not exists orders_trace_customer_idx on orders (organization_id, customer_id, ship_to_id);
create index if not exists orders_trace_invoice_idx on orders (organization_id, invoice_number, external_accounting_id);
create index if not exists order_lines_trace_source_idx on order_lines (source_system, source_record_id);
create index if not exists inventory_transactions_trace_lookup_idx on inventory_transactions (organization_id, transaction_number, transaction_date desc);
create index if not exists inventory_transactions_source_idx on inventory_transactions (organization_id, source_system, source_record_id);
create index if not exists inventory_lots_trace_lookup_idx on inventory_lots (organization_id, item_id, lot_code);
create index if not exists inventory_lots_internal_number_idx on inventory_lots (organization_id, internal_lot_number)
  where internal_lot_number is not null;
create index if not exists inventory_lots_dates_idx on inventory_lots (organization_id, received_date, production_date, expiration_date);
create index if not exists inventory_transaction_lines_lot_idx on inventory_transaction_lines (organization_id, inventory_lot_id);
create index if not exists production_runs_order_idx on production_runs (organization_id, order_id, created_at desc);
create index if not exists production_runs_source_idx on production_runs (organization_id, source_system, source_record_id);
create index if not exists production_lots_trace_lot_idx on production_lots (organization_id, lot_code);
create index if not exists production_lots_source_idx on production_lots (organization_id, source_system, source_record_id);
create index if not exists production_run_consumptions_lot_idx on production_run_consumptions (organization_id, source_inventory_lot_id);
create index if not exists production_run_outputs_lot_idx on production_run_outputs (organization_id, output_production_lot_id, output_inventory_lot_id);
create index if not exists production_cases_trace_run_idx on production_cases (organization_id, production_run_id, output_inventory_lot_id);
create index if not exists production_cases_source_idx on production_cases (organization_id, source_system, source_record_id);
create index if not exists case_pick_allocations_order_idx on case_pick_allocations (organization_id, order_id, order_line_id, status);
create index if not exists pallet_case_assignments_pallet_idx on pallet_case_assignments (organization_id, pallet_id, status);
create index if not exists pallets_source_idx on pallets (organization_id, source_system, source_record_id);
create index if not exists shipments_order_idx on shipments (organization_id, order_id, status);
create index if not exists shipments_invoice_idx on shipments (organization_id, invoice_number, external_accounting_id);
create index if not exists shipments_source_idx on shipments (organization_id, source_system, source_record_id);
create index if not exists shipment_contents_shipment_idx on shipment_contents (organization_id, shipment_id, status);

commit;
