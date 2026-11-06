-- Rollback-only backend authorization validation for the pallet workflow.
-- Prerequisites: migrations 013–029 and active same-organization Admin,
-- Office, Leadership, and Production profiles. This script creates only
-- transaction-scoped QA fixtures and always ends by rolling them back.
begin;

create temporary table qa_027_pallet_authorization_fixture (
  organization_id uuid,
  admin_id uuid,
  office_id uuid,
  leadership_id uuid,
  production_id uuid,
  order_id uuid,
  order_line_id uuid,
  production_lot_id uuid,
  first_case_id uuid,
  second_case_id uuid,
  completed_pallet_id uuid,
  building_pallet_id uuid
) on commit drop;
grant select, insert, update, delete on table qa_027_pallet_authorization_fixture to authenticated;

-- Resolve the same-organization role fixtures before switching to authenticated.
insert into qa_027_pallet_authorization_fixture (organization_id, admin_id, office_id, leadership_id, production_id)
select admin.organization_id,
  admin.id,
  (select p.id from public.profiles p where p.organization_id = admin.organization_id and p.active and p.role = 'office' limit 1),
  (select p.id from public.profiles p where p.organization_id = admin.organization_id and p.active and p.role = 'leadership' limit 1),
  (select p.id from public.profiles p where p.organization_id = admin.organization_id and p.active and p.role = 'production' limit 1)
from public.profiles admin
where admin.active and admin.role = 'lucid_admin'
order by admin.created_at
limit 1;

set local role authenticated;

