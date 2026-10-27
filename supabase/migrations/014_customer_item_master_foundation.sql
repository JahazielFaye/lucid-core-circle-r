-- Lucid-native Customer + Item Master foundation.
-- Additive only: legacy SPS mapping columns remain the compatibility boundary.
begin;

-- Customers and ship-tos were introduced by the traceability foundation as durable
-- references. Add operational fields without replacing the existing records.
alter table customers
  add column if not exists legal_name text,
  add column if not exists customer_group text,
  add column if not exists customer_type text,
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists country text,
  add column if not exists phone text,
  add column if not exists general_email text,
  add column if not exists default_warehouse_id text,
  add column if not exists payment_terms_reference text,
  add column if not exists po_required boolean not null default false,
  add column if not exists invoice_preferences text,
  add column if not exists order_guide_enabled boolean not null default false,
  add column if not exists order_guide_retention_days integer,
  add column if not exists delivery_preferences text,
  add column if not exists operational_notes text,
  add constraint customers_order_guide_retention_nonnegative
    check (order_guide_retention_days is null or order_guide_retention_days >= 0);

alter table customer_ship_tos
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists postal_code text,
  add column if not exists country text,
  add column if not exists contact_name text,
  add column if not exists phone text,
  add column if not exists delivery_instructions text,
  add column if not exists ship_via_preference text;

-- 013's original unconditional key was intentionally conservative while the table
-- was traceability-only. Master data needs historical/inactive duplicates, while
-- still preventing an active duplicate location for one customer.
alter table customer_ship_tos
  drop constraint if exists customer_ship_tos_organization_id_customer_id_location_code_key;

create table if not exists customer_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  contact_type text not null check (contact_type in ('office', 'accounting', 'sales', 'invoice', 'operations', 'other')),
  name text not null check (length(btrim(name)) > 0),
  email text,
  phone text,
  is_primary boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  notes text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  item_code text not null check (length(btrim(item_code)) > 0),
  description text not null check (length(btrim(description)) > 0),
  status text not null default 'active' check (status in ('active', 'inactive')),
  vendor_name text,
  vendor_item_code text,
  brand text,
  category text,
  manufacturer text,
  manufacturer_item_number text,
  catch_weight boolean not null default false,
  weight_only boolean not null default false,
  standard_weight numeric,
  standard_weight_uom text,
  case_conversion numeric,
  tare_weight numeric,
  tare_weight_uom text,
  container text,
  pack_size text,
  shelf_life_days integer,
  stock_uom text,
  sell_uom text,
  bill_uom text,
  default_warehouse_id text,
  max_cases_per_pallet integer,
  pick_label_required boolean not null default false,
  always_available boolean not null default false,
  cutoff_time time,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, item_code),
  check (standard_weight is null or standard_weight >= 0),
  check (case_conversion is null or case_conversion > 0),
  check (tare_weight is null or tare_weight >= 0),
  check (shelf_life_days is null or shelf_life_days >= 0),
  check (max_cases_per_pallet is null or max_cases_per_pallet > 0)
);

create table if not exists item_identifiers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  item_id uuid not null references items(id) on delete restrict,
  identifier_type text not null check (identifier_type in ('gtin', 'upc', 'vendor_item', 'manufacturer_item', 'customer_sku', 'other')),
  identifier_value text not null check (length(btrim(identifier_value)) > 0),
  uom text,
  is_primary boolean not null default false,
  verified boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  manufacturer text,
  manufacturer_item_number text,
  accepted_default_weight numeric,
  weight_uom text,
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (accepted_default_weight is null or accepted_default_weight >= 0)
);

create table if not exists customer_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  customer_id uuid not null references customers(id) on delete restrict,
  ship_to_id uuid references customer_ship_tos(id) on delete restrict,
  item_id uuid not null references items(id) on delete restrict,
  customer_sku text,
  customer_description text,
  customer_uom text,
  customer_identifier text,
  customer_identifier_type text check (customer_identifier_type in ('gtin', 'upc', 'sps', 'edi', 'other')),
  price_override numeric,
  price_uom text,
  effective_date date,
  expiration_date date,
  packaging_notes text,
  order_notes text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  source_system text not null default 'lucid_core' check (length(btrim(source_system)) > 0),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (expiration_date is null or effective_date is null or expiration_date >= effective_date)
);

