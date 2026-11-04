-- Rollback-only behavioral validation for migration 024.
-- Run in Supabase SQL Editor after 024. It creates no durable test data.
begin;
create temporary table qa_024_fixture (
  admin_id uuid, organization_id uuid, office_id uuid, leadership_id uuid, production_id uuid,
  foreign_admin_id uuid, foreign_organization_id uuid, station_id uuid
) on commit drop;
grant select, insert, update, delete on table qa_024_fixture to authenticated;

-- Locate candidates before becoming authenticated; missing non-Admin profiles are SKIPPED below.
insert into qa_024_fixture (admin_id, organization_id, office_id, leadership_id, production_id, foreign_admin_id, foreign_organization_id)
select admin.id, admin.organization_id,
  (select p.id from profiles p where p.active and p.organization_id=admin.organization_id and p.role='office' limit 1),
  (select p.id from profiles p where p.active and p.organization_id=admin.organization_id and p.role='leadership' limit 1),
  (select p.id from profiles p where p.active and p.organization_id=admin.organization_id and p.role='production' limit 1),
  (select p.id from profiles p where p.active and p.organization_id<>admin.organization_id and p.role='lucid_admin' limit 1),
  (select p.organization_id from profiles p where p.active and p.organization_id<>admin.organization_id and p.role='lucid_admin' limit 1)
from profiles admin where admin.active and admin.role='lucid_admin' order by admin.created_at limit 1;

set local role authenticated;
do $$
declare f qa_024_fixture%rowtype; changed integer; denied boolean; candidate_id uuid; admin_delete_id uuid;
begin
  select * into f from qa_024_fixture;
  if f.admin_id is null then raise exception 'SKIPPED: an active Lucid Admin profile is required.'; end if;
  perform set_config('request.jwt.claim.sub', f.admin_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Admin may create, update, and delete its own QA configuration row.
  insert into production_stations (organization_id,station_code,station_name,source_system,source_record_id,is_historical)
  values (f.organization_id,'QA-024-STATION','QA 024 role isolation station','lucid_qa','QA-024-STATION',false)
  returning id into f.station_id;
  update qa_024_fixture set station_id=f.station_id;
  update production_stations set station_name='QA 024 admin updated station' where id=f.station_id;
  if (select station_name from production_stations where id=f.station_id) <> 'QA 024 admin updated station' then raise exception 'Admin update failed.'; end if;
  insert into production_stations (organization_id,station_code,station_name,source_system,source_record_id,is_historical)
  values (f.organization_id,'QA-024-DELETE','QA 024 admin delete check','lucid_qa','QA-024-DELETE',false)
  returning id into admin_delete_id;
  delete from production_stations where id=admin_delete_id;
  if exists (select 1 from production_stations where id=admin_delete_id) then raise exception 'Admin delete failed.'; end if;

  -- Non-Admin direct writes must either raise or affect no rows under RLS.
  foreach candidate_id in array array[f.office_id, f.leadership_id, f.production_id] loop
    if candidate_id is null then
      raise notice 'SKIPPED: an active same-org Office, Leadership, or Production profile was not found.';
      continue;
    end if;
    perform set_config('request.jwt.claim.sub', candidate_id::text, true);
    denied := false;
    begin
      insert into production_stations (organization_id,station_code,station_name,source_system,source_record_id,is_historical)
      values (f.organization_id,'QA-024-DENIED-' || left(candidate_id::text,8),'Denied direct write','lucid_qa','QA-024-DENIED',false);
    exception when others then denied := true;
    end;
    if not denied then raise exception 'Non-Admin configuration insert was accepted.'; end if;
    update production_stations set station_name='Denied update' where id=f.station_id;
    get diagnostics changed = row_count;
    if changed <> 0 then raise exception 'Non-Admin configuration update was accepted.'; end if;
    delete from production_stations where id=f.station_id;
    get diagnostics changed = row_count;
    if changed <> 0 then raise exception 'Non-Admin configuration delete was accepted.'; end if;
  end loop;

  -- Restore Admin context before optional cross-org validation and cleanup by rollback.
  perform set_config('request.jwt.claim.sub', f.admin_id::text, true);
  if f.foreign_organization_id is null then
    raise notice 'SKIPPED: no second organization Admin profile exists for cross-org validation.';
  else
    denied := false;
    begin
      insert into production_stations (organization_id,station_code,station_name,source_system,source_record_id,is_historical)
      values (f.foreign_organization_id,'QA-024-CROSS-ORG','Cross-org denial check','lucid_qa','QA-024-CROSS-ORG',false);
    exception when others then denied := true;
    end;
    if not denied then raise exception 'Cross-organization Admin configuration insert was accepted.'; end if;
  end if;
end $$;
rollback;
