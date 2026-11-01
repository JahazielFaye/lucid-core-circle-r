-- Food Connex current operational master-data foundation.
-- Additive only: historical imports and existing Lucid-native records remain valid.
begin;

-- These attributes are operational references, not accounting balances.  Existing
-- free-text vendor fields remain as legacy fallbacks until a native vendor is linked.
alter table customers
  add column if not exists chain_name text,
  add column if not exists salesperson_name text,
  add column if not exists broker_name text;

alter table customer_ship_tos
  add column if not exists email text,
  add column if not exists delivery_preferences text;

-- Contacts were native in 014 but did not yet carry import provenance.  Adding
-- it here allows a Food Connex contact export to reconcile without ever being
-- confused with a manually maintained Circle R contact.
alter table customer_contacts
  add column if not exists source_system text not null default 'lucid_core' check (source_system in ('lucid_core', 'lucid_qa', 'food_connex')),
  add column if not exists source_record_id text,
  add column if not exists import_batch_id uuid references integration_import_batches(id) on delete restrict,
  add column if not exists is_historical boolean not null default false;

create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  warehouse_code text not null check (length(btrim(warehouse_code)) > 0),
  name text not null check (length(btrim(name)) > 0),
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  source_system text not null default 'lucid_core' check (source_system in ('lucid_core', 'lucid_qa', 'food_connex')),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists vendors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  vendor_code text not null check (length(btrim(vendor_code)) > 0),
  name text not null check (length(btrim(name)) > 0),
  address_line_1 text,
  address_line_2 text,
  city text,
  state text,
  postal_code text,
  country text,
  phone text,
  email text,
  contact_name text,
  payment_terms_reference text,
  purchasing_comments text,
  pickup_instructions text,
  default_shipping_information text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  source_system text not null default 'lucid_core' check (source_system in ('lucid_core', 'lucid_qa', 'food_connex')),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table items
  add column if not exists vendor_id uuid references vendors(id) on delete restrict,
  add column if not exists availability_status text,
  add column if not exists reorder_point numeric,
  add column if not exists reorder_quantity numeric,
  add column if not exists label_notes text;

create table if not exists vendor_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete restrict,
  vendor_id uuid not null references vendors(id) on delete restrict,
  item_id uuid not null references items(id) on delete restrict,
  vendor_item_code text not null check (length(btrim(vendor_item_code)) > 0),
  vendor_description text,
  vendor_uom text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  source_system text not null default 'lucid_core' check (source_system in ('lucid_core', 'lucid_qa', 'food_connex')),
  source_record_id text,
  import_batch_id uuid references integration_import_batches(id) on delete restrict,
  is_historical boolean not null default false,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Keep organization checks in JSON form so the shared function never reads a
-- NEW field that does not exist on another trigger table.
create or replace function validate_lucid_extended_master_data_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  payload jsonb := to_jsonb(new);
  related_org uuid;
begin
  if tg_table_name = 'items' and payload ->> 'vendor_id' is not null then
    select v.organization_id into related_org from vendors as v where v.id = (payload ->> 'vendor_id')::uuid;
    if related_org is distinct from (payload ->> 'organization_id')::uuid then
      raise exception 'Item vendor must belong to the same organization.';
    end if;
  elsif tg_table_name = 'vendor_items' then
    select v.organization_id into related_org from vendors as v where v.id = (payload ->> 'vendor_id')::uuid;
    if related_org is distinct from (payload ->> 'organization_id')::uuid then
      raise exception 'Vendor item vendor must belong to the same organization.';
    end if;
    select i.organization_id into related_org from items as i where i.id = (payload ->> 'item_id')::uuid;
    if related_org is distinct from (payload ->> 'organization_id')::uuid then
      raise exception 'Vendor item must belong to the same organization.';
    end if;
  end if;
  return new;
end;
$$;

-- Existing customer/item maintenance remains available to Office.  Vendor and
-- warehouse sourcing changes purchasing/receiving reference data, so only
-- Leadership and Lucid Admin may change those native masters.
create or replace function assert_lucid_extended_master_data_write()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare actor profiles%rowtype;
begin
  select p.* into actor from profiles as p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('lucid_admin', 'leadership') then
    raise exception 'Your role cannot change vendor or warehouse master data.';
  end if;
  if new.organization_id is distinct from actor.organization_id then
    raise exception 'Master data must belong to your organization.';
  end if;
  new.created_by := case when tg_op = 'INSERT' then coalesce(new.created_by, actor.id) else new.created_by end;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function audit_lucid_extended_master_data_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb := to_jsonb(new);
  old_payload jsonb := to_jsonb(old);
  action_name text;