-- Optional native references preserve the existing source-specific mapping records
-- while giving SPS resolution a durable Lucid destination when master data is ready.
alter table integration_customer_mappings
  add column if not exists customer_id uuid references customers(id) on delete restrict;
alter table integration_ship_to_mappings
  add column if not exists ship_to_id uuid references customer_ship_tos(id) on delete restrict;
alter table integration_item_mappings
  add column if not exists item_id uuid references items(id) on delete restrict,
  add column if not exists customer_item_id uuid references customer_items(id) on delete restrict;

create or replace function assert_lucid_master_data_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor profiles%rowtype;
  payload jsonb := to_jsonb(new);
begin
  select profile_row.* into actor from profiles as profile_row
    where profile_row.id = auth.uid() and profile_row.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('lucid_admin', 'leadership', 'office') then
    raise exception 'Your role cannot change master data.';
  end if;
  if (payload ->> 'organization_id')::uuid <> actor.organization_id then
    raise exception 'Master data must belong to your organization.';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, actor.id);
  end if;
  if tg_table_name in ('customers', 'customer_ship_tos', 'customer_contacts', 'items', 'item_identifiers', 'customer_items') then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function audit_lucid_master_data_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  organization uuid := coalesce((to_jsonb(new) ->> 'organization_id')::uuid, (to_jsonb(old) ->> 'organization_id')::uuid);
  record_id text := coalesce((to_jsonb(new) ->> 'id'), (to_jsonb(old) ->> 'id'));
  change_action text;
  new_payload jsonb := to_jsonb(new);
  old_payload jsonb := to_jsonb(old);
begin
  change_action := case
    when tg_op = 'INSERT' then 'created'
    when old_payload ->> 'status' = 'active' and new_payload ->> 'status' = 'inactive' then 'inactivated'
    when tg_op = 'UPDATE' then 'updated'
    else lower(tg_op)
  end;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (organization, auth.uid(), lower(tg_table_name) || ' ' || change_action, tg_table_name, record_id,
    jsonb_build_object('source', 'lucid_master_data'));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Native master IDs on the legacy SPS adapter must never cross an organization.
-- JSON payload access keeps this shared trigger safe across three different tables.
create or replace function validate_lucid_sps_master_mapping_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  payload jsonb := to_jsonb(new);
  related_org uuid;
begin
  if tg_table_name = 'integration_customer_mappings' and payload ->> 'customer_id' is not null then
    select organization_id into related_org from customers where id = (payload ->> 'customer_id')::uuid;
  elsif tg_table_name = 'integration_ship_to_mappings' and payload ->> 'ship_to_id' is not null then
    select organization_id into related_org from customer_ship_tos where id = (payload ->> 'ship_to_id')::uuid;
  elsif tg_table_name = 'integration_item_mappings' then
    if payload ->> 'item_id' is not null then
      select organization_id into related_org from items where id = (payload ->> 'item_id')::uuid;
      if related_org is distinct from (payload ->> 'organization_id')::uuid then raise exception 'SPS item mapping must reference an item in the same organization.'; end if;
    end if;
    if payload ->> 'customer_item_id' is not null then
      select organization_id into related_org from customer_items where id = (payload ->> 'customer_item_id')::uuid;
      if payload ->> 'item_id' is not null and not exists (
        select 1 from customer_items
        where id = (payload ->> 'customer_item_id')::uuid
          and item_id = (payload ->> 'item_id')::uuid
      ) then
        raise exception 'SPS customer item mapping must reference the selected Lucid item.';
      end if;
    else
      return new;
    end if;
  else
    return new;
  end if;
  if related_org is distinct from (payload ->> 'organization_id')::uuid then
    raise exception 'SPS mapping must reference master data in the same organization.';
  end if;
  return new;
end;
$$;

-- Database checks keep customer/ship-to and customer-item scope relationships valid.
create or replace function validate_lucid_master_data_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  payload jsonb := to_jsonb(new);
  related_org uuid;
