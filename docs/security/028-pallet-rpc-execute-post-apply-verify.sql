-- Read-only verification of migration 028's seven exact pallet RPC ACLs.
-- Migration 029 preserves these expected permissions. No RPC is invoked.
-- Missing functions produce FAIL rather than disappearing from the result.
with expected(signature) as (
  values ('public.create_lucid_pallet(uuid)'),
         ('public.add_lucid_case_to_pallet(uuid,text)'),
         ('public.remove_lucid_case_from_pallet(uuid,uuid)'),
         ('public.remove_lucid_case_from_pallet(uuid,uuid,text)'),
         ('public.move_lucid_case_between_pallets(uuid,uuid,text)'),
         ('public.complete_lucid_pallet(uuid)'),
         ('public.reopen_lucid_pallet(uuid,text)')
), inspected as (
  select e.signature, p.oid is not null as function_exists,
    p.prosecdef as security_definer,
    coalesce('search_path=public' = any(p.proconfig), false) as explicit_search_path,
    exists (
      select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE'
    ) as public_can_execute,
    exists (
      select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
      where a.grantee = (select oid from pg_roles where rolname = 'anon')
        and a.privilege_type = 'EXECUTE'
    ) as anon_direct_execute,
    has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
  from expected e
  left join pg_proc p on p.oid = to_regprocedure(e.signature)
)
select *, case when function_exists
    and security_definer is false -- Baseline pallet RPCs are SECURITY INVOKER.
    and explicit_search_path
    and public_can_execute is false
    and anon_direct_execute is false
    and anon_can_execute is false
    and authenticated_can_execute is true
  then 'PASS' else 'FAIL' end as security_gate
from inspected
order by signature;
