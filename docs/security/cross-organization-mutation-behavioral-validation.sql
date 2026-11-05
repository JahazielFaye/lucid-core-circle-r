-- Cross-organization mutation-isolation validation (rollback only).
--
-- Preconditions: migrations 001–026 are installed; two active Lucid Admin
-- profiles exist for Circle R Beef and lucid-qa-isolation. Run only in the
-- Supabase SQL Editor. This script never commits test data.
begin;

create temporary table qa_xorg_fixture (
  org_a uuid, admin_a uuid, org_b uuid, admin_b uuid,
  customer_a uuid, customer_b uuid, item_a uuid, item_b uuid,
  ship_to_a uuid, ship_to_b uuid, station_a uuid, station_b uuid, band_b uuid, packaging_b uuid,
  order_b uuid, line_b uuid, lot_b uuid, run_b uuid, reading_b uuid,
  case_b uuid, inventory_tx_b uuid, inventory_lot_b uuid, pallet_b uuid, shipment_b uuid
) on commit drop;
grant select, insert, update, delete on table qa_xorg_fixture to authenticated;

-- Resolve identities before adopting the authenticated role. The fixture itself
-- is visible only for this transaction and carries no operational production IDs.
insert into qa_xorg_fixture (org_a, admin_a, org_b, admin_b)
select a.organization_id, a.id, b.organization_id, b.id
from public.profiles a
join public.organizations ao on ao.id = a.organization_id
join public.profiles b on b.role = 'lucid_admin' and b.active = true
join public.organizations bo on bo.id = b.organization_id
where a.role = 'lucid_admin' and a.active = true
  and ao.name = 'Circle R Beef'
  and bo.slug = 'lucid-qa-isolation'
limit 1;

set local role authenticated;