do $$
declare f qa_027_pallet_authorization_fixture%rowtype;
begin
  select * into f from qa_027_pallet_authorization_fixture;
  if f.admin_id is null or f.office_id is null or f.leadership_id is null or f.production_id is null then
    raise exception 'Active same-organization Admin, Office, Leadership, and Production profiles are required.';
  end if;

  perform set_config('request.jwt.claim.sub', f.admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select qa.order_id, qa.order_line_id into f.order_id, f.order_line_id
  from public.create_lucid_qa_order(
    'QA-027-PALLET-AUTHORIZATION',
    'QA Test Customer',
    'QA Test Ship-To',
    'QA-ITEM-WORK-001',
    'QA Validation Item',
    2,
    'CS'
  ) qa;
  perform * from public.start_lucid_production(f.order_id);
  select lot.production_lot_id into f.production_lot_id
  from public.create_or_get_lucid_production_lot(f.order_id, f.order_line_id, 'QA-027-PALLET-PROD') lot;

  update qa_027_pallet_authorization_fixture
  set order_id = f.order_id, order_line_id = f.order_line_id, production_lot_id = f.production_lot_id;
end $$;

-- Build two QA cases, one completed pallet, and a second building pallet under
-- the trusted Admin context. The second case stays available for the completed
-- pallet add-denial assertion.
do $$
declare f qa_027_pallet_authorization_fixture%rowtype; first_reading uuid; second_reading uuid;
begin
  select * into f from qa_027_pallet_authorization_fixture;
  perform set_config('request.jwt.claim.sub', f.admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  select reading.weight_reading_id into first_reading
  from public.create_lucid_manual_weight_reading(f.order_id, 20.00, 'QA-027-PALLET-READING-1') reading;
  select reading.weight_reading_id into second_reading
  from public.create_lucid_manual_weight_reading(f.order_id, 20.00, 'QA-027-PALLET-READING-2') reading;
  select captured.production_case_id into f.first_case_id
  from public.create_lucid_production_case_from_weight_reading(
    f.order_id, f.order_line_id, 'QA-027-PALLET-CASE-1', 1, 20.00,
    f.production_lot_id, 'QA-027-PALLET-CASE-OP-1', first_reading
  ) captured;
  select captured.production_case_id into f.second_case_id
  from public.create_lucid_production_case_from_weight_reading(
    f.order_id, f.order_line_id, 'QA-027-PALLET-CASE-2', 1, 20.00,
    f.production_lot_id, 'QA-027-PALLET-CASE-OP-2', second_reading
  ) captured;
  select pallet.pallet_id into f.completed_pallet_id from public.create_lucid_pallet(f.order_id) pallet;
  perform * from public.add_lucid_case_to_pallet(f.completed_pallet_id, 'QA-027-PALLET-CASE-1');
  perform * from public.complete_lucid_pallet(f.completed_pallet_id);
  select pallet.pallet_id into f.building_pallet_id from public.create_lucid_pallet(f.order_id) pallet;

  update qa_027_pallet_authorization_fixture
  set first_case_id = f.first_case_id, second_case_id = f.second_case_id,
      completed_pallet_id = f.completed_pallet_id, building_pallet_id = f.building_pallet_id;
end $$;

-- Production may build a pallet, but may not add to a completed pallet. The
-- rejected RPC must not write legacy membership, durable membership, case state,
-- or a pallet audit event.
do $$
declare f qa_027_pallet_authorization_fixture%rowtype;
  legacy_before integer; durable_before integer; audit_before integer; case_pallet_before uuid; denied boolean := false;
begin
  select * into f from qa_027_pallet_authorization_fixture;
  perform set_config('request.jwt.claim.sub', f.production_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  select count(*) into legacy_before from public.pallet_cases where pallet_id = f.completed_pallet_id and production_case_id = f.second_case_id;
  select count(*) into durable_before from public.pallet_case_assignments where production_case_id = f.second_case_id and status = 'active';
  select count(*) into audit_before from public.audit_events where entity_id = f.completed_pallet_id::text and action = 'case added to pallet';
  select pallet_id into case_pallet_before from public.production_cases where id = f.second_case_id;

  begin
    perform * from public.add_lucid_case_to_pallet(f.completed_pallet_id, 'QA-027-PALLET-CASE-2');
  exception when others then
    denied := true;
  end;
  if not denied then raise exception 'FAIL: Production added a case to a completed pallet.'; end if;
  if (select count(*) from public.pallet_cases where pallet_id = f.completed_pallet_id and production_case_id = f.second_case_id) <> legacy_before
    or (select count(*) from public.pallet_case_assignments where production_case_id = f.second_case_id and status = 'active') <> durable_before
    or (select pallet_id from public.production_cases where id = f.second_case_id) is distinct from case_pallet_before
    or (select count(*) from public.audit_events where entity_id = f.completed_pallet_id::text and action = 'case added to pallet') <> audit_before then
    raise exception 'FAIL: Completed-pallet add denial left a side effect.';
  end if;
end $$;

-- Production cannot invoke any correction RPC. Each rejection must leave pallet,
-- case, durable-history, and audit state unchanged.
do $$
declare f qa_027_pallet_authorization_fixture%rowtype;
  completed_status text; first_case_pallet uuid; active_before integer; audit_before integer; denied boolean;
begin
  select * into f from qa_027_pallet_authorization_fixture;
  perform set_config('request.jwt.claim.sub', f.production_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  select status into completed_status from public.pallets where id = f.completed_pallet_id;
  select pallet_id into first_case_pallet from public.production_cases where id = f.first_case_id;
  select count(*) into active_before from public.pallet_case_assignments where production_case_id = f.first_case_id and status = 'active';
  select count(*) into audit_before from public.audit_events where entity_id in (f.completed_pallet_id::text, f.building_pallet_id::text)
    and action in ('case removed from pallet', 'case moved between pallets', 'pallet reopened for correction');

  denied := false; begin perform * from public.remove_lucid_case_from_pallet(f.completed_pallet_id, f.first_case_id, 'QA unauthorized removal'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Production removed a pallet case.'; end if;
  denied := false; begin perform * from public.move_lucid_case_between_pallets(f.first_case_id, f.building_pallet_id, 'QA unauthorized move'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Production moved a pallet case.'; end if;
  denied := false; begin perform * from public.reopen_lucid_pallet(f.completed_pallet_id, 'QA unauthorized reopen'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: Production reopened a completed pallet.'; end if;

  if (select status from public.pallets where id = f.completed_pallet_id) is distinct from completed_status
    or (select pallet_id from public.production_cases where id = f.first_case_id) is distinct from first_case_pallet
    or (select count(*) from public.pallet_case_assignments where production_case_id = f.first_case_id and status = 'active') <> active_before
    or (select count(*) from public.audit_events where entity_id in (f.completed_pallet_id::text, f.building_pallet_id::text)
      and action in ('case removed from pallet', 'case moved between pallets', 'pallet reopened for correction')) <> audit_before then
    raise exception 'FAIL: Production correction denial left a side effect.';
  end if;
end $$;

-- An authorized Office may reopen/remove, Leadership may move, and Lucid Admin
-- may move back. This also proves one active durable assignment remains.
do $$
declare f qa_027_pallet_authorization_fixture%rowtype;
begin
  select * into f from qa_027_pallet_authorization_fixture;
  perform set_config('request.jwt.claim.sub', f.office_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin perform * from public.reopen_lucid_pallet(f.completed_pallet_id, 'QA Office correction authorization'); exception when others then raise exception 'FAIL: Office could not reopen a completed pallet: %', sqlerrm; end;
  begin perform * from public.remove_lucid_case_from_pallet(f.completed_pallet_id, f.first_case_id, 'QA Office removal authorization'); exception when others then raise exception 'FAIL: Office could not remove a pallet case: %', sqlerrm; end;
  perform * from public.add_lucid_case_to_pallet(f.completed_pallet_id, 'QA-027-PALLET-CASE-1');

  perform set_config('request.jwt.claim.sub', f.leadership_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin perform * from public.move_lucid_case_between_pallets(f.first_case_id, f.building_pallet_id, 'QA Leadership move authorization'); exception when others then raise exception 'FAIL: Leadership could not move a pallet case: %', sqlerrm; end;

  perform set_config('request.jwt.claim.sub', f.admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  begin perform * from public.move_lucid_case_between_pallets(f.first_case_id, f.completed_pallet_id, 'QA Admin move authorization'); exception when others then raise exception 'FAIL: Lucid Admin could not move a pallet case: %', sqlerrm; end;
  if (select count(*) from public.pallet_case_assignments where production_case_id = f.first_case_id and status = 'active') <> 1 then
    raise exception 'FAIL: Case does not have exactly one active durable pallet assignment.';
  end if;
  if not exists (select 1 from public.audit_events where entity_id = f.completed_pallet_id::text and action = 'pallet reopened for correction')
    or not exists (select 1 from public.audit_events where action = 'case removed from pallet' and details->>'reason' = 'QA Office removal authorization')
    or not exists (select 1 from public.audit_events where action = 'case moved between pallets' and details->>'reason' = 'QA Leadership move authorization')
    or not exists (select 1 from public.audit_events where action = 'case moved between pallets' and details->>'reason' = 'QA Admin move authorization') then
    raise exception 'FAIL: Authorized correction audit history was not preserved.';
  end if;
end $$;

select 'PASS'::text as behavioral_validation,
  'Completed-pallet add denial, Production correction denials, authorized corrections, durable membership, and audit history verified; all QA fixtures will now roll back.'::text as detail;
rollback;
