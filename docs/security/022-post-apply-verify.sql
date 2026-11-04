-- Read-only structural verification for migration 022. Run only after applying 022.
with expected(kind, name) as (
  values
    ('table','production_stations'),('table','item_weight_bands'),('table','item_packaging_instructions'),('table','production_weight_readings'),('table','production_case_weight_events'),
    ('function','create_lucid_manual_weight_reading'),('function','create_lucid_production_case_from_weight_reading'),('function','record_lucid_case_weight_correction'),
    ('trigger','prevent_lucid_weight_reading_mutation'),('trigger','prevent_lucid_weight_event_mutation'),('index','production_weight_readings_operation_key_idx'),('index','production_cases_weight_operation_key_idx')
), found as (
  select 'table'::text kind, c.relname name from pg_class c where c.relkind='r' and c.relnamespace='public'::regnamespace
  union all select 'function', p.proname from pg_proc p where p.pronamespace='public'::regnamespace
  union all select 'trigger', t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and c.relnamespace='public'::regnamespace
  union all select 'index', c.relname from pg_class c where c.relkind='i' and c.relnamespace='public'::regnamespace
)
select e.kind, e.name, case when f.name is null then 'FAIL' else 'PASS' end as status
from expected e left join found f using(kind,name) order by kind,name;

select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name in ('production_cases','production_weight_readings','production_case_weight_events')
  and column_name in ('production_station_id','weight_operation_key','weight_source','weight_captured_at','weight_reading_id','consumed_by_case_id','consumed_at')
order by table_name,column_name;

select c.relname as table_name, c.relrowsecurity as rls_enabled, p.polname as policy_name, p.polcmd as command
from pg_class c left join pg_policy p on p.polrelid=c.oid
where c.relnamespace='public'::regnamespace and c.relname in ('production_stations','item_weight_bands','item_packaging_instructions','production_weight_readings','production_case_weight_events')
order by c.relname,p.polname;

select conrelid::regclass::text as table_name, conname as constraint_name, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in ('item_identifiers'::regclass,'item_weight_bands'::regclass,'production_weight_readings'::regclass,'production_case_weight_events'::regclass)
  and contype in ('c','f')
order by table_name,constraint_name;

select p.oid::regprocedure::text as function_signature,
       p.prosecdef as security_definer,
       coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%' as explicit_search_path,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated_can_execute,
       exists (
         select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
         where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
       ) as public_can_execute
from pg_proc p
where p.oid in (
  'create_lucid_manual_weight_reading(uuid,numeric,text)'::regprocedure,
  'create_lucid_production_case_from_weight_reading(uuid,uuid,text,numeric,numeric,uuid,text,uuid)'::regprocedure,
  'record_lucid_case_weight_correction(uuid,numeric,text)'::regprocedure
)
order by function_signature;
