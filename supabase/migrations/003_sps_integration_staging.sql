-- SPS -> Lucid Core staging and mapping layer.
-- This migration is intentionally not applied by the application.

begin;

create table if not exists integration_customer_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_system text not null default 'sps',
  source_trading_partner_id text not null,
  source_customer_name text,
  food_connex_customer_id text,
  food_connex_customer_name text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_system, source_trading_partner_id),
  unique (id, organization_id)
);

create table if not exists integration_ship_to_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_system text not null default 'sps',
  source_trading_partner_id text,
  source_location_code text not null,
  source_ship_to_name text,
  food_connex_ship_to_id text,
  food_connex_ship_to_name text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id)
);

create unique index if not exists integration_ship_to_mappings_partner_location_unique
  on integration_ship_to_mappings (
    organization_id,
    source_system,
    source_trading_partner_id,
    source_location_code
  )
  where source_trading_partner_id is not null;

create unique index if not exists integration_ship_to_mappings_global_location_unique
  on integration_ship_to_mappings (
    organization_id,
    source_system,
    source_location_code
  )
  where source_trading_partner_id is null;

create table if not exists integration_item_mappings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_system text not null default 'sps',
  source_trading_partner_id text,
  buyer_part_number text,
  vendor_item text,
  gtin text,
  food_connex_item_id text,
  food_connex_item_number text not null,
  sps_uom text,
  food_connex_uom text,
  approved_price numeric,
  status text not null default 'active' check (status in ('active', 'inactive')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    buyer_part_number is not null
    or vendor_item is not null
    or gtin is not null
  ),
  unique (id, organization_id)
);

-- Enforce one mapping per external identifier within an explicit source scope.
-- These apply regardless of active/inactive state to preserve unambiguous history.
create unique index if not exists integration_item_mappings_partner_buyer_part_unique
  on integration_item_mappings (
    organization_id, source_system, source_trading_partner_id, buyer_part_number
  )
  where source_trading_partner_id is not null and buyer_part_number is not null;

create unique index if not exists integration_item_mappings_global_buyer_part_unique
  on integration_item_mappings (organization_id, source_system, buyer_part_number)
  where source_trading_partner_id is null and buyer_part_number is not null;

create unique index if not exists integration_item_mappings_partner_vendor_item_unique
  on integration_item_mappings (
    organization_id, source_system, source_trading_partner_id, vendor_item
  )
  where source_trading_partner_id is not null and vendor_item is not null;

create unique index if not exists integration_item_mappings_global_vendor_item_unique
  on integration_item_mappings (organization_id, source_system, vendor_item)
  where source_trading_partner_id is null and vendor_item is not null;

create unique index if not exists integration_item_mappings_partner_gtin_unique
  on integration_item_mappings (
    organization_id, source_system, source_trading_partner_id, gtin
  )
  where source_trading_partner_id is not null and gtin is not null;

create unique index if not exists integration_item_mappings_global_gtin_unique
  on integration_item_mappings (organization_id, source_system, gtin)
  where source_trading_partner_id is null and gtin is not null;

create table if not exists sps_staged_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  source_system text not null default 'sps',
  source_file text,
  source_path text,
  external_po text not null,
  trading_partner_id text,
  po_date date,
  requested_ship_date date,
  requested_delivery_date date,
  source_customer_name text,
  source_ship_to_name text,
  source_ship_to_code text,
  customer_mapping_id uuid,
  ship_to_mapping_id uuid,
  mapping_status text not null default 'unmapped' check (
    mapping_status in ('unmapped', 'partially_mapped', 'mapped', 'needs_review')
  ),
  review_status text not null default 'new' check (
    review_status in ('new', 'needs_review', 'ready', 'approved', 'rejected', 'promoted')
  ),
  raw_xml text,
  normalized_payload jsonb,
  approved_by uuid references profiles(id) on delete set null,
  approved_at timestamptz,
  promoted_order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organization_id),
  foreign key (customer_mapping_id, organization_id)
    references integration_customer_mappings (id, organization_id)
    on delete set null (customer_mapping_id),
  foreign key (ship_to_mapping_id, organization_id)
    references integration_ship_to_mappings (id, organization_id)
    on delete set null (ship_to_mapping_id)
);

-- Null trading partner IDs are one explicit global source scope.
create unique index if not exists sps_staged_orders_partner_po_unique
  on sps_staged_orders (
    organization_id, source_system, trading_partner_id, external_po
  )
  where trading_partner_id is not null;

create unique index if not exists sps_staged_orders_global_po_unique
  on sps_staged_orders (organization_id, source_system, external_po)
  where trading_partner_id is null;

