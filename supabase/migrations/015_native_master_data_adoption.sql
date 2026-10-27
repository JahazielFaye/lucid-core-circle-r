-- Native Customer / Ship-To / Item adoption for newly promoted SPS orders.
-- Existing operational records remain untouched and may keep null native IDs.
begin;

alter table order_lines
  add column if not exists item_id uuid references items(id) on delete restrict;

-- `order_lines` has no organization_id of its own. Enforce the Item relationship
-- through its parent order, without modifying any legacy/null-item rows.
create or replace function validate_lucid_order_line_item_scope()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  order_organization_id uuid;
  item_organization_id uuid;
begin
  if new.item_id is null then return new; end if;
  select organization_id into order_organization_id from orders where id = new.order_id;
  select organization_id into item_organization_id from items where id = new.item_id;
  if order_organization_id is null or item_organization_id is null
     or order_organization_id is distinct from item_organization_id then
    raise exception 'The native item must belong to the same organization as the order line.';
  end if;
  return new;
end;
$$;

create trigger validate_native_order_line_item_scope
  before insert or update of order_id, item_id on order_lines
  for each row execute function validate_lucid_order_line_item_scope();

create index if not exists order_lines_native_item_idx
  on order_lines (item_id) where item_id is not null;

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

  -- Preserve idempotency and never remap a previously promoted historical order.
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
    organization_id, external_po, customer, ship_to, customer_id, ship_to_id,
    source, requested_ship_date, requested_delivery_date, status, raw_payload,
    sps_staged_order_id, trading_partner_id, po_date, created_by, promoted_at
  )
  select staged.organization_id, staged.external_po,
    coalesce(native_customer.name, customer_map.food_connex_customer_name, staged.source_customer_name),
    coalesce(native_ship_to.name, ship_to_map.food_connex_ship_to_name, staged.source_ship_to_name),
    customer_map.customer_id, ship_to_map.ship_to_id,
    'sps', staged.requested_ship_date, staged.requested_delivery_date,
    'ready_for_production', staged.normalized_payload, staged.id,
    staged.trading_partner_id, staged.po_date, current_profile.id, now()
  from integration_customer_mappings as customer_map
  join integration_ship_to_mappings as ship_to_map on ship_to_map.id = staged.ship_to_mapping_id
  left join customers as native_customer
    on native_customer.id = customer_map.customer_id
   and native_customer.organization_id = staged.organization_id
  left join customer_ship_tos as native_ship_to
    on native_ship_to.id = ship_to_map.ship_to_id
   and native_ship_to.organization_id = staged.organization_id
  where customer_map.id = staged.customer_mapping_id
  returning id into inserted_order_id;
  if inserted_order_id is null then raise exception 'Confirmed customer or ship-to record was not found.'; end if;

  insert into order_lines (
    order_id, item_id, external_sku, vendor_item, internal_item_id, description,
    quantity_cases, unit_price, uom, sps_staged_order_line_id, source_line_number,
    gtin, sps_source_unit_price, price_resolution_action
  )
  select inserted_order_id, native_item.id,
    line.buyer_part_number, line.vendor_item,
    coalesce(native_item.item_code, line.mapped_food_connex_item_id),
    coalesce(native_item.description, line.description, 'SPS item'),
    line.quantity, case
      when price_resolution.resolution_action = 'use_sps_price' then line.sps_purchase_price
      when price_resolution.resolution_action = 'use_approved_circle_r_price' then coalesce(line.approved_circle_r_price, line.sps_purchase_price)
      else coalesce(line.approved_circle_r_price, line.sps_purchase_price)
    end,
    coalesce(native_item.stock_uom, native_item.sell_uom, line.sps_uom),
    line.id, line.line_number, line.gtin,
    line.sps_purchase_price, price_resolution.resolution_action
  from sps_staged_order_lines as line
  left join integration_item_mappings as item_map on item_map.id = line.item_mapping_id
  left join items as native_item
    on native_item.id = item_map.item_id
   and native_item.organization_id = staged.organization_id
  left join lateral (
    select resolution_action from sps_order_exceptions
    where staged_order_line_id = line.id and exception_code = 'PRICE_MISMATCH'
      and status = 'resolved'
    order by resolved_at desc nulls last
    limit 1
  ) as price_resolution on true
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
