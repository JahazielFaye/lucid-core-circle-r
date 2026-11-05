-- Read-only structural check for migration 027.
with expected as (
  select 'column'::text as check_type, 'pallets.pallet_sequence'::text as object_name union all
  select 'index', 'pallets_org_order_sequence_unique' union all
  select 'function', 'create_lucid_pallet(uuid)' union all
  select 'function', 'move_lucid_case_between_pallets(uuid,uuid,text)' union all
  select 'function', 'remove_lucid_case_from_pallet(uuid,uuid,text)'
), actual as (
  select 'column'::text as check_type, 'pallets.pallet_sequence'::text as object_name
    where exists (select 1 from information_schema.columns where table_schema='public' and table_name='pallets' and column_name='pallet_sequence' and is_nullable='NO')
  union all select 'index', 'pallets_org_order_sequence_unique'
    where exists (select 1 from pg_indexes where schemaname='public' and indexname='pallets_org_order_sequence_unique')
  union all select 'function', 'create_lucid_pallet(uuid)'
    where to_regprocedure('public.create_lucid_pallet(uuid)') is not null
  union all select 'function', 'move_lucid_case_between_pallets(uuid,uuid,text)'
    where to_regprocedure('public.move_lucid_case_between_pallets(uuid,uuid,text)') is not null
  union all select 'function', 'remove_lucid_case_from_pallet(uuid,uuid,text)'
    where to_regprocedure('public.remove_lucid_case_from_pallet(uuid,uuid,text)') is not null
)
select e.check_type, count(*) as expected_checks, count(a.object_name) as passed_checks,
  count(*) - count(a.object_name) as failed_checks,
  coalesce(string_agg(e.object_name, ', ') filter (where a.object_name is null), '') as missing_objects
from expected e left join actual a using (check_type, object_name)
group by e.check_type order by e.check_type;

select p.proname, oidvectortypes(p.proargtypes) as argument_signature, p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%' as explicit_search_path,
  has_function_privilege('public', p.oid, 'EXECUTE') as public_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in ('create_lucid_pallet','add_lucid_case_to_pallet','remove_lucid_case_from_pallet','move_lucid_case_between_pallets','complete_lucid_pallet','reopen_lucid_pallet')
order by p.proname, oidvectortypes(p.proargtypes);
