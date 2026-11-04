-- Read-only post-application verification for migration 025.
-- This script only reads PostgreSQL catalogs and does not alter data or schema.
with
expected_objects(object_kind, object_name) as (
  values
    ('function'::text, 'current_org_id'::text),
    ('function'::text, 'require_lucid_admin_actor'::text),
    ('function'::text, 'prevent_inactive_organization_with_active_profiles'::text),
    ('function'::text, 'admin_create_lucid_profile'::text),
    ('function'::text, 'admin_change_lucid_profile_role'::text),
    ('function'::text, 'admin_set_lucid_profile_active'::text),
    ('policy'::text, 'organizations active current org read'::text),
    ('policy'::text, 'profiles active same org read'::text),
    ('trigger'::text, 'prevent_inactive_organization_with_active_profiles'::text),
    ('constraint'::text, 'profiles_supported_role_check'::text)
),
found_objects(object_kind, object_name) as (
  select 'function'::text as object_kind, p.proname::text as object_name from pg_proc p where p.pronamespace = 'public'::regnamespace
  union all
  select 'policy'::text as object_kind, p.polname::text as object_name from pg_policy p join pg_class c on c.oid = p.polrelid where c.relnamespace = 'public'::regnamespace
  union all
  select 'trigger'::text as object_kind, t.tgname::text as object_name from pg_trigger t where t.tgrelid = 'public.organizations'::regclass and not t.tgisinternal
  union all
  select 'constraint'::text as object_kind, c.conname::text as object_name from pg_constraint c where c.conrelid = 'public.profiles'::regclass
),
object_checks(check_type, check_name, status) as (
  select e.object_kind, e.object_name, case when f.object_name is null then 'FAIL' else 'PASS' end
  from expected_objects e
  left join found_objects f on f.object_kind = e.object_kind and f.object_name = e.object_name
),
schema_checks(check_type, check_name, status) as (
  select 'schema', 'organizations.active is boolean NOT NULL DEFAULT true',
    case when a.attname is not null and a.atttypid = 'boolean'::regtype and a.attnotnull and coalesce(pg_get_expr(d.adbin, d.adrelid), '') ~ '^true(::boolean)?$' then 'PASS' else 'FAIL' end
  from (select 1) as required
  left join pg_attribute a on a.attrelid = 'public.organizations'::regclass and a.attname = 'active' and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  union all
  select 'schema', 'profiles.updated_at exists', case when a.attname is not null then 'PASS' else 'FAIL' end
  from (select 1) as required
  left join pg_attribute a on a.attrelid = 'public.profiles'::regclass and a.attname = 'updated_at' and not a.attisdropped
),
rls_checks(check_type, check_name, status) as (
  select 'rls', 'profiles RLS enabled', case when c.relrowsecurity then 'PASS' else 'FAIL' end from pg_class c where c.oid = 'public.profiles'::regclass
  union all
  select 'profile_policy', 'same-org active-profile SELECT policy', case when exists (select 1 from pg_policy p where p.polrelid = 'public.profiles'::regclass and p.polname = 'profiles active same org read' and p.polcmd = 'r') then 'PASS' else 'FAIL' end
  union all
  select 'profile_policy', 'no generic profile INSERT/UPDATE/DELETE policy', case when not exists (select 1 from pg_policy p where p.polrelid = 'public.profiles'::regclass and p.polcmd in ('a', 'w', 'd', '*')) then 'PASS' else 'FAIL' end
),
role_constraint_checks(check_type, check_name, status) as (
  select 'role_constraint', 'profiles role vocabulary is exactly lucid_admin, leadership, office, production',
    case when c.oid is not null
      and position('role' in pg_get_constraintdef(c.oid)) > 0
      and position('lucid_admin' in pg_get_constraintdef(c.oid)) > 0
      and position('leadership' in pg_get_constraintdef(c.oid)) > 0
      and position('office' in pg_get_constraintdef(c.oid)) > 0
      and position('production' in pg_get_constraintdef(c.oid)) > 0
      and not exists (select 1 from regexp_matches(pg_get_constraintdef(c.oid), $$'([^']*)'$$, 'g') as token(value) where (token.value)[1] <> all (array['lucid_admin', 'leadership', 'office', 'production']::text[]))
    then 'PASS' else 'FAIL' end
  from (select 1) as required
  left join pg_constraint c on c.conrelid = 'public.profiles'::regclass and c.conname = 'profiles_supported_role_check'
),
function_expectations(function_signature, direct_authenticated_execute) as (
  values
    ('public.current_org_id()'::text, true),
    ('public.require_lucid_admin_actor()'::text, false),
    ('public.admin_create_lucid_profile(uuid,text,text)'::text, true),
    ('public.admin_change_lucid_profile_role(uuid,text)'::text, true),
    ('public.admin_set_lucid_profile_active(uuid,boolean)'::text, true)
),
function_checks(check_type, check_name, status) as (
  select 'function_security', e.function_signature,
    case when p.oid is not null
      and p.prosecdef
      and coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%'
      and not exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE')
      and not coalesce(has_function_privilege('anon', p.oid, 'execute'), false)
      and coalesce(has_function_privilege('authenticated', p.oid, 'execute'), false) = e.direct_authenticated_execute
    then 'PASS' else 'FAIL' end
  from function_expectations e
  left join pg_proc p on p.oid = to_regprocedure(e.function_signature)
),
internal_authorization_checks(check_type, check_name, status) as (
  select 'internal_authorization', 'require_lucid_admin_actor enforces active Lucid Admin in an active organization',
    case when p.oid is not null
      and pg_get_functiondef(p.oid) like '%p.active = true%'
      and pg_get_functiondef(p.oid) like '%o.active = true%'
      and pg_get_functiondef(p.oid) like '%actor.role <> ''lucid_admin''%'
    then 'PASS' else 'FAIL' end
  from (select 1) as required
  left join pg_proc p on p.oid = to_regprocedure('public.require_lucid_admin_actor()')
  union all
  select 'internal_authorization', 'all management RPCs call require_lucid_admin_actor',
    case when count(*) = 3 and bool_and(pg_get_functiondef(p.oid) like '%public.require_lucid_admin_actor()%') then 'PASS' else 'FAIL' end
  from pg_proc p
  where p.oid in (
    to_regprocedure('public.admin_create_lucid_profile(uuid,text,text)'),
    to_regprocedure('public.admin_change_lucid_profile_role(uuid,text)'),
    to_regprocedure('public.admin_set_lucid_profile_active(uuid,boolean)')
  )
),
all_checks as (
  select * from object_checks
  union all select * from schema_checks
  union all select * from rls_checks
  union all select * from role_constraint_checks
  union all select * from function_checks
  union all select * from internal_authorization_checks
)
select check_type, count(*) as expected_checks, count(*) filter (where status = 'PASS') as passed_checks, count(*) filter (where status = 'FAIL') as failed_checks, string_agg(check_name, ', ' order by check_name) filter (where status = 'FAIL') as missing_objects
from all_checks
group by check_type
order by check_type;

