-- Read-only verification for migration 024.
-- Expected: all rows return PASS and each configuration table has RLS enabled.
with expected(table_name, policy_name, command) as (
  values
    ('production_stations','scanner stations read same org','SELECT'),
    ('production_stations','scanner stations admin insert','INSERT'),
    ('production_stations','scanner stations admin update','UPDATE'),
    ('production_stations','scanner stations admin delete','DELETE'),
    ('item_weight_bands','scanner bands read same org','SELECT'),
    ('item_weight_bands','scanner bands admin insert','INSERT'),
    ('item_weight_bands','scanner bands admin update','UPDATE'),
    ('item_weight_bands','scanner bands admin delete','DELETE'),
    ('item_packaging_instructions','scanner packaging read same org','SELECT'),
    ('item_packaging_instructions','scanner packaging admin insert','INSERT'),
    ('item_packaging_instructions','scanner packaging admin update','UPDATE'),
    ('item_packaging_instructions','scanner packaging admin delete','DELETE')
), policies as (
  select c.relname as table_name, p.polname as policy_name,
    case p.polcmd when 'r' then 'SELECT' when 'a' then 'INSERT' when 'w' then 'UPDATE' when 'd' then 'DELETE' else p.polcmd::text end as command,
    coalesce(pg_get_expr(p.polqual,p.polrelid),'') || ' ' || coalesce(pg_get_expr(p.polwithcheck,p.polrelid),'') as expression
  from pg_policy p join pg_class c on c.oid=p.polrelid
  where c.relnamespace='public'::regnamespace
), checks as (
  select 'policy'::text check_type, e.table_name || '.' || e.policy_name as object_name,
    case when p.policy_name is not null then 'PASS' else 'FAIL' end as status
  from expected e left join policies p using(table_name,policy_name,command)
  union all
  select 'admin_write_expression', p.table_name || '.' || p.policy_name,
    case when p.expression like '%lucid_admin%' and p.expression like '%current_org_id%' then 'PASS' else 'FAIL' end
  from policies p where p.policy_name like 'scanner % admin %'
  union all
  select 'rls', c.relname, case when c.relrowsecurity then 'PASS' else 'FAIL' end
  from pg_class c where c.relnamespace='public'::regnamespace and c.relname in ('production_stations','item_weight_bands','item_packaging_instructions')
  union all
  select 'trigger_function', p.proname,
    case when pg_get_functiondef(p.oid) like '%actor.role <> ''lucid_admin''%' then 'PASS' else 'FAIL' end
  from pg_proc p where p.oid='public.assert_lucid_scanning_scope()'::regprocedure
)
select check_type, count(*) as expected_checks,
  count(*) filter (where status='PASS') as passed_checks,
  count(*) filter (where status='FAIL') as failed_checks,
  string_agg(object_name, ', ' order by object_name) filter (where status='FAIL') as missing_objects
from checks group by check_type order by check_type;

-- The old broad policies must be absent and the current policies visible for review.
select c.relname as table_name, p.polname, p.polcmd,
  pg_get_expr(p.polqual,p.polrelid) as using_expression,
  pg_get_expr(p.polwithcheck,p.polrelid) as with_check_expression
from pg_policy p join pg_class c on c.oid=p.polrelid
where c.relnamespace='public'::regnamespace
  and c.relname in ('production_stations','item_weight_bands','item_packaging_instructions')
order by c.relname,p.polname;
