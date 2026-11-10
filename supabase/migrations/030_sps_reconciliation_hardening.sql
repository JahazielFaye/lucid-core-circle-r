-- SPS reconciliation hardening. This migration adds no SPS transport.
begin;

alter table public.sps_staged_orders
  add column if not exists document_type text,
  add column if not exists sps_id text,
  add column if not exists fulfillment_document_id text,
  add column if not exists business_po_number text,
  add column if not exists source_filename text,
  add column if not exists source_received_at timestamptz,
  add column if not exists source_delivered_at timestamptz,
  add column if not exists payload_hash text,
  add column if not exists source_change_date date,
  add column if not exists source_change_indicator text,
  add column if not exists source_document_key text,
  add column if not exists parent_staged_order_id uuid references public.sps_staged_orders(id) on delete set null;

update public.sps_staged_orders
  set business_po_number = coalesce(business_po_number, external_po),
      source_filename = coalesce(source_filename, source_file)
  where business_po_number is null or source_filename is null;

alter table public.sps_staged_orders
  drop constraint if exists sps_staged_orders_document_type_check;
alter table public.sps_staged_orders
  add constraint sps_staged_orders_document_type_check
  check (document_type is null or document_type in ('850', '860'));

-- A business PO is not a source-document identity: an 850 and an 860 may share it.
drop index if exists public.sps_staged_orders_partner_po_unique;
drop index if exists public.sps_staged_orders_global_po_unique;
create unique index if not exists sps_staged_orders_source_document_key_unique
  on public.sps_staged_orders (organization_id, source_system, source_document_key)
  where source_document_key is not null;
create index if not exists sps_staged_orders_business_po_idx
  on public.sps_staged_orders (organization_id, source_system, trading_partner_id, business_po_number, document_type);
create index if not exists sps_staged_orders_parent_idx
  on public.sps_staged_orders (parent_staged_order_id) where parent_staged_order_id is not null;

create or replace function public.assert_lucid_sps_write_role()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  actor public.profiles%rowtype;
  target_organization_id uuid;
begin
  if tg_op = 'DELETE' then target_organization_id := old.organization_id;
  else target_organization_id := new.organization_id;
  end if;
  select p.* into actor from public.profiles p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('office', 'leadership', 'lucid_admin') then
    raise exception 'Your role cannot change incoming SPS orders or mappings.';
  end if;
  if actor.organization_id is distinct from target_organization_id then
    raise exception 'Incoming SPS records must belong to your organization.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists enforce_lucid_sps_customer_mapping_write_role on public.integration_customer_mappings;
drop trigger if exists enforce_lucid_sps_ship_to_mapping_write_role on public.integration_ship_to_mappings;
drop trigger if exists enforce_lucid_sps_item_mapping_write_role on public.integration_item_mappings;
drop trigger if exists enforce_lucid_sps_staged_order_write_role on public.sps_staged_orders;
drop trigger if exists enforce_lucid_sps_staged_line_write_role on public.sps_staged_order_lines;
drop trigger if exists enforce_lucid_sps_exception_write_role on public.sps_order_exceptions;
create trigger enforce_lucid_sps_customer_mapping_write_role before insert or update or delete on public.integration_customer_mappings for each row execute function public.assert_lucid_sps_write_role();
create trigger enforce_lucid_sps_ship_to_mapping_write_role before insert or update or delete on public.integration_ship_to_mappings for each row execute function public.assert_lucid_sps_write_role();
create trigger enforce_lucid_sps_item_mapping_write_role before insert or update or delete on public.integration_item_mappings for each row execute function public.assert_lucid_sps_write_role();
create trigger enforce_lucid_sps_staged_order_write_role before insert or update or delete on public.sps_staged_orders for each row execute function public.assert_lucid_sps_write_role();
create trigger enforce_lucid_sps_staged_line_write_role before insert or update or delete on public.sps_staged_order_lines for each row execute function public.assert_lucid_sps_write_role();
create trigger enforce_lucid_sps_exception_write_role before insert or update or delete on public.sps_order_exceptions for each row execute function public.assert_lucid_sps_write_role();

create or replace function public.validate_lucid_sps_parent_scope()
returns trigger language plpgsql security invoker set search_path = public as $$
begin
  if new.parent_staged_order_id is not null and not exists (
    select 1
      from public.sps_staged_orders as parent_order
     where parent_order.id = new.parent_staged_order_id
       and parent_order.organization_id = new.organization_id
  ) then raise exception 'An SPS source document parent must belong to the same organization.'; end if;
  return new;
end;
$$;

create or replace function public.protect_lucid_promoted_sps_source()
returns trigger language plpgsql security invoker set search_path = public as $$
declare
  source_staged_order_id uuid;
  source_is_promoted boolean;
