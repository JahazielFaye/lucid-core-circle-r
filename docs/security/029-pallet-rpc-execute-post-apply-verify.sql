-- Read-only ACL and effective-privilege verification for pallet mutation RPCs.
with pallet_rpcs as (
  select p.oid, p.proname, oidvectortypes(p.proargtypes) as argument_signature,
    p.prosecdef as security_definer,
    coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%' as explicit_search_path,
    p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (p.proname, oidvectortypes(p.proargtypes)) in (
      ('create_lucid_pallet', 'uuid'),
      ('add_lucid_case_to_pallet', 'uuid, text'),
      ('remove_lucid_case_from_pallet', 'uuid, uuid'),
      ('remove_lucid_case_from_pallet', 'uuid, uuid, text'),
      ('move_lucid_case_between_pallets', 'uuid, uuid, text'),
      ('complete_lucid_pallet', 'uuid'),
      ('reopen_lucid_pallet', 'uuid, text')
    )
), direct_acl as (
  select r.oid,
    coalesce(string_agg(
      case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end || ':' || acl.privilege_type,
      ', ' order by case when acl.grantee = 0 then 'PUBLIC' else pg_get_userbyid(acl.grantee) end, acl.privilege_type
    ), '') as direct_acl_entries
  from pallet_rpcs r
  left join lateral aclexplode(coalesce(r.proacl, acldefault('f', (select proowner from pg_proc where oid = r.oid)))) acl on true
  group by r.oid
)
select r.proname, r.argument_signature, r.security_definer, r.explicit_search_path,
  d.direct_acl_entries,
  exists (
    select 1 from aclexplode(coalesce(r.proacl, acldefault('f', (select proowner from pg_proc where oid = r.oid)))) acl
    where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
  ) as public_can_execute,
  exists (
    select 1 from aclexplode(coalesce(r.proacl, acldefault('f', (select proowner from pg_proc where oid = r.oid)))) acl
    where acl.grantee = (select oid from pg_roles where rolname = 'anon') and acl.privilege_type = 'EXECUTE'
  ) as anon_direct_execute,
  has_function_privilege('anon', r.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', r.oid, 'EXECUTE') as authenticated_can_execute,
  case when not exists (
               select 1 from aclexplode(coalesce(r.proacl, acldefault('f', (select proowner from pg_proc where oid = r.oid)))) acl
               where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
             )
             and not has_function_privilege('anon', r.oid, 'EXECUTE')
             and has_function_privilege('authenticated', r.oid, 'EXECUTE')
       then 'PASS' else 'FAIL' end as execute_gate
from pallet_rpcs r join direct_acl d on d.oid = r.oid
order by r.proname, r.argument_signature;