begin
  if tg_table_name = 'customer_ship_tos' then
    select organization_id into related_org from customers where id = (payload ->> 'customer_id')::uuid;
    if related_org is distinct from (payload ->> 'organization_id')::uuid then raise exception 'Ship-to customer must belong to the same organization.'; end if;
  elsif tg_table_name = 'customer_contacts' then
    select organization_id into related_org from customers where id = (payload ->> 'customer_id')::uuid;
    if related_org is distinct from (payload ->> 'organization_id')::uuid then raise exception 'Contact customer must belong to the same organization.'; end if;
  elsif tg_table_name = 'item_identifiers' then
    select organization_id into related_org from items where id = (payload ->> 'item_id')::uuid;
    if related_org is distinct from (payload ->> 'organization_id')::uuid then raise exception 'Item identifier must belong to the same organization.'; end if;
  elsif tg_table_name = 'customer_items' then
    select organization_id into related_org from customers where id = (payload ->> 'customer_id')::uuid;
    if related_org is distinct from (payload ->> 'organization_id')::uuid then raise exception 'Customer item customer must belong to the same organization.'; end if;
    select organization_id into related_org from items where id = (payload ->> 'item_id')::uuid;
    if related_org is distinct from (payload ->> 'organization_id')::uuid then raise exception 'Customer item must belong to the same organization.'; end if;
    if payload ->> 'ship_to_id' is not null then
      if not exists (select 1 from customer_ship_tos where id = (payload ->> 'ship_to_id')::uuid and customer_id = (payload ->> 'customer_id')::uuid and organization_id = (payload ->> 'organization_id')::uuid) then
        raise exception 'Customer item ship-to must belong to the selected customer.';
      end if;
    end if;
  end if;
  return new;
end;
$$;

alter table customer_contacts enable row level security;
alter table items enable row level security;
alter table item_identifiers enable row level security;
alter table customer_items enable row level security;

-- Replace broad `for all` policies with select/insert/update only. There is
-- deliberately no DELETE policy: masters are inactivated rather than erased.
drop policy if exists "trace customers same org" on customers;
drop policy if exists "trace ship tos same org" on customer_ship_tos;
create policy "master customers select same org" on customers for select using (organization_id = current_org_id());
create policy "master customers insert same org" on customers for insert with check (organization_id = current_org_id());
create policy "master customers update same org" on customers for update using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "master ship tos select same org" on customer_ship_tos for select using (organization_id = current_org_id());
create policy "master ship tos insert same org" on customer_ship_tos for insert with check (organization_id = current_org_id());
create policy "master ship tos update same org" on customer_ship_tos for update using (organization_id = current_org_id()) with check (organization_id = current_org_id());

create policy "master contacts select same org" on customer_contacts for select using (organization_id = current_org_id());
create policy "master contacts insert same org" on customer_contacts for insert with check (organization_id = current_org_id());
create policy "master contacts update same org" on customer_contacts for update using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "master items select same org" on items for select using (organization_id = current_org_id());
create policy "master items insert same org" on items for insert with check (organization_id = current_org_id());
create policy "master items update same org" on items for update using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "master item identifiers select same org" on item_identifiers for select using (organization_id = current_org_id());
create policy "master item identifiers insert same org" on item_identifiers for insert with check (organization_id = current_org_id());
create policy "master item identifiers update same org" on item_identifiers for update using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "master customer items select same org" on customer_items for select using (organization_id = current_org_id());
create policy "master customer items insert same org" on customer_items for insert with check (organization_id = current_org_id());
create policy "master customer items update same org" on customer_items for update using (organization_id = current_org_id()) with check (organization_id = current_org_id());

-- Role gates in the write trigger apply to every INSERT/UPDATE after RLS has
-- already enforced organization scope.
create trigger customers_master_write before insert or update on customers for each row execute function assert_lucid_master_data_write();
create trigger customer_ship_tos_master_write before insert or update on customer_ship_tos for each row execute function assert_lucid_master_data_write();
create trigger customer_contacts_master_write before insert or update on customer_contacts for each row execute function assert_lucid_master_data_write();
create trigger items_master_write before insert or update on items for each row execute function assert_lucid_master_data_write();
create trigger item_identifiers_master_write before insert or update on item_identifiers for each row execute function assert_lucid_master_data_write();
create trigger customer_items_master_write before insert or update on customer_items for each row execute function assert_lucid_master_data_write();