begin
  if tg_table_name = 'sps_staged_orders' then
    source_is_promoted := old.review_status = 'promoted' or old.promoted_order_id is not null;
  else
    source_staged_order_id := case when tg_op = 'DELETE' then old.staged_order_id else new.staged_order_id end;
    select staged.review_status = 'promoted' or staged.promoted_order_id is not null
      into source_is_promoted
      from public.sps_staged_orders as staged
     where staged.id = source_staged_order_id;
  end if;
  if coalesce(source_is_promoted, false) then
    raise exception 'Promoted SPS source documents are immutable.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists validate_lucid_sps_parent_scope on public.sps_staged_orders;
drop trigger if exists protect_lucid_promoted_sps_staged_order on public.sps_staged_orders;
drop trigger if exists protect_lucid_promoted_sps_staged_line on public.sps_staged_order_lines;
drop trigger if exists protect_lucid_promoted_sps_exception on public.sps_order_exceptions;
create trigger validate_lucid_sps_parent_scope before insert or update of parent_staged_order_id, organization_id on public.sps_staged_orders for each row execute function public.validate_lucid_sps_parent_scope();
create trigger protect_lucid_promoted_sps_staged_order before update or delete on public.sps_staged_orders for each row execute function public.protect_lucid_promoted_sps_source();
create trigger protect_lucid_promoted_sps_staged_line before insert or update or delete on public.sps_staged_order_lines for each row execute function public.protect_lucid_promoted_sps_source();
create trigger protect_lucid_promoted_sps_exception before insert or update or delete on public.sps_order_exceptions for each row execute function public.protect_lucid_promoted_sps_source();

create or replace function public.audit_lucid_sps_reconciliation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  payload jsonb;
  action_name text;
begin
  if tg_op = 'DELETE' then payload := to_jsonb(old);
  else payload := to_jsonb(new);
  end if;
  action_name := case
    when tg_table_name = 'sps_order_exceptions' and tg_op = 'UPDATE'
      and old.status = 'open' and new.status = 'resolved' then 'resolved SPS order exception'
    when tg_op = 'INSERT' then 'created SPS reconciliation mapping'
    when tg_op = 'UPDATE' then 'changed SPS reconciliation mapping'
    else lower(tg_op) || ' SPS reconciliation record'
  end;
  insert into public.audit_events (organization_id, actor_id, action, entity_type, entity_id, details)
  values ((payload->>'organization_id')::uuid, auth.uid(), action_name, tg_table_name, payload->>'id',
    jsonb_strip_nulls(jsonb_build_object('source_system', payload->>'source_system', 'source_identifier', coalesce(payload->>'source_trading_partner_id', payload->>'exception_code'))));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists audit_lucid_sps_customer_mapping_change on public.integration_customer_mappings;
drop trigger if exists audit_lucid_sps_ship_to_mapping_change on public.integration_ship_to_mappings;
drop trigger if exists audit_lucid_sps_item_mapping_change on public.integration_item_mappings;
drop trigger if exists audit_lucid_sps_exception_resolution on public.sps_order_exceptions;
create trigger audit_lucid_sps_customer_mapping_change after insert or update on public.integration_customer_mappings for each row execute function public.audit_lucid_sps_reconciliation_change();
create trigger audit_lucid_sps_ship_to_mapping_change after insert or update on public.integration_ship_to_mappings for each row execute function public.audit_lucid_sps_reconciliation_change();
create trigger audit_lucid_sps_item_mapping_change after insert or update on public.integration_item_mappings for each row execute function public.audit_lucid_sps_reconciliation_change();
create trigger audit_lucid_sps_exception_resolution after update on public.sps_order_exceptions for each row execute function public.audit_lucid_sps_reconciliation_change();