-- Detail for RLS policy review. Profiles must have only the SELECT policy shown;
-- controlled SECURITY DEFINER RPCs perform all profile writes.
select c.relname as table_name, p.polname as policy_name, p.polcmd as policy_command, pg_get_expr(p.polqual, p.polrelid) as using_expression, pg_get_expr(p.polwithcheck, p.polrelid) as with_check_expression
from pg_policy p
join pg_class c on c.oid = p.polrelid
where c.oid in ('public.profiles'::regclass, 'public.organizations'::regclass)
order by c.relname, p.polname;

-- The three administration RPCs rely on their internal active same-org Lucid
-- Admin check. The helper is intentionally not directly executable by users.
with function_expectations(function_signature, direct_authenticated_execute) as (
  values
    ('public.current_org_id()'::text, true),
    ('public.require_lucid_admin_actor()'::text, false),
    ('public.admin_create_lucid_profile(uuid,text,text)'::text, true),
    ('public.admin_change_lucid_profile_role(uuid,text)'::text, true),
    ('public.admin_set_lucid_profile_active(uuid,boolean)'::text, true)
)
select e.function_signature, p.oid is not null as exists, p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%' as explicit_search_path,
  exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as acl where acl.grantee = 0 and acl.privilege_type = 'EXECUTE') as public_can_execute,
  coalesce(has_function_privilege('anon', p.oid, 'execute'), false) as anon_can_execute,
  coalesce(has_function_privilege('authenticated', p.oid, 'execute'), false) as authenticated_can_execute,
  e.direct_authenticated_execute as expected_authenticated_execute
from function_expectations e
left join pg_proc p on p.oid = to_regprocedure(e.function_signature)
order by e.function_signature;

select c.conname, pg_get_constraintdef(c.oid) as constraint_definition
from pg_constraint c
where c.conrelid = 'public.profiles'::regclass and c.conname = 'profiles_supported_role_check';
