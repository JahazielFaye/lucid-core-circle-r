-- Controlled, rollback-only runtime validation for migration 022.
-- Run in Supabase SQL Editor only after migrations 013–022 are installed.
begin;
create temporary table qa_022_fixture (
  admin_id uuid, organization_id uuid, order_id uuid, order_line_id uuid,
  production_lot_id uuid, reading_id uuid, production_case_id uuid, capture_event_id uuid
) on commit drop;
-- The SQL-editor owner creates the fixture table; authenticated test context
-- requires explicit access after SET LOCAL ROLE below.
grant select, insert, update, delete on table qa_022_fixture to authenticated;
set local role authenticated;

do $$
declare admin_profile profiles%rowtype;
begin
  select p.* into admin_profile from profiles p
  where p.active and p.role = 'lucid_admin' order by p.created_at limit 1;
  if not found then raise exception 'A live active Lucid Admin profile is required for this controlled test.'; end if;
  perform set_config('request.jwt.claim.sub', admin_profile.id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  insert into qa_022_fixture (admin_id, organization_id) values (admin_profile.id, admin_profile.organization_id);
end $$;

-- Reuses only the Admin-controlled QA master fixtures; no Circle R master data is touched.
select * from prepare_lucid_qa_master_data();
update qa_022_fixture set (order_id, order_line_id) = (
  select q.order_id, q.order_line_id
  from create_lucid_qa_order('QA-022-WEIGHT-VALIDATION', 'QA Test Customer', 'QA Test Ship-To', 'QA-ITEM-WORK-001', 'QA Validation Item', 2, 'CS') q
);
select * from start_lucid_production((select order_id from qa_022_fixture));
update qa_022_fixture set production_lot_id = (
select p.production_lot_id from create_or_get_lucid_production_lot(
  (select order_id from qa_022_fixture), (select order_line_id from qa_022_fixture), 'QA-022-PROD-LOT'
) p);

-- 1–6: authoritative manual reading is server-created, unconsumed, and normalized.
update qa_022_fixture set reading_id = (
select r.weight_reading_id from create_lucid_manual_weight_reading(
  (select order_id from qa_022_fixture), 20.00, 'QA-022-WEIGHT-OP-001'
) r);
do $$
declare r production_weight_readings%rowtype; f qa_022_fixture%rowtype;
begin
  select * into f from qa_022_fixture; select * into r from production_weight_readings where id=f.reading_id;
  if r.organization_id <> f.organization_id or r.source <> 'manual' or r.weight_value <> 20.00
     or r.zero_state <> 'unknown' or r.tare_state <> 'unknown' or r.stable_state <> 'unknown'
     or r.consumed_at is not null or r.consumed_by_case_id is not null then
    raise exception '022 reading assertion failed';
  end if;
end $$;

-- 7–8: atomically create one case, immutable capture event, consumption link, and audit record.
update qa_022_fixture set (production_case_id, capture_event_id) = (
select c.production_case_id, c.weight_event_id from create_lucid_production_case_from_weight_reading(
  (select order_id from qa_022_fixture), (select order_line_id from qa_022_fixture), 'QA-022-CASE-001', 1, 20.00,
  (select production_lot_id from qa_022_fixture), 'QA-022-WEIGHT-OP-001', (select reading_id from qa_022_fixture)
) c);
do $$
declare f qa_022_fixture%rowtype;
begin
  select * into f from qa_022_fixture;
  if (select count(*) from production_cases where id=f.production_case_id) <> 1
     or (select count(*) from production_case_weight_events where production_case_id=f.production_case_id and event_type='captured') <> 1
     or not exists (select 1 from production_weight_readings where id=f.reading_id and consumed_by_case_id=f.production_case_id and consumed_at is not null)
     or not exists (select 1 from audit_events where organization_id=f.organization_id and entity_id=f.capture_event_id::text and action='production case weight captured') then
    raise exception '022 case capture assertion failed';
  end if;
end $$;

-- 9–10: same operation key returns the same durable case/event without duplicates.
do $$
declare f qa_022_fixture%rowtype; retry_case uuid; retry_event uuid; already boolean;
begin
  select * into f from qa_022_fixture;
  select production_case_id, weight_event_id, already_recorded into retry_case, retry_event, already
  from create_lucid_production_case_from_weight_reading(f.order_id,f.order_line_id,'QA-022-CASE-RETRY',1,20.00,f.production_lot_id,'QA-022-WEIGHT-OP-001',f.reading_id);
  if not already or retry_case <> f.production_case_id or retry_event <> f.capture_event_id
     or (select count(*) from production_cases where organization_id=f.organization_id and weight_operation_key='QA-022-WEIGHT-OP-001') <> 1 then
    raise exception '022 idempotency assertion failed';
  end if;
end $$;

-- 11–16: consumed reading reuse and invalid weights are rejected with no persisted side effects.
do $$
declare f qa_022_fixture%rowtype; failed boolean := false;
begin
  select * into f from qa_022_fixture;
  begin
    perform * from create_lucid_production_case_from_weight_reading(f.order_id,f.order_line_id,'QA-022-CASE-REUSE',1,20.00,f.production_lot_id,'QA-022-WEIGHT-OP-002',f.reading_id);
  exception when others then failed := true; end;
  if not failed then raise exception 'Consumed reading reuse was accepted'; end if;
  begin perform * from create_lucid_manual_weight_reading(f.order_id,0,'QA-022-WEIGHT-ZERO'); exception when others then failed := true; else raise exception 'Zero reading was accepted'; end;
  begin perform * from create_lucid_manual_weight_reading(f.order_id,-1,'QA-022-WEIGHT-NEGATIVE'); exception when others then failed := true; else raise exception 'Negative reading was accepted'; end;
end $$;

-- 17–18: correction is append-only; original capture stays intact and operational weight changes.
do $$
declare f qa_022_fixture%rowtype; correction_id uuid;
begin
  select * into f from qa_022_fixture;
  select weight_event_id into correction_id from record_lucid_case_weight_correction(f.production_case_id,19.50,'QA 022 controlled correction');
  if (select net_weight from production_cases where id=f.production_case_id) <> 19.50
     or (select count(*) from production_case_weight_events where production_case_id=f.production_case_id and event_type='captured' and net_weight=20.00) <> 1
     or not exists (select 1 from production_case_weight_events where id=correction_id and event_type='corrected' and original_net_weight=20.00 and net_weight=19.50 and correction_reason='QA 022 controlled correction')
     or not exists (select 1 from audit_events where entity_id=correction_id::text and action='production case weight corrected') then
    raise exception '022 correction assertion failed';
  end if;
end $$;

-- Cross-organization station/reading and role-isolation tests require independently provisioned active profiles.
-- Run those as separate authenticated sessions; they cannot be truthfully simulated by changing a JWT claim inside one SQL-editor transaction.
rollback;
