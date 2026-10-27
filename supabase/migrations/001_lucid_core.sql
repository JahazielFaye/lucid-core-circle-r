-- Lucid Core / Circle R Beef baseline schema
create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  display_name text not null,
  role text not null check (role in ('Crystal','CJ / Production','Mark','Lucid Admin')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null check (kind in ('direct','group')),
  name text not null,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists conversation_members (
  conversation_id uuid references conversations(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (conversation_id,user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  sender_id uuid not null references profiles(id),
  body text not null check (length(body) between 1 and 10000),
  forwarded_from_id uuid references messages(id) on delete set null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create table if not exists message_reads (
  message_id uuid references messages(id) on delete cascade,
  user_id uuid references profiles(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id,user_id)
);

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  external_po text not null,
  customer text not null,
  ship_to text,
  source text,
  food_connex_order text,
  requested_ship_date date,
  requested_delivery_date date,
  ordered_weight_lb numeric,
  status text not null default 'new',
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_po)
);

create table if not exists order_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  external_sku text,
  vendor_item text,
  internal_item_id text,
  description text not null,
  quantity_cases numeric not null default 0,
  unit_price numeric,
  uom text,
  lot_code text,
  created_at timestamptz not null default now()
);

create table if not exists pallets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id uuid not null references orders(id) on delete cascade,
  label text not null,
  status text not null default 'building',
  completed_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists pallet_cases (
  id uuid primary key default gen_random_uuid(),
  pallet_id uuid not null references pallets(id) on delete cascade,
  scanned_code text not null,
  item_id text,
  lot_code text,
  weight_lb numeric not null default 0,
  scanned_at timestamptz not null default now(),
  unique (pallet_id, scanned_code)
);

create table if not exists exceptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id uuid references orders(id) on delete cascade,
  exception_type text not null,
  severity text not null default 'warning',
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  resolved_by uuid references profiles(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  order_id uuid references orders(id) on delete set null,
  document_type text not null,
  title text not null,
  storage_path text,
  sharepoint_status text not null default 'not_queued',
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists audit_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_id uuid references profiles(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- RLS: authenticated users can only see data in their organization.
alter table profiles enable row level security;
alter table conversations enable row level security;
alter table conversation_members enable row level security;
alter table messages enable row level security;
alter table message_reads enable row level security;
alter table orders enable row level security;
alter table order_lines enable row level security;
alter table pallets enable row level security;
alter table pallet_cases enable row level security;
alter table exceptions enable row level security;
alter table documents enable row level security;
alter table audit_events enable row level security;

create or replace function current_org_id() returns uuid language sql stable security definer set search_path=public as $$
  select organization_id from profiles where id=auth.uid()
$$;

create policy "profiles same org" on profiles for select using (organization_id=current_org_id());
create policy "conversations same org" on conversations for all using (organization_id=current_org_id()) with check (organization_id=current_org_id());
create policy "conversation members permitted" on conversation_members for all using (exists(select 1 from conversations c where c.id=conversation_id and c.organization_id=current_org_id())) with check (exists(select 1 from conversations c where c.id=conversation_id and c.organization_id=current_org_id()));
create policy "messages conversation members" on messages for all using (exists(select 1 from conversation_members cm where cm.conversation_id=messages.conversation_id and cm.user_id=auth.uid())) with check (sender_id=auth.uid() and exists(select 1 from conversation_members cm where cm.conversation_id=messages.conversation_id and cm.user_id=auth.uid()));
create policy "message reads conversation members" on message_reads for all using (user_id=auth.uid() or exists(select 1 from messages m join conversation_members cm on cm.conversation_id=m.conversation_id where m.id=message_id and cm.user_id=auth.uid())) with check (user_id=auth.uid());
create policy "orders same org" on orders for all using (organization_id=current_org_id()) with check (organization_id=current_org_id());
create policy "order lines same org" on order_lines for all using (exists(select 1 from orders o where o.id=order_id and o.organization_id=current_org_id())) with check (exists(select 1 from orders o where o.id=order_id and o.organization_id=current_org_id()));
create policy "pallets same org" on pallets for all using (organization_id=current_org_id()) with check (organization_id=current_org_id());
create policy "pallet cases same org" on pallet_cases for all using (exists(select 1 from pallets p where p.id=pallet_id and p.organization_id=current_org_id())) with check (exists(select 1 from pallets p where p.id=pallet_id and p.organization_id=current_org_id()));
create policy "exceptions same org" on exceptions for all using (organization_id=current_org_id()) with check (organization_id=current_org_id());
create policy "documents same org" on documents for all using (organization_id=current_org_id()) with check (organization_id=current_org_id());
create policy "audit same org" on audit_events for select using (organization_id=current_org_id());

create index if not exists idx_messages_conversation_created on messages(conversation_id,created_at);
create index if not exists idx_orders_po on orders(external_po);
create index if not exists idx_cases_scan on pallet_cases(scanned_code);
create index if not exists idx_exceptions_order on exceptions(order_id,status);
