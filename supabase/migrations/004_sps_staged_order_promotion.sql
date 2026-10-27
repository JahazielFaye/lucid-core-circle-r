-- Promote reviewed SPS staged orders into Lucid operational orders.
begin;

alter table orders
  add column if not exists sps_staged_order_id uuid,
  add column if not exists trading_partner_id text,
  add column if not exists po_date date,
  add column if not exists created_by uuid references profiles(id) on delete set null,
  add column if not exists promoted_at timestamptz;

alter table orders
  add constraint orders_sps_staged_order_org_fkey
  foreign key (sps_staged_order_id, organization_id)
  references sps_staged_orders (id, organization_id)
  on delete set null (sps_staged_order_id);

alter table orders
  add constraint orders_lifecycle_status_check check (status in (
    'new', 'ready_for_production', 'in_production', 'production_complete',
    'palletizing', 'ready_to_ship', 'shipped', 'closed', 'cancelled'
  )) not valid;

create unique index if not exists orders_sps_staged_order_unique
  on orders (sps_staged_order_id)
  where sps_staged_order_id is not null;

create index if not exists orders_sps_business_identity
  on orders (organization_id, trading_partner_id, external_po)
  where source = 'sps';

alter table order_lines
  add column if not exists sps_staged_order_line_id uuid references sps_staged_order_lines(id) on delete set null,
  add column if not exists source_line_number text,
  add column if not exists gtin text,
  add column if not exists sps_source_unit_price numeric,
  add column if not exists price_resolution_action text;

create unique index if not exists order_lines_sps_staged_line_unique
  on order_lines (sps_staged_order_line_id)
  where sps_staged_order_line_id is not null;

drop policy if exists "audit insert own actor" on audit_events;
create policy "audit insert own actor" on audit_events for insert
  with check (organization_id = current_org_id() and actor_id = auth.uid());

create or replace function promote_sps_staged_order(p_staged_order_id uuid)
returns table (operational_order_id uuid, already_promoted boolean, operational_status text)
language plpgsql
security invoker
set search_path = public
as $$
declare
  staged sps_staged_orders%rowtype;
  current_profile profiles%rowtype;
  existing_order_id uuid;
  inserted_order_id uuid;
  open_review_count integer;
  unmapped_line_count integer;
begin
  select * into current_profile from profiles where id = auth.uid() and active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if current_profile.role not in ('office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot send incoming orders to production.';
  end if;

  select * into staged from sps_staged_orders
    where id = p_staged_order_id and organization_id = current_profile.organization_id
    for update;
  if not found then raise exception 'The incoming SPS order was not found.'; end if;

  select id into existing_order_id from orders
    where sps_staged_order_id = staged.id and organization_id = staged.organization_id;
  if found then
    return query select existing_order_id, true, (select status from orders where id = existing_order_id);
    return;
  end if;

  if staged.review_status <> 'ready' then raise exception 'This order is not ready for production.'; end if;
  if staged.customer_mapping_id is null or staged.ship_to_mapping_id is null then
    raise exception 'Customer and ship-to confirmations are required before production.';
  end if;
  select count(*) into unmapped_line_count from sps_staged_order_lines
    where staged_order_id = staged.id and organization_id = staged.organization_id
      and item_mapping_status <> 'mapped';
  if unmapped_line_count > 0 then raise exception 'All line items must be confirmed before production.'; end if;
  select count(*) into open_review_count from sps_order_exceptions
    where staged_order_id = staged.id and organization_id = staged.organization_id
      and status = 'open' and severity in ('warning', 'blocking');
  if open_review_count > 0 then raise exception 'Open order checks must be resolved before production.'; end if;
  if exists (
    select 1 from sps_order_exceptions
    where staged_order_id = staged.id and organization_id = staged.organization_id
      and status = 'open' and exception_code = 'PRICE_MISMATCH'
      and details ? 'leadership_review_requested_at'
  ) then raise exception 'A leadership price decision is still pending.'; end if;

  insert into orders (
    organization_id, external_po, customer, ship_to, source, requested_ship_date,
    requested_delivery_date, status, raw_payload, sps_staged_order_id,
    trading_partner_id, po_date, created_by, promoted_at
  )
  select staged.organization_id, staged.external_po,
    coalesce(customer_map.food_connex_customer_name, staged.source_customer_name),
    coalesce(ship_to_map.food_connex_ship_to_name, staged.source_ship_to_name),
    'sps', staged.requested_ship_date, staged.requested_delivery_date,
    'ready_for_production', staged.normalized_payload, staged.id,
    staged.trading_partner_id, staged.po_date, current_profile.id, now()
  from integration_customer_mappings customer_map
  join integration_ship_to_mappings ship_to_map on ship_to_map.id = staged.ship_to_mapping_id
  where customer_map.id = staged.customer_mapping_id
  returning id into inserted_order_id;
  if inserted_order_id is null then raise exception 'Confirmed customer or ship-to record was not found.'; end if;

  insert into order_lines (
    order_id, external_sku, vendor_item, internal_item_id, description,
    quantity_cases, unit_price, uom, sps_staged_order_line_id, source_line_number,
    gtin, sps_source_unit_price, price_resolution_action
  )
  select inserted_order_id, line.buyer_part_number, line.vendor_item,
    line.mapped_food_connex_item_id, coalesce(line.description, 'SPS item'),
    line.quantity, case
      when price_resolution.resolution_action = 'use_sps_price' then line.sps_purchase_price
      when price_resolution.resolution_action = 'use_approved_circle_r_price' then coalesce(line.approved_circle_r_price, line.sps_purchase_price)
      else coalesce(line.approved_circle_r_price, line.sps_purchase_price)
    end, line.sps_uom, line.id, line.line_number, line.gtin,
    line.sps_purchase_price, price_resolution.resolution_action
  from sps_staged_order_lines line
  left join lateral (
    select resolution_action from sps_order_exceptions
    where staged_order_line_id = line.id and exception_code = 'PRICE_MISMATCH'
      and status = 'resolved'
    order by resolved_at desc nulls last
    limit 1
  ) price_resolution on true
  where line.staged_order_id = staged.id and line.organization_id = staged.organization_id;

  update sps_staged_orders set review_status = 'promoted', promoted_order_id = inserted_order_id,
    approved_by = current_profile.id, approved_at = now()
  where id = staged.id and organization_id = staged.organization_id;

  insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values (staged.organization_id, current_profile.id, 'promoted SPS order to Lucid operational order',
    'order', inserted_order_id::text,
    jsonb_build_object('staged_sps_order_id', staged.id, 'operational_order_id', inserted_order_id, 'po_number', staged.external_po));

  return query select inserted_order_id, false, 'ready_for_production'::text;
end;
$$;

grant execute on function promote_sps_staged_order(uuid) to authenticated;

commit;
