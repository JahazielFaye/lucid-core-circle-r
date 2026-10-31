-- Atomic, organization-scoped seed for the one controlled QA workflow fixture set.
-- It creates no new tables and cannot update or adopt real master records.
begin;

create or replace function prepare_lucid_qa_master_data()
returns table (
  customer_id uuid,
  ship_to_id uuid,
  item_id uuid,
  customer_item_id uuid,
  status text
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor profiles%rowtype;
  qa_customer customers%rowtype;
  qa_ship_to customer_ship_tos%rowtype;
  qa_item items%rowtype;
  qa_customer_item customer_items%rowtype;
  seed_created boolean := false;
begin
  select p.* into actor from profiles as p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role <> 'lucid_admin' then raise exception 'Only Lucid Admin can prepare controlled QA master data.'; end if;

  select c.* into qa_customer from customers as c
    where c.organization_id = actor.organization_id and c.customer_code = 'QA-CUSTOMER-WORK-001'
    for update;
  if found and qa_customer.source_system <> 'lucid_qa' then
    raise exception 'QA customer code collides with a non-QA customer.';
  end if;
  if found and (
    qa_customer.status <> 'active'
    or qa_customer.is_historical
    or qa_customer.source_record_id <> 'QA-CUSTOMER-WORK-001'
    or qa_customer.name <> 'QA Test Customer'
  ) then
    raise exception 'Existing QA customer fixture is not the expected active QA record.';
  end if;
  if not found and exists (
    select 1 from customers as c
    where c.organization_id = actor.organization_id and c.name = 'QA Test Customer' and c.source_system <> 'lucid_qa'
  ) then
    raise exception 'QA customer name collides with a non-QA customer.';
  end if;
  if not found then
    insert into customers (organization_id, customer_code, name, status, source_system, source_record_id, is_historical, created_by)
    values (actor.organization_id, 'QA-CUSTOMER-WORK-001', 'QA Test Customer', 'active', 'lucid_qa', 'QA-CUSTOMER-WORK-001', false, actor.id)
    returning * into qa_customer;
    seed_created := true;
  end if;

  select s.* into qa_ship_to from customer_ship_tos as s
    where s.organization_id = actor.organization_id and s.customer_id = qa_customer.id and s.location_code = 'QA-SHIP-TO-WORK-001'
    for update;
  if found and qa_ship_to.source_system <> 'lucid_qa' then
    raise exception 'QA ship-to code collides with a non-QA ship-to.';
  end if;
  if found and (
    qa_ship_to.status <> 'active'
    or qa_ship_to.is_historical
    or qa_ship_to.source_record_id <> 'QA-SHIP-TO-WORK-001'
    or qa_ship_to.name <> 'QA Test Ship-To'
  ) then
    raise exception 'Existing QA ship-to fixture is not the expected active QA record.';
  end if;
  if not found and exists (
    select 1 from customer_ship_tos as s
    where s.organization_id = actor.organization_id and s.customer_id = qa_customer.id
      and s.name = 'QA Test Ship-To' and s.source_system <> 'lucid_qa'
  ) then
    raise exception 'QA ship-to name collides with a non-QA ship-to.';
  end if;
  if not found then
    insert into customer_ship_tos (organization_id, customer_id, location_code, name, status, source_system, source_record_id, is_historical, created_by)
    values (actor.organization_id, qa_customer.id, 'QA-SHIP-TO-WORK-001', 'QA Test Ship-To', 'active', 'lucid_qa', 'QA-SHIP-TO-WORK-001', false, actor.id)
    returning * into qa_ship_to;
    seed_created := true;
  end if;

  select i.* into qa_item from items as i
    where i.organization_id = actor.organization_id and i.item_code = 'QA-ITEM-WORK-001'
    for update;
  if found and qa_item.source_system <> 'lucid_qa' then
    raise exception 'QA item code collides with a non-QA item.';
  end if;
  if found and (
    qa_item.status <> 'active'
    or qa_item.is_historical
    or qa_item.source_record_id <> 'QA-ITEM-WORK-001'
    or qa_item.description <> 'QA Validation Item'
    or not qa_item.catch_weight
    or qa_item.stock_uom is distinct from 'CS'
    or qa_item.sell_uom is distinct from 'CS'
    or qa_item.standard_weight_uom is distinct from 'LB'
  ) then
    raise exception 'Existing QA item fixture is not the expected active QA record.';
  end if;
  if not found then
    insert into items (organization_id, item_code, description, status, catch_weight, stock_uom, sell_uom, standard_weight_uom, source_system, source_record_id, is_historical, created_by)
    values (actor.organization_id, 'QA-ITEM-WORK-001', 'QA Validation Item', 'active', true, 'CS', 'CS', 'LB', 'lucid_qa', 'QA-ITEM-WORK-001', false, actor.id)
    returning * into qa_item;
    seed_created := true;
  end if;

  select ci.* into qa_customer_item from customer_items as ci
    where ci.organization_id = actor.organization_id and ci.customer_id = qa_customer.id
      and ci.ship_to_id = qa_ship_to.id and ci.customer_sku = 'QA-SKU-WORK-001'
    for update;
  if found and (qa_customer_item.source_system <> 'lucid_qa' or qa_customer_item.item_id <> qa_item.id) then
    raise exception 'QA customer SKU collides with a non-QA or different-item mapping.';
  end if;
  if found and (
    qa_customer_item.status <> 'active'
    or qa_customer_item.is_historical
    or qa_customer_item.source_record_id <> 'QA-CUSTOMER-ITEM-WORK-001'
    or qa_customer_item.customer_description is distinct from 'QA Validation Item'
    or qa_customer_item.customer_uom is distinct from 'CS'
  ) then
    raise exception 'Existing QA customer SKU fixture is not the expected active QA record.';
  end if;
  if not found then
    insert into customer_items (organization_id, customer_id, ship_to_id, item_id, customer_sku, customer_description, customer_uom, source_system, source_record_id, is_historical, created_by)
    values (actor.organization_id, qa_customer.id, qa_ship_to.id, qa_item.id, 'QA-SKU-WORK-001', 'QA Validation Item', 'CS', 'lucid_qa', 'QA-CUSTOMER-ITEM-WORK-001', false, actor.id)
    returning * into qa_customer_item;
    seed_created := true;
  end if;

  if seed_created then
    insert into audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
    values (actor.organization_id, actor.id, 'prepared controlled QA master data', 'qa_master_data', qa_item.id::text,
      jsonb_build_object('customer_id', qa_customer.id, 'ship_to_id', qa_ship_to.id, 'item_id', qa_item.id, 'customer_item_id', qa_customer_item.id, 'source_system', 'lucid_qa'));
  end if;

  return query select qa_customer.id, qa_ship_to.id, qa_item.id, qa_customer_item.id, 'ready'::text;
end;
$$;

revoke all on function prepare_lucid_qa_master_data() from public;
grant execute on function prepare_lucid_qa_master_data() to authenticated;

commit;
