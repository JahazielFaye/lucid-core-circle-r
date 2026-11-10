-- Read-only catalog gate. No application RPC is invoked; run only in verified staging.
WITH reviewed(name) AS (SELECT unnest(ARRAY['audit_events','case_pick_allocations','conversation_members','conversations','customer_contacts','customer_items','customer_review_manifest_approvals','customer_review_manifests','customer_ship_tos','customers','documents','exceptions','integration_customer_mappings','integration_import_batches','integration_item_mappings','integration_ship_to_mappings','inventory_lots','inventory_transaction_lines','inventory_transactions','item_identifiers','item_packaging_instructions','item_weight_bands','items','message_reads','messages','order_lines','orders','organizations','pallet_case_assignments','pallet_cases','pallets','production_case_weight_events','production_cases','production_lots','production_run_consumptions','production_run_outputs','production_runs','production_stations','production_weight_readings','profiles','shipment_contents','shipments','sps_order_exceptions','sps_staged_order_lines','sps_staged_orders','vendor_items','vendors','warehouses']::text[])),
sps(name) AS (VALUES ('sps_staged_orders'),('sps_staged_order_lines'),('sps_order_exceptions'),('integration_customer_mappings'),('integration_ship_to_mappings'),('integration_item_mappings')),
rpcs(signature,owner_name) AS (VALUES
 ('public.promote_sps_staged_order(uuid)','lucid_sps_promoter'),
 ('public.create_lucid_qa_order(text,text,text,text,text,numeric,text)','lucid_sps_promoter'),
 ('public.start_lucid_production(uuid)','lucid_order_operator'),
 ('public.complete_lucid_production(uuid)','lucid_order_operator')),