create or replace function public.promote_sps_staged_order(p_staged_order_id uuid)
returns table (operational_order_id uuid, already_promoted boolean, operational_status text)
language plpgsql security invoker set search_path = public
as $$
declare staged public.sps_staged_orders%rowtype; actor public.profiles%rowtype; existing_order_id uuid; inserted_order_id uuid;
begin
  select p.* into actor from public.profiles p where p.id = auth.uid() and p.active = true;
  if not found then raise exception 'An active Lucid Core profile is required.'; end if;
  if actor.role not in ('office', 'leadership', 'lucid_admin') then raise exception 'Your role cannot send incoming orders to production.'; end if;
  select s.* into staged from public.sps_staged_orders s where s.id = p_staged_order_id and s.organization_id = actor.organization_id for update;
  if not found then raise exception 'The incoming SPS order was not found.'; end if;
  select o.id into existing_order_id from public.orders o where o.sps_staged_order_id = staged.id and o.organization_id = staged.organization_id;
  if found then return query select existing_order_id, true, (select o.status from public.orders o where o.id = existing_order_id); return; end if;
  if staged.document_type = '860' then raise exception 'Purchase Order Change requires review and cannot be promoted as a new order.'; end if;
  if staged.review_status <> 'ready' then raise exception 'This order is not ready for production.'; end if;
  if staged.customer_mapping_id is null or staged.ship_to_mapping_id is null then raise exception 'Customer and ship-to confirmations are required before production.'; end if;
  if exists (select 1 from public.sps_staged_order_lines l where l.staged_order_id = staged.id and l.organization_id = staged.organization_id and (l.item_mapping_status <> 'mapped' or l.quantity is null or l.quantity <= 0 or l.sps_uom is null or l.uom_status <> 'match')) then
    raise exception 'Every incoming line needs an exact item, positive quantity, and matching UOM before production.';
  end if;
  if exists (select 1 from public.sps_order_exceptions e where e.staged_order_id = staged.id and e.organization_id = staged.organization_id and e.status = 'open' and e.severity in ('warning', 'blocking')) then raise exception 'Open order checks must be resolved before production.'; end if;
  if exists (select 1 from public.integration_customer_mappings m join public.customers c on c.id=m.customer_id where m.id=staged.customer_mapping_id and m.customer_id is not null and c.status <> 'active')
    or exists (select 1 from public.integration_ship_to_mappings m join public.customer_ship_tos st on st.id=m.ship_to_id where m.id=staged.ship_to_mapping_id and m.ship_to_id is not null and st.status <> 'active')
    or exists (select 1 from public.sps_staged_order_lines l join public.integration_item_mappings m on m.id=l.item_mapping_id join public.items i on i.id=m.item_id where l.staged_order_id=staged.id and m.item_id is not null and i.status <> 'active') then
    raise exception 'An incoming mapping points to inactive Lucid master data.';
  end if;
  insert into public.orders (organization_id, external_po, customer, ship_to, customer_id, ship_to_id, source, requested_ship_date, requested_delivery_date, status, raw_payload, sps_staged_order_id, trading_partner_id, po_date, created_by, promoted_at)
  select staged.organization_id, staged.external_po, coalesce(c.name, cm.food_connex_customer_name, staged.source_customer_name), coalesce(st.name, sm.food_connex_ship_to_name, staged.source_ship_to_name), cm.customer_id, sm.ship_to_id, 'sps', staged.requested_ship_date, staged.requested_delivery_date, 'ready_for_production', staged.normalized_payload, staged.id, staged.trading_partner_id, staged.po_date, actor.id, now()
  from public.integration_customer_mappings cm join public.integration_ship_to_mappings sm on sm.id=staged.ship_to_mapping_id left join public.customers c on c.id=cm.customer_id and c.organization_id=staged.organization_id left join public.customer_ship_tos st on st.id=sm.ship_to_id and st.organization_id=staged.organization_id where cm.id=staged.customer_mapping_id returning id into inserted_order_id;
  if inserted_order_id is null then raise exception 'Confirmed customer or ship-to record was not found.'; end if;
  insert into public.order_lines (order_id,item_id,external_sku,vendor_item,internal_item_id,description,quantity_cases,unit_price,uom,sps_staged_order_line_id,source_line_number,gtin,sps_source_unit_price,price_resolution_action)
  select inserted_order_id,m.item_id,l.buyer_part_number,l.vendor_item,coalesce(i.item_code,l.mapped_food_connex_item_id),coalesce(i.description,l.description,'SPS item'),l.quantity,coalesce(l.approved_circle_r_price,l.sps_purchase_price),coalesce(i.stock_uom,i.sell_uom,l.sps_uom),l.id,l.line_number,l.gtin,l.sps_purchase_price,null
  from public.sps_staged_order_lines l left join public.integration_item_mappings m on m.id=l.item_mapping_id left join public.items i on i.id=m.item_id and i.organization_id=staged.organization_id where l.staged_order_id=staged.id and l.organization_id=staged.organization_id;
  update public.sps_staged_orders set review_status='promoted', promoted_order_id=inserted_order_id, approved_by=actor.id, approved_at=now() where id=staged.id and organization_id=staged.organization_id;
  insert into public.audit_events (organization_id,actor_id,action,entity_type,entity_id,details) values (staged.organization_id,actor.id,'promoted SPS order to Lucid operational order','order',inserted_order_id::text,jsonb_build_object('staged_sps_order_id',staged.id,'operational_order_id',inserted_order_id,'business_po_number',coalesce(staged.business_po_number,staged.external_po),'document_type',staged.document_type,'sps_id',staged.sps_id));
  return query select inserted_order_id,false,'ready_for_production'::text;
end;
$$;

revoke all on function public.promote_sps_staged_order(uuid) from public, anon;
grant execute on function public.promote_sps_staged_order(uuid) to authenticated;
revoke all on function public.assert_lucid_sps_write_role() from public, anon, authenticated;
revoke all on function public.audit_lucid_sps_reconciliation_change() from public, anon, authenticated;
revoke all on function public.validate_lucid_sps_parent_scope() from public, anon, authenticated;
revoke all on function public.protect_lucid_promoted_sps_source() from public, anon, authenticated;

commit;