do $$
declare f qa_xorg_fixture%rowtype;
begin
  select * into f from qa_xorg_fixture;
  if f.admin_a is null or f.admin_b is null then
    raise exception 'Prerequisite unavailable: active Admins for Circle R Beef and lucid-qa-isolation are required.';
  end if;

  -- Create only rollback-scoped, clearly labelled fixtures in each tenant.
  perform set_config('request.jwt.claim.sub', f.admin_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into customers (organization_id,customer_code,name,source_system,source_record_id,is_historical)
    values (f.org_a,'QA-XORG-A-CUST','QA XORG A Customer','lucid_qa','QA-XORG-A-CUST',false) returning id into f.customer_a;
  insert into customer_ship_tos (organization_id,customer_id,location_code,name,source_system,source_record_id,is_historical)
    values (f.org_a,f.customer_a,'QA-XORG-A-SHIP','QA XORG A Ship-To','lucid_qa','QA-XORG-A-SHIP',false) returning id into f.ship_to_a;
  insert into items (organization_id,item_code,description,catch_weight,stock_uom,sell_uom,source_system,source_record_id,is_historical)
    values (f.org_a,'QA-XORG-A-ITEM','QA XORG A Item',true,'CS','CS','lucid_qa','QA-XORG-A-ITEM',false) returning id into f.item_a;
  insert into item_identifiers (organization_id,item_id,identifier_type,identifier_value,uom,source_system,source_record_id,is_historical)
    values (f.org_a,f.item_a,'other','QA-XORG-A-ID','CS','lucid_qa','QA-XORG-A-ID',false);
  insert into production_stations (organization_id,station_code,station_name,source_system,source_record_id,is_historical)
    values (f.org_a,'QA-XORG-A-STATION','QA XORG A Station','lucid_qa','QA-XORG-A-STATION',false) returning id into f.station_a;

  perform set_config('request.jwt.claim.sub', f.admin_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into customers (organization_id,customer_code,name,source_system,source_record_id,is_historical)
    values (f.org_b,'QA-XORG-B-CUST','QA XORG B Customer','lucid_qa','QA-XORG-B-CUST',false) returning id into f.customer_b;
  insert into customer_ship_tos (organization_id,customer_id,location_code,name,source_system,source_record_id,is_historical)
    values (f.org_b,f.customer_b,'QA-XORG-B-SHIP','QA XORG B Ship-To','lucid_qa','QA-XORG-B-SHIP',false) returning id into f.ship_to_b;
  insert into items (organization_id,item_code,description,catch_weight,stock_uom,sell_uom,source_system,source_record_id,is_historical)
    values (f.org_b,'QA-XORG-B-ITEM','QA XORG B Item',true,'CS','CS','lucid_qa','QA-XORG-B-ITEM',false) returning id into f.item_b;
  insert into item_identifiers (organization_id,item_id,identifier_type,identifier_value,uom,source_system,source_record_id,is_historical)
    values (f.org_b,f.item_b,'other','QA-XORG-B-ID','CS','lucid_qa','QA-XORG-B-ID',false);
  insert into production_stations (organization_id,station_code,station_name,source_system,source_record_id,is_historical)
    values (f.org_b,'QA-XORG-B-STATION','QA XORG B Station','lucid_qa','QA-XORG-B-STATION',false) returning id into f.station_b;
  insert into item_weight_bands (organization_id,item_id,target_weight,weight_uom,policy_mode)
    values (f.org_b,f.item_b,1,'LB','warning') returning id into f.band_b;
  insert into item_packaging_instructions (organization_id,item_id,container,status)
    values (f.org_b,f.item_b,'QA XORG container','active') returning id into f.packaging_b;
  update qa_xorg_fixture set (customer_a,customer_b,item_a,item_b,ship_to_a,ship_to_b,station_a,station_b,band_b,packaging_b) =
    (f.customer_a,f.customer_b,f.item_a,f.item_b,f.ship_to_a,f.ship_to_b,f.station_a,f.station_b,f.band_b,f.packaging_b);
end $$;

-- The assertions intentionally allow either an explicit exception (trigger/RPC)
-- or zero affected rows (RLS). Both are valid denials; every accepted mutation
-- raises an assertion failure.
do $$
declare f qa_xorg_fixture%rowtype; denied boolean; changed integer;
begin
  select * into f from qa_xorg_fixture;

  -- Org A → Org B: master data INSERT/UPDATE/DELETE plus foreign-parent link.
  perform set_config('request.jwt.claim.sub', f.admin_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  denied := false;
  begin insert into customers (organization_id,customer_code,name,source_system,source_record_id,is_historical)
    values (f.org_b,'QA-XORG-A-TO-B','Denied','lucid_qa','QA-XORG-A-TO-B',false); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A inserted an Org B customer.'; end if;
  update customers set name='Denied' where id=f.customer_b; get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: Org A updated an Org B customer.'; end if;
  delete from customers where id=f.customer_b; get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: Org A deleted an Org B customer.'; end if;
  denied := false;
  begin insert into customer_ship_tos (organization_id,customer_id,location_code,name,source_system,source_record_id,is_historical)
    values (f.org_a,f.customer_b,'QA-XORG-CROSS','Denied cross tenant','lucid_qa','QA-XORG-CROSS',false); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A created an Org A ship-to for an Org B customer.'; end if;
  denied := false;
  begin insert into item_identifiers (organization_id,item_id,identifier_type,identifier_value,source_system,source_record_id,is_historical)
    values (f.org_a,f.item_b,'other','QA-XORG-CROSS-ID','lucid_qa','QA-XORG-CROSS-ID',false); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A created an identifier for an Org B item.'; end if;

  -- Org A → Org B: direct scanner configuration is denied through real RLS.
  denied := false;
  begin insert into production_stations (organization_id,station_code,station_name,source_system,source_record_id,is_historical)
    values (f.org_b,'QA-XORG-A-TO-B-STATION','Denied','lucid_qa','QA-XORG-A-TO-B-STATION',false); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A inserted Org B station configuration.'; end if;
  update production_stations set station_name='Denied' where id=f.station_b; get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: Org A updated Org B station configuration.'; end if;
  delete from production_stations where id=f.station_b; get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: Org A deleted Org B station configuration.'; end if;
  update item_weight_bands set target_weight=2 where id=f.band_b; get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: Org A updated an Org B weight band.'; end if;
  delete from item_packaging_instructions where id=f.packaging_b; get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: Org A deleted an Org B packaging instruction.'; end if;

  -- Org B → Org A mirrors the distinct master-data and scanner enforcement paths.
  perform set_config('request.jwt.claim.sub', f.admin_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  denied := false;
  begin insert into customers (organization_id,customer_code,name,source_system,source_record_id,is_historical)
    values (f.org_a,'QA-XORG-B-TO-A','Denied','lucid_qa','QA-XORG-B-TO-A',false); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org B inserted an Org A customer.'; end if;
  update items set description='Denied' where id=f.item_a; get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: Org B updated an Org A item.'; end if;
  delete from production_stations where id=f.station_a; get diagnostics changed = row_count;
  if changed <> 0 then raise exception 'FAIL: Org B deleted Org A station configuration.'; end if;
end $$;

-- Admin RPCs never accept an organization parameter and must not target a
-- foreign profile. The existing B Admin is deliberately used as the target;
-- no profile is created or changed on a successful denial.
do $$
declare f qa_xorg_fixture%rowtype; denied boolean;
begin
  select * into f from qa_xorg_fixture;
  perform set_config('request.jwt.claim.sub', f.admin_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  denied := false; begin perform * from admin_create_lucid_profile(f.admin_b,'QA cross-org denial','production'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A Admin adopted an Org B profile.'; end if;
  denied := false; begin perform * from admin_change_lucid_profile_role(f.admin_b,'production'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A Admin changed an Org B role.'; end if;
  denied := false; begin perform * from admin_set_lucid_profile_active(f.admin_b,false); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A Admin changed Org B active state.'; end if;
end $$;

-- High-value RPC target checks: the foreign IDs are real rollback fixtures, so
-- a successful call would prove an actual tenant-boundary defect. The complete
-- production/inventory/shipping mutation paths are separately source-regressed
-- by tests/cross-organization-authorization.test.mjs.
do $$
declare f qa_xorg_fixture%rowtype; denied boolean;
begin
  select * into f from qa_xorg_fixture;
  perform set_config('request.jwt.claim.sub', f.admin_b::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into orders (organization_id,external_po,customer,source,status,source_system,source_record_id,is_historical)
    values (f.org_b,'QA-XORG-B-ORDER','QA XORG B Customer','qa','ready_for_production','lucid_qa','QA-XORG-B-ORDER',false) returning id into f.order_b;
  insert into order_lines (order_id,internal_item_id,description,quantity_cases,uom,source_system,source_record_id,is_historical,item_id)
    values (f.order_b,'QA-XORG-B-ITEM','QA XORG B Item',2,'CS','lucid_qa','QA-XORG-B-LINE',false,f.item_b) returning id into f.line_b;
  perform * from start_lucid_production(f.order_b);
  select production_lot_id into f.lot_b from create_or_get_lucid_production_lot(f.order_b,f.line_b,'QA-XORG-B-PROD');
  select weight_reading_id into f.reading_b from create_lucid_manual_weight_reading(f.order_b,1.00,'QA-XORG-B-READING');
  select production_case_id into f.case_b from create_lucid_production_case_from_weight_reading(
    f.order_b,f.line_b,'QA-XORG-B-CASE',1,1.00,f.lot_b,'QA-XORG-B-CASE-OP',f.reading_b
  );
  select production_run_id into f.run_b from create_lucid_production_run(f.order_b,f.lot_b,'QA-XORG-B-ITEM','QA-XORG-B-RUN');
  select inventory_transaction_id, inventory_lot_id into f.inventory_tx_b, f.inventory_lot_b
    from create_lucid_qa_receipt('QA-XORG-B-RECEIPT','QA-XORG-B-ITEM','QA-XORG-B-INPUT',2,'CS',2,'LB',null,'QA-XORG-B-RECEIPT');
  perform * from post_lucid_inventory_transaction(f.inventory_tx_b);
  select pallet_id into f.pallet_b from create_lucid_pallet(f.order_b);
  select shipment_id into f.shipment_b from create_lucid_shipment(f.order_b,'QA-XORG-B-BOL',null,null);
  update qa_xorg_fixture set (order_b,line_b,lot_b,reading_b,case_b,run_b,inventory_tx_b,inventory_lot_b,pallet_b,shipment_b)=
    (f.order_b,f.line_b,f.lot_b,f.reading_b,f.case_b,f.run_b,f.inventory_tx_b,f.inventory_lot_b,f.pallet_b,f.shipment_b);

  perform set_config('request.jwt.claim.sub', f.admin_a::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  denied := false; begin perform * from create_lucid_manual_weight_reading(f.order_b,1.00,'QA-XORG-A-FOREIGN-READING'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A captured a reading for an Org B order.'; end if;
  denied := false; begin perform * from create_lucid_production_case_from_weight_reading(f.order_b,f.line_b,'QA-XORG-A-FOREIGN-CASE',1,1.00,f.lot_b,'QA-XORG-A-FOREIGN-CASE',f.reading_b); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A created a case from an Org B reading/context.'; end if;
  denied := false; begin perform * from record_lucid_case_weight_correction(f.case_b,1.25,'QA XORG foreign correction'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A corrected an Org B case.'; end if;
  denied := false; begin perform * from record_lucid_production_consumption(f.run_b,f.inventory_lot_b,'QA-XORG-B-ITEM',1,'CS',1,'LB','QA-XORG-A-FOREIGN-CONSUMPTION'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A recorded consumption against an Org B run or lot.'; end if;
  denied := false; begin perform * from record_lucid_production_output(f.run_b,'QA-XORG-B-ITEM',1,'CS',1,'LB'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A recorded output against an Org B run.'; end if;
  denied := false; begin perform link_lucid_case_to_production_run(f.case_b,f.run_b); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A linked an Org B case to an Org B run.'; end if;
  denied := false; begin perform * from allocate_lucid_case(f.order_b,f.line_b,f.case_b); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A allocated an Org B case.'; end if;
  denied := false; begin perform * from add_lucid_case_to_pallet(f.pallet_b,'QA-XORG-B-CASE'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A assigned an Org B case to an Org B pallet.'; end if;
  denied := false; begin perform * from create_lucid_shipment(f.order_b,'QA-XORG-A-FOREIGN-BOL',null,null); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A created a shipment for an Org B order.'; end if;
  denied := false; begin perform * from add_lucid_shipment_content(f.shipment_b,f.case_b,null); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Org A added content to an Org B shipment.'; end if;
end $$;

select 'PASS'::text as result,
  'cross-organization direct-table, master-data, scanner, Admin-RPC, production, inventory, allocation, pallet, and shipment target denials verified; all fixtures will roll back'::text as detail;
rollback;