checks(label,passed,detail) AS (
 SELECT '48-table inventory',
   (SELECT array_agg(c.relname::text ORDER BY c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r')
    = (SELECT array_agg(name ORDER BY name) FROM reviewed), 'Exact reviewed application-table allowlist'
 UNION ALL SELECT 'RLS enabled: '||r.name,coalesce(c.relrowsecurity,false),'RLS must remain enabled'
  FROM reviewed r LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||r.name)
 UNION ALL SELECT '030 source identity',EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='sps_staged_orders' AND column_name='source_document_key'),'Requires 030 foundation'
 UNION ALL SELECT 'SPS write-role trigger: '||s.name,
  EXISTS(SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=to_regclass('public.'||s.name) AND NOT t.tgisinternal AND t.tgenabled<>'D' AND p.proname='assert_lucid_sps_write_role'),'Role gate retained independently of base ACL'
 FROM sps s

 UNION ALL SELECT 'Executor identity',current_user='postgres','Owner of reviewed application objects required'
 UNION ALL SELECT 'PostgreSQL MAINTAIN support',current_setting('server_version_num')::int>=170000,'031 uses PostgreSQL 17+ table MAINTAIN privilege'
 UNION ALL SELECT 'Role creation prerequisite',coalesce((SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user),false),'Custom roles must be supported; do not use a bypass owner workaround'
 UNION ALL SELECT 'Public CREATE delegation',has_schema_privilege(current_user,'public','CREATE WITH GRANT OPTION'),'Temporary ownership bootstrap must be grantable'
 UNION ALL SELECT 'Actor helper owner auth access',has_schema_privilege(current_user,'auth','USAGE'),'Existing executor access only; private roles receive no auth USAGE'
 UNION ALL SELECT 'auth.uid helper-owner execution',has_function_privilege(current_user,'auth.uid()','EXECUTE'),'Only helper owner requires existing auth.uid EXECUTE; no delegation'
 UNION ALL SELECT 'Private names unused',NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('lucid_sps_promoter','lucid_order_operator')),'Existing names require independent review; never adopted'
 UNION ALL SELECT 'RPC signature/ownership: '||r.signature,coalesce(p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user),false),'Executor owns exact signature; replacement/transfer supported' FROM rpcs r LEFT JOIN pg_proc p ON p.oid=to_regprocedure(r.signature)
 UNION ALL SELECT 'RPC extension dependency: '||r.signature,NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=to_regprocedure(r.signature) AND d.deptype='e'),'Application RPC must not be extension-owned' FROM rpcs r
 UNION ALL SELECT 'No unreviewed column ACL',NOT EXISTS(SELECT 1 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace,LATERAL aclexplode(a.attacl) x WHERE n.nspname='public' AND c.relkind='r' AND (x.grantee=0 OR x.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')))),'Table REVOKE does not remove independent column grants; abort if present'
 UNION ALL SELECT 'No orphan staged children',NOT EXISTS(SELECT 1 FROM public.sps_staged_order_lines l LEFT JOIN public.sps_staged_orders s ON s.id=l.staged_order_id WHERE s.id IS NULL OR s.organization_id<>l.organization_id),'No cleanup/backfill is authorized'
 UNION ALL SELECT 'Promotion pointers compatible',NOT EXISTS(SELECT 1 FROM public.sps_staged_orders s LEFT JOIN public.orders o ON o.id=s.promoted_order_id WHERE s.promoted_order_id IS NOT NULL AND (o.id IS NULL OR o.organization_id<>s.organization_id OR s.review_status<>'promoted')),'Existing promotion pointers must remain preserved'
 UNION ALL SELECT 'Table ownership',NOT EXISTS(SELECT 1 FROM reviewed r JOIN pg_class c ON c.oid=to_regclass('public.'||r.name) WHERE c.relowner<>(SELECT oid FROM pg_roles WHERE rolname=current_user)),'Reviewed executor must control the explicit ACL cleanup'

 UNION ALL SELECT 'No unbounded global table defaults',NOT EXISTS(SELECT 1 FROM pg_default_acl d,LATERAL aclexplode(d.defaclacl) a WHERE d.defaclrole=(SELECT oid FROM pg_roles WHERE rolname='postgres') AND d.defaclnamespace=0 AND d.defaclobjtype='r' AND (a.grantee=0 OR a.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')))),'A schema-level REVOKE cannot undo global default grants; outside approved scope'
 UNION ALL SELECT 'SPS RLS same-org policy: '||s.name,EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=to_regclass('public.'||s.name) AND p.polcmd='*' AND 0=ANY(p.polroles) AND pg_get_expr(p.polqual,p.polrelid) LIKE '%organization_id = current_org_id()%' AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%organization_id = current_org_id()%'),'Private owners remain subject to PUBLIC same-org RLS' FROM sps s
 UNION ALL SELECT 'Actor helper name unused',NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='lucid_request_actor_id'),'No signature or overload may be silently adopted'
 UNION ALL SELECT 'Actor-bound audit INSERT policy',EXISTS(SELECT 1 FROM pg_policy p WHERE p.polrelid=to_regclass('public.audit_events') AND p.polname='audit insert own actor' AND p.polcmd='a' AND p.polroles=ARRAY[0]::oid[] AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%organization_id = current_org_id()%' AND pg_get_expr(p.polwithcheck,p.polrelid) LIKE '%actor_id = auth.uid()%'),'Only actor lookup changes; same-org/own-actor predicate preserved'
 UNION ALL SELECT 'RLS organization helper boundary',coalesce((SELECT p.prosecdef AND p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND p.prosrc LIKE '%auth.uid()%' AND p.prosrc LIKE '%p.active = true%' AND p.prosrc LIKE '%o.active = true%' FROM pg_proc p WHERE p.oid=to_regprocedure('public.current_org_id()')),false),'Existing trusted RLS helper encapsulates its own auth dependency'
 UNION ALL SELECT 'No PUBLIC Auth USAGE',NOT EXISTS(SELECT 1 FROM pg_namespace n,LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a WHERE n.nspname='auth' AND a.grantee=0 AND a.privilege_type='USAGE'),'New private roles must not inherit auth access via PUBLIC'
 UNION ALL SELECT 'Browser roles cannot log in directly',NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ('anon','authenticated') AND rolcanlogin),'HTTP request JWT context is server-established; arbitrary database sessions are outside this boundary'
 UNION ALL SELECT 'SPS invoker identity gate ownership',coalesce((SELECT p.proowner=(SELECT oid FROM pg_roles WHERE rolname=current_user) AND NOT p.prosecdef FROM pg_proc p WHERE p.oid=to_regprocedure('public.assert_lucid_sps_write_role()')),false),'Executor can replace the actor lookup without elevating trigger privileges'

 UNION ALL SELECT 'Managed creator-admin membership prerequisite',NOT coalesce((SELECT rolsuper FROM pg_roles WHERE rolname=current_user),true) AND EXISTS(SELECT 1 FROM pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper),'Only PostgreSQL automatic ADMIN TRUE/INHERIT FALSE/SET FALSE grant to postgres is permitted after self-grant cleanup'

)
SELECT jsonb_build_object('checks',jsonb_agg(jsonb_build_object('check',label,'result',CASE WHEN coalesce(passed,false) THEN 'PASS' ELSE 'FAIL' END,'detail',detail) ORDER BY label),
 'failed_checks',count(*) FILTER(WHERE NOT coalesce(passed,false)),
 'release_decision',CASE WHEN bool_and(coalesce(passed,false)) THEN 'SAFE TO APPLY 031' ELSE 'BLOCKERS FOUND' END) AS verification
FROM checks;

-- Current effective ACL state and public CREATE are returned without changing them.
SELECT c.relname,r.rolname,p.privilege,has_table_privilege(r.oid,c.oid,p.privilege) AS effective
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
CROSS JOIN (SELECT oid,rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')) r
CROSS JOIN (VALUES('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'),('MAINTAIN')) p(privilege)
WHERE n.nspname='public' AND c.relname IN ('sps_staged_orders','sps_staged_order_lines','sps_order_exceptions','integration_customer_mappings','integration_ship_to_mappings','integration_item_mappings','orders','order_lines','audit_events') ORDER BY c.relname,r.rolname,p.privilege;
SELECT r.rolname,has_schema_privilege(r.oid,'public','CREATE') AS effective_public_create FROM pg_roles r WHERE r.rolname IN ('anon','authenticated');
SELECT pg_get_userbyid(d.defaclrole) AS owner,n.nspname,d.defaclobjtype,d.defaclacl::text FROM pg_default_acl d LEFT JOIN pg_namespace n ON n.oid=d.defaclnamespace WHERE n.nspname='public' AND pg_get_userbyid(d.defaclrole)='postgres';
