-- Read-only execute-privilege verification for migration 028.
select p.proname, oidvectortypes(p.proargtypes) as argument_signature,
  p.prosecdef as security_definer,
  coalesce(array_to_string(p.proconfig, ','), '') like '%search_path=public%' as explicit_search_path,
  has_function_privilege('public', p.oid, 'EXECUTE') as public_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
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
order by p.proname, argument_signature;