begin
  action_name := case
    when tg_op = 'INSERT' then 'created'
    when old_payload ->> 'status' = 'active' and payload ->> 'status' = 'inactive' then 'inactivated'
    when tg_op = 'UPDATE' then 'updated'
    else lower(tg_op)
  end;
  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (coalesce((payload ->> 'organization_id')::uuid, (old_payload ->> 'organization_id')::uuid), auth.uid(),
    lower(tg_table_name) || ' ' || action_name, tg_table_name,
    coalesce(payload ->> 'id', old_payload ->> 'id'), jsonb_build_object('source', 'lucid_master_data'));
  return new;
end;
$$;

alter table warehouses enable row level security;
alter table vendors enable row level security;
alter table vendor_items enable row level security;

drop policy if exists "master warehouses select same org" on warehouses;
drop policy if exists "master warehouses insert same org" on warehouses;
drop policy if exists "master warehouses update same org" on warehouses;
drop policy if exists "master vendors select same org" on vendors;
drop policy if exists "master vendors insert same org" on vendors;
drop policy if exists "master vendors update same org" on vendors;
drop policy if exists "master vendor items select same org" on vendor_items;
drop policy if exists "master vendor items insert same org" on vendor_items;
drop policy if exists "master vendor items update same org" on vendor_items;

create policy "master warehouses select same org" on warehouses for select using (organization_id = current_org_id());
create policy "master warehouses insert same org" on warehouses for insert with check (organization_id = current_org_id());
create policy "master warehouses update same org" on warehouses for update using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "master vendors select same org" on vendors for select using (organization_id = current_org_id());
create policy "master vendors insert same org" on vendors for insert with check (organization_id = current_org_id());
create policy "master vendors update same org" on vendors for update using (organization_id = current_org_id()) with check (organization_id = current_org_id());
create policy "master vendor items select same org" on vendor_items for select using (organization_id = current_org_id());
create policy "master vendor items insert same org" on vendor_items for insert with check (organization_id = current_org_id());
create policy "master vendor items update same org" on vendor_items for update using (organization_id = current_org_id()) with check (organization_id = current_org_id());

drop trigger if exists items_extended_master_scope on items;
drop trigger if exists vendors_extended_master_write on vendors;
drop trigger if exists warehouses_extended_master_write on warehouses;
drop trigger if exists vendor_items_extended_master_write on vendor_items;
drop trigger if exists vendor_items_extended_master_scope on vendor_items;
drop trigger if exists vendors_extended_master_audit on vendors;
drop trigger if exists warehouses_extended_master_audit on warehouses;
drop trigger if exists vendor_items_extended_master_audit on vendor_items;

create trigger items_extended_master_scope before insert or update of organization_id, vendor_id on items
  for each row execute function validate_lucid_extended_master_data_scope();
create trigger vendors_extended_master_write before insert or update on vendors
  for each row execute function assert_lucid_extended_master_data_write();
create trigger warehouses_extended_master_write before insert or update on warehouses
  for each row execute function assert_lucid_extended_master_data_write();
create trigger vendor_items_extended_master_write before insert or update on vendor_items
  for each row execute function assert_lucid_extended_master_data_write();
create trigger vendor_items_extended_master_scope before insert or update on vendor_items
  for each row execute function validate_lucid_extended_master_data_scope();
create trigger vendors_extended_master_audit after insert or update on vendors
  for each row execute function audit_lucid_extended_master_data_change();
create trigger warehouses_extended_master_audit after insert or update on warehouses
  for each row execute function audit_lucid_extended_master_data_change();
create trigger vendor_items_extended_master_audit after insert or update on vendor_items
  for each row execute function audit_lucid_extended_master_data_change();

create unique index if not exists warehouses_active_code_unique_idx on warehouses (organization_id, warehouse_code) where status = 'active';
create unique index if not exists warehouses_source_record_unique_idx on warehouses (organization_id, source_system, source_record_id) where source_record_id is not null;
create unique index if not exists vendors_active_code_unique_idx on vendors (organization_id, vendor_code) where status = 'active';
create unique index if not exists vendors_source_record_unique_idx on vendors (organization_id, source_system, source_record_id) where source_record_id is not null;
create unique index if not exists vendor_items_active_code_uom_unique_idx on vendor_items (organization_id, vendor_id, vendor_item_code, coalesce(vendor_uom, '')) where status = 'active';
create unique index if not exists vendor_items_source_record_unique_idx on vendor_items (organization_id, source_system, source_record_id) where source_record_id is not null;
create unique index if not exists customer_contacts_source_record_unique_idx on customer_contacts (organization_id, source_system, source_record_id) where source_record_id is not null;
create index if not exists items_vendor_master_lookup_idx on items (organization_id, vendor_id) where vendor_id is not null;
create index if not exists vendor_items_master_lookup_idx on vendor_items (organization_id, vendor_id, item_id, status);

commit;