create table if not exists sps_staged_order_lines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  staged_order_id uuid not null,
  line_number text,
  buyer_part_number text,
  vendor_item text,
  gtin text,
  description text,
  quantity numeric,
  sps_uom text,
  sps_purchase_price numeric,
  item_mapping_id uuid,
  mapped_food_connex_item_id text,
  mapped_food_connex_item_number text,
  food_connex_uom text,
  approved_circle_r_price numeric,
  item_mapping_status text not null default 'unmapped' check (
    item_mapping_status in ('mapped', 'unmapped', 'ambiguous')
  ),
  price_status text not null default 'unknown' check (
    price_status in ('match', 'mismatch', 'unknown')
  ),
  uom_status text not null default 'unknown' check (
    uom_status in ('match', 'mismatch', 'unknown')
  ),
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  unique (id, organization_id),
  unique (id, staged_order_id, organization_id),
  foreign key (staged_order_id, organization_id)
    references sps_staged_orders (id, organization_id)
    on delete cascade,
  foreign key (item_mapping_id, organization_id)
    references integration_item_mappings (id, organization_id)
    on delete set null (item_mapping_id)
);

create index if not exists sps_staged_order_lines_staged_order
  on sps_staged_order_lines (staged_order_id);

create table if not exists sps_order_exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  staged_order_id uuid not null,
  staged_order_line_id uuid,
  exception_code text not null,
  severity text not null default 'warning' check (
    severity in ('info', 'warning', 'blocking')
  ),
  field_name text,
  message text not null,
  suggested_actions jsonb not null default '[]'::jsonb,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolution_action text,
  resolved_by uuid references profiles(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (staged_order_id, organization_id)
    references sps_staged_orders (id, organization_id)
    on delete cascade,
  foreign key (staged_order_line_id, staged_order_id, organization_id)
    references sps_staged_order_lines (id, staged_order_id, organization_id)
    on delete set null (staged_order_line_id)
);

create index if not exists sps_order_exceptions_order_status
  on sps_order_exceptions (staged_order_id, status);

-- Enforce same-organization references to existing profiles/orders without
-- modifying those existing tables to add composite unique keys.
create or replace function validate_sps_staging_cross_org_references()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_table_name = 'sps_staged_orders' then
    if new.approved_by is not null and not exists (
      select 1 from profiles p
      where p.id = new.approved_by and p.organization_id = new.organization_id
    ) then
      raise exception 'approved_by must belong to the staged order organization';
    end if;

    if new.promoted_order_id is not null and not exists (
      select 1 from orders o
      where o.id = new.promoted_order_id and o.organization_id = new.organization_id
    ) then
      raise exception 'promoted_order_id must belong to the staged order organization';
    end if;
  elsif tg_table_name = 'sps_order_exceptions' then
    if new.resolved_by is not null and not exists (
      select 1 from profiles p
      where p.id = new.resolved_by and p.organization_id = new.organization_id
    ) then
      raise exception 'resolved_by must belong to the exception organization';
    end if;
  end if;

  return new;
end;
$$;

-- Self-contained timestamp maintenance for new integration tables only.
create or replace function set_sps_integration_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger sps_staged_orders_validate_organization_references
  before insert or update on sps_staged_orders
  for each row execute function validate_sps_staging_cross_org_references();

create trigger sps_order_exceptions_validate_organization_references
  before insert or update on sps_order_exceptions
  for each row execute function validate_sps_staging_cross_org_references();

create trigger integration_customer_mappings_set_updated_at
  before update on integration_customer_mappings
  for each row execute function set_sps_integration_updated_at();

create trigger integration_ship_to_mappings_set_updated_at
  before update on integration_ship_to_mappings
  for each row execute function set_sps_integration_updated_at();

create trigger integration_item_mappings_set_updated_at
  before update on integration_item_mappings
  for each row execute function set_sps_integration_updated_at();

create trigger sps_staged_orders_set_updated_at
  before update on sps_staged_orders
  for each row execute function set_sps_integration_updated_at();

alter table integration_customer_mappings enable row level security;
alter table integration_ship_to_mappings enable row level security;
alter table integration_item_mappings enable row level security;
alter table sps_staged_orders enable row level security;
alter table sps_staged_order_lines enable row level security;
alter table sps_order_exceptions enable row level security;

create policy "integration customer mappings same org"
  on integration_customer_mappings for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create policy "integration ship to mappings same org"
  on integration_ship_to_mappings for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create policy "integration item mappings same org"
  on integration_item_mappings for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create policy "sps staged orders same org"
  on sps_staged_orders for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create policy "sps staged order lines same org"
  on sps_staged_order_lines for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

create policy "sps order exceptions same org"
  on sps_order_exceptions for all
  using (organization_id = current_org_id())
  with check (organization_id = current_org_id());

commit;