create trigger customer_ship_tos_master_scope before insert or update on customer_ship_tos for each row execute function validate_lucid_master_data_scope();
create trigger customer_contacts_master_scope before insert or update on customer_contacts for each row execute function validate_lucid_master_data_scope();
create trigger item_identifiers_master_scope before insert or update on item_identifiers for each row execute function validate_lucid_master_data_scope();
create trigger customer_items_master_scope before insert or update on customer_items for each row execute function validate_lucid_master_data_scope();
create trigger integration_customer_mappings_master_scope before insert or update of organization_id, customer_id on integration_customer_mappings for each row execute function validate_lucid_sps_master_mapping_scope();
create trigger integration_ship_to_mappings_master_scope before insert or update of organization_id, ship_to_id on integration_ship_to_mappings for each row execute function validate_lucid_sps_master_mapping_scope();
create trigger integration_item_mappings_master_scope before insert or update of organization_id, item_id, customer_item_id on integration_item_mappings for each row execute function validate_lucid_sps_master_mapping_scope();

create trigger customers_master_audit after insert or update on customers for each row execute function audit_lucid_master_data_change();
create trigger customer_ship_tos_master_audit after insert or update on customer_ship_tos for each row execute function audit_lucid_master_data_change();
create trigger customer_contacts_master_audit after insert or update on customer_contacts for each row execute function audit_lucid_master_data_change();
create trigger items_master_audit after insert or update on items for each row execute function audit_lucid_master_data_change();
create trigger item_identifiers_master_audit after insert or update on item_identifiers for each row execute function audit_lucid_master_data_change();
create trigger customer_items_master_audit after insert or update on customer_items for each row execute function audit_lucid_master_data_change();

create unique index if not exists customer_contacts_primary_type_idx on customer_contacts (customer_id, contact_type) where is_primary and status = 'active';
create unique index if not exists item_identifiers_primary_type_idx on item_identifiers (item_id, identifier_type) where is_primary and status = 'active';
create unique index if not exists customers_source_record_unique_idx on customers (organization_id, source_system, source_record_id) where source_record_id is not null;
create unique index if not exists customer_ship_tos_active_location_unique_idx on customer_ship_tos (organization_id, customer_id, location_code) where status = 'active' and location_code is not null;
create unique index if not exists customer_ship_tos_source_record_unique_idx on customer_ship_tos (organization_id, source_system, source_record_id) where source_record_id is not null;
create unique index if not exists items_source_record_unique_idx on items (organization_id, source_system, source_record_id) where source_record_id is not null;
create unique index if not exists item_identifiers_active_value_uom_unique_idx on item_identifiers (organization_id, identifier_type, identifier_value, coalesce(uom, '')) where status = 'active';
create unique index if not exists customer_items_active_customer_sku_unique_idx on customer_items (organization_id, customer_id, coalesce(ship_to_id, '00000000-0000-0000-0000-000000000000'::uuid), customer_sku) where status = 'active' and customer_sku is not null;
create unique index if not exists customer_items_active_external_identifier_unique_idx on customer_items (organization_id, customer_id, coalesce(ship_to_id, '00000000-0000-0000-0000-000000000000'::uuid), customer_identifier_type, customer_identifier) where status = 'active' and customer_identifier is not null;
create unique index if not exists customer_items_source_record_unique_idx on customer_items (organization_id, source_system, source_record_id) where source_record_id is not null;
create index if not exists customers_master_lookup_idx on customers (organization_id, status, name);
create index if not exists items_master_lookup_idx on items (organization_id, status, item_code, description);
create index if not exists item_identifiers_lookup_idx on item_identifiers (organization_id, identifier_value);
create index if not exists customer_items_lookup_idx on customer_items (organization_id, customer_id, item_id, status);
create index if not exists integration_customer_mappings_customer_idx on integration_customer_mappings (organization_id, customer_id) where customer_id is not null;
create index if not exists integration_ship_to_mappings_ship_to_idx on integration_ship_to_mappings (organization_id, ship_to_id) where ship_to_id is not null;
create index if not exists integration_item_mappings_item_idx on integration_item_mappings (organization_id, item_id) where item_id is not null;

commit;
