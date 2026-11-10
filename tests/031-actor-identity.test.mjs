import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const migration=readFileSync(new URL('../supabase/migrations/031_sps_and_operational_authorization_hardening.sql',import.meta.url),'utf8');
const priorOrg=readFileSync(new URL('../supabase/migrations/025_user_organization_administration_foundation.sql',import.meta.url),'utf8');
const definition=(name,source=migration)=>{
 const start=source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`,'i')); assert.ok(start>=0,name);
 const end=source.indexOf(source===priorOrg?'$$;':'$fn$;',source.indexOf(source===priorOrg?'as $$':'as $fn$',start));
 assert.ok(end>start,name);return source.slice(start,end+(source===priorOrg?3:6));
};
const ids={office:'00000000-0000-4000-8000-000000000001',leadership:'00000000-0000-4000-8000-000000000002',lucid_admin:'00000000-0000-4000-8000-000000000003',production:'00000000-0000-4000-8000-000000000004',foreign:'00000000-0000-4000-8000-000000000005',orga:'00000000-0000-4000-8000-000000000011',orgb:'00000000-0000-4000-8000-000000000012',customer:'00000000-0000-4000-8000-000000000021',ship:'00000000-0000-4000-8000-000000000022',item:'00000000-0000-4000-8000-000000000023',cm:'00000000-0000-4000-8000-000000000024',sm:'00000000-0000-4000-8000-000000000025',im:'00000000-0000-4000-8000-000000000026'};

test('031 actor SQL behavior in synthetic, in-memory PostgreSQL (not a staging/JWT integration test)',{skip:!process.env.LUCID_IDENTITY_PGLITE},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.LUCID_IDENTITY_PGLITE));
 const db=new PGlite();
 const exec=sql=>db.exec(sql);
 const one=async(sql,params=[])=> (await db.query(sql,params)).rows[0];
 const expectDenied=async(sql,pattern,params=[])=>assert.rejects(()=>db.query(sql,params),e=>{assert.match(e.message,pattern);return true;});
 const session=async(role='office',claims={})=>{
  await exec('RESET ROLE; SET ROLE authenticated');
  // Privileged test harness sets the same request context as a verified gateway.
  // No application RPC accepts these settings as parameters or exposes set_config.
  await db.query("SELECT set_config('request.jwt.claim.sub','',false),set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:ids[role],role:'authenticated',...claims})]);
 };
 const newSource=async (ref,org=ids.orga)=>{
  const row=await one(`INSERT INTO public.sps_staged_orders(organization_id,external_po,trading_partner_id,document_type,source_system,customer_mapping_id,ship_to_mapping_id,review_status,business_po_number)
   VALUES($1,$2,'QA-PARTNER','850','sps',$3,$4,'ready',$2) RETURNING id`,[org,ref,ids.cm,ids.sm]);
  await db.query(`INSERT INTO public.sps_staged_order_lines(organization_id,staged_order_id,line_number,description,quantity,sps_uom,item_mapping_id,item_mapping_status,uom_status,buyer_part_number)
    VALUES($1,$2,'1','QA synthetic',2,'CS',$3,'mapped','match','000001')`,[org,row.id,ids.im]);return row.id;
 };
 try {
 await exec(`
 CREATE ROLE authenticated NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE service_role NOLOGIN;
 CREATE ROLE lucid_sps_promoter NOLOGIN NOINHERIT NOBYPASSRLS; CREATE ROLE lucid_order_operator NOLOGIN NOINHERIT NOBYPASSRLS;
 CREATE SCHEMA auth; REVOKE ALL ON SCHEMA auth FROM PUBLIC; GRANT USAGE ON SCHEMA auth TO authenticated;
 -- Test double of the documented Auth request-subject reader; never checks a real JWT.
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT coalesce(nullif(current_setting('request.jwt.claim.sub',true),''),nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
 CREATE TABLE public.organizations(id uuid PRIMARY KEY,active boolean DEFAULT true);
 CREATE TABLE public.profiles(id uuid PRIMARY KEY,organization_id uuid,role text,active boolean DEFAULT true);
 CREATE TABLE public.customers(id uuid PRIMARY KEY,organization_id uuid,name text,status text DEFAULT 'active');
 CREATE TABLE public.customer_ship_tos(id uuid PRIMARY KEY,organization_id uuid,customer_id uuid,name text,status text DEFAULT 'active');
 CREATE TABLE public.items(id uuid PRIMARY KEY,organization_id uuid,item_code text,description text,stock_uom text,sell_uom text,status text DEFAULT 'active');
 CREATE TABLE public.integration_customer_mappings(id uuid PRIMARY KEY,organization_id uuid,source_system text,source_trading_partner_id text,customer_id uuid,food_connex_customer_name text,status text DEFAULT 'active');
 CREATE TABLE public.integration_ship_to_mappings(id uuid PRIMARY KEY,organization_id uuid,source_system text,source_trading_partner_id text,ship_to_id uuid,food_connex_ship_to_name text,status text DEFAULT 'active');
 CREATE TABLE public.integration_item_mappings(id uuid PRIMARY KEY,organization_id uuid,source_system text,source_trading_partner_id text,item_id uuid,food_connex_item_number text,buyer_part_number text,vendor_item text,gtin text,sps_uom text,food_connex_uom text,status text DEFAULT 'active');
 CREATE TABLE public.sps_staged_orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,external_po text,trading_partner_id text,document_type text,source_system text,customer_mapping_id uuid,ship_to_mapping_id uuid,review_status text,promoted_order_id uuid,approved_by uuid,approved_at timestamptz,source_customer_name text,source_ship_to_name text,requested_ship_date date,requested_delivery_date date,normalized_payload jsonb,business_po_number text,po_date date,sps_id text);
 CREATE TABLE public.sps_staged_order_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,staged_order_id uuid,line_number text,description text,quantity numeric,sps_uom text,item_mapping_id uuid,item_mapping_status text,uom_status text,buyer_part_number text,vendor_item text,gtin text,sps_purchase_price numeric,approved_circle_r_price numeric,mapped_food_connex_item_id text);
 CREATE TABLE public.sps_order_exceptions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,staged_order_id uuid,staged_order_line_id uuid,exception_code text,status text,severity text,resolved_by uuid,resolution_action text,resolved_at timestamptz);
 CREATE TABLE public.orders(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,external_po text,customer text,ship_to text,customer_id uuid,ship_to_id uuid,source text,requested_ship_date date,requested_delivery_date date,status text,raw_payload jsonb,sps_staged_order_id uuid UNIQUE,trading_partner_id text,po_date date,created_by uuid,promoted_at timestamptz,source_system text,source_record_id text);
 CREATE TABLE public.order_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid,item_id uuid,external_sku text,vendor_item text,internal_item_id text,description text,quantity_cases numeric,unit_price numeric,uom text,sps_staged_order_line_id uuid,source_line_number text,gtin text,sps_source_unit_price numeric,price_resolution_action text,source_system text,source_record_id text);
 CREATE TABLE public.production_cases(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id uuid,order_line_id uuid,quantity numeric,status text);
 CREATE TABLE public.audit_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,organization_id uuid,actor_id uuid,action text,entity_type text,entity_id text,details jsonb);
 INSERT INTO public.organizations(id) VALUES('${ids.orga}'),('${ids.orgb}');
 INSERT INTO public.profiles(id,organization_id,role) VALUES${['office','leadership','lucid_admin','production'].map(role=>`('${ids[role]}','${ids.orga}','${role}')`).join(',')},('${ids.foreign}','${ids.orgb}','office');
 INSERT INTO public.customers VALUES('${ids.customer}','${ids.orga}','QA Customer','active');
 INSERT INTO public.customer_ship_tos VALUES('${ids.ship}','${ids.orga}','${ids.customer}','QA Ship','active');
 INSERT INTO public.items VALUES('${ids.item}','${ids.orga}','000001','QA Item','CS','CS','active');
 INSERT INTO public.integration_customer_mappings VALUES('${ids.cm}','${ids.orga}','sps','QA-PARTNER','${ids.customer}','QA Customer','active');
 INSERT INTO public.integration_ship_to_mappings VALUES('${ids.sm}','${ids.orga}','sps','QA-PARTNER','${ids.ship}','QA Ship','active');
 INSERT INTO public.integration_item_mappings(id,organization_id,source_system,source_trading_partner_id,item_id,food_connex_item_number,buyer_part_number,sps_uom,food_connex_uom) VALUES('${ids.im}','${ids.orga}','sps','QA-PARTNER','${ids.item}','000001','000001','CS','CS');
 `);
 // Extract only the actual identity helper and dependent function definitions.
 // The 031 migration, bootstrap/cleanup, and full application schema are NOT applied.
 await exec(definition('lucid_request_actor_id'));
 await exec(definition('current_org_id',priorOrg));
 await exec(definition('assert_lucid_sps_write_role'));
 for(const fn of ['promote_sps_staged_order','create_lucid_qa_order','start_lucid_production','complete_lucid_production']) await exec(definition(fn));
 await exec(`
 REVOKE ALL ON FUNCTION public.lucid_request_actor_id() FROM PUBLIC,anon,authenticated,service_role;
 GRANT EXECUTE ON FUNCTION public.lucid_request_actor_id() TO authenticated,lucid_sps_promoter,lucid_order_operator;
 GRANT USAGE ON SCHEMA public TO authenticated,lucid_sps_promoter,lucid_order_operator;
 GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated,lucid_sps_promoter,lucid_order_operator;
 GRANT INSERT,UPDATE,DELETE ON public.sps_staged_orders,public.sps_staged_order_lines,public.sps_order_exceptions TO authenticated;
 GRANT INSERT ON public.orders,public.order_lines,public.audit_events TO lucid_sps_promoter;
 GRANT UPDATE(review_status,promoted_order_id,approved_by,approved_at) ON public.sps_staged_orders TO lucid_sps_promoter;
 GRANT UPDATE(status) ON public.orders TO lucid_order_operator; GRANT INSERT ON public.audit_events TO lucid_order_operator;
 ALTER FUNCTION public.promote_sps_staged_order(uuid) OWNER TO lucid_sps_promoter;
 ALTER FUNCTION public.create_lucid_qa_order(text,text,text,text,text,numeric,text) OWNER TO lucid_sps_promoter;
 ALTER FUNCTION public.start_lucid_production(uuid) OWNER TO lucid_order_operator;
 ALTER FUNCTION public.complete_lucid_production(uuid) OWNER TO lucid_order_operator;
 `);
 for(const table of ['organizations','profiles','customers','customer_ship_tos','items','integration_customer_mappings','integration_ship_to_mappings','integration_item_mappings','sps_staged_orders','sps_staged_order_lines','sps_order_exceptions','orders','production_cases','audit_events']){
  await exec(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
  const condition=table==='organizations'?'id=public.current_org_id()':'organization_id=public.current_org_id()';
  await exec(`CREATE POLICY test_same_org ON public.${table} FOR ${table==='audit_events'?'SELECT':'ALL'} USING(${condition})`);
 }
 await exec(`ALTER TABLE public.order_lines ENABLE ROW LEVEL SECURITY;
 CREATE POLICY test_line_scope ON public.order_lines FOR ALL USING(EXISTS(SELECT 1 FROM public.orders o WHERE o.id=order_id AND o.organization_id=public.current_org_id()));
 CREATE POLICY "audit insert own actor" ON public.audit_events FOR INSERT WITH CHECK(organization_id=public.current_org_id() AND actor_id=public.lucid_request_actor_id());
 CREATE TRIGGER test_sps_role BEFORE INSERT OR UPDATE OR DELETE ON public.sps_staged_orders FOR EACH ROW EXECUTE FUNCTION public.assert_lucid_sps_write_role();`);
 for(const fn of ['promote_sps_staged_order(uuid)','create_lucid_qa_order(text,text,text,text,text,numeric,text)','start_lucid_production(uuid)','complete_lucid_production(uuid)'])await exec(`REVOKE ALL ON FUNCTION public.${fn} FROM PUBLIC,anon,service_role;GRANT EXECUTE ON FUNCTION public.${fn} TO authenticated`);
 for(const role of ['office','leadership','lucid_admin'])await t.test(`${role}: actor resolves and real 850 function writes that actor into audit`,async()=>{
  await session(role);assert.equal((await one('SELECT public.lucid_request_actor_id() AS actor')).actor,ids[role]);
  const id=await newSource(`QA-IDENTITY-${role}`);const promoted=await one('SELECT * FROM public.promote_sps_staged_order($1)',[id]);
  assert.equal(promoted.already_promoted,false);
  const audit=await one('SELECT actor_id,organization_id FROM public.audit_events WHERE entity_id=$1',[promoted.operational_order_id]);
  assert.equal(audit.actor_id,ids[role]);assert.equal(audit.organization_id,ids.orga);
 });
 await t.test('Production actor resolves but actual promotion role gate rejects it',async()=>{
  await session('production');assert.equal((await one('SELECT public.lucid_request_actor_id() AS actor')).actor,ids.production);
  await expectDenied('SELECT * FROM public.promote_sps_staged_order($1)',/Your role cannot send incoming orders/,[ids.customer]);
 });
 await t.test('anonymous caller has no helper EXECUTE and authenticated missing subject fails closed',async()=>{
  await exec('RESET ROLE;SET ROLE anon');await expectDenied('SELECT public.lucid_request_actor_id()',/permission denied/);
  await session('office',{sub:undefined});await expectDenied('SELECT public.lucid_request_actor_id()',/authenticated request actor is required/);
 });
 await t.test('no caller-supplied actor/organization parameter or extra overload is accepted',async()=>{
  await session('office');
  await expectDenied('SELECT public.lucid_request_actor_id($1::uuid)',/does not exist/,[ids.lucid_admin]);
  await expectDenied('SELECT * FROM public.promote_sps_staged_order($1::uuid,$2::uuid)',/does not exist/,[ids.customer,ids.orgb]);
  await expectDenied('SELECT * FROM public.promote_sps_staged_order(p_staged_order_id=>$1::uuid,p_actor_id=>$2::uuid)',/does not exist/,[ids.customer,ids.lucid_admin]);
 });
 await t.test('untrusted metadata actor/organization claims cannot override authenticated subject/profile',async()=>{
  await session('office',{actor_id:ids.lucid_admin,organization_id:ids.orgb,user_metadata:{sub:ids.lucid_admin,organization_id:ids.orgb}});
  assert.equal((await one('SELECT public.lucid_request_actor_id() AS actor,public.current_org_id() AS org')).actor,ids.office);
  assert.equal((await one('SELECT public.current_org_id() AS org')).org,ids.orga);
  await assert.rejects(()=>newSource('QA-FORGED-ORG',ids.orgb),/Incoming SPS records must belong to your organization|row-level security/);
 });
 await t.test('cross-org source remains hidden and real promotion cannot use it',async()=>{
  await session('foreign');
  const b=await one("INSERT INTO public.sps_staged_orders(organization_id,external_po,document_type) VALUES($1,'QA-ORG-B','850') RETURNING id",[ids.orgb]);
  await session('office');
  assert.equal((await one('SELECT count(*)::int AS n FROM public.sps_staged_orders WHERE id=$1',[b.id])).n,0);
  await expectDenied('SELECT * FROM public.promote_sps_staged_order($1)',/not found/,[b.id]);
 });
 await t.test('Admin QA creation and Production start/complete use the helper with actual-actor audits',async()=>{
  await session('office');
  await expectDenied("SELECT * FROM public.create_lucid_qa_order('QA-IDENTITY-ORDER','QA Customer','QA Ship','000001','QA Item',2,'CS')",/Only Lucid Admin/);
  await session('lucid_admin');
  const qa=await one("SELECT * FROM public.create_lucid_qa_order('QA-IDENTITY-ORDER','QA Customer','QA Ship','000001','QA Item',2,'CS')");
  assert.equal((await one('SELECT actor_id FROM public.audit_events WHERE entity_id=$1',[qa.order_id])).actor_id,ids.lucid_admin);
  await session('production');
  assert.equal((await one('SELECT * FROM public.start_lucid_production($1)',[qa.order_id])).operational_status,'in_production');
  await expectDenied('SELECT * FROM public.complete_lucid_production($1)',/All ordered quantities/,[qa.order_id]);
  // Completion prerequisite is a privileged fixture, never an operational production write.
  await exec('RESET ROLE');
  await db.query("INSERT INTO public.production_cases(organization_id,order_line_id,quantity,status) VALUES($1,$2,2,'produced')",[ids.orga,qa.order_line_id]);
  await session('production');
  assert.equal((await one('SELECT * FROM public.complete_lucid_production($1)',[qa.order_id])).operational_status,'production_complete');
  const a=await one("SELECT count(*)::int AS n,bool_and(actor_id=$1) AS actual_actor FROM public.audit_events WHERE entity_id=$2 AND action IN ('production started','production completed')",[ids.production,qa.order_id]);
  assert.equal(a.n,2);assert.equal(a.actual_actor,true);
  await session('office');
 });
 await t.test('exact helper definition, ACL and audit-policy post-apply checks accept the approved identity',async()=>{
  await exec('RESET ROLE');
  const verifier=readFileSync(new URL('../docs/security/031-authorization-post-apply-verify.sql',import.meta.url),'utf8');
  for(const label of ['Actor helper exact definition','Actor helper no overloads','Actor helper exact EXECUTE ACL','Private owners have no auth USAGE','SPS trigger uses actor helper','Audit RLS uses same actor helper']){
   const line=verifier.split('\n').find(x=>x.startsWith(` UNION ALL SELECT '${label}'`));assert.ok(line,label);
   const result=await one(`WITH probe(label,passed,detail) AS (${line.replace(/^ UNION ALL /,'')}) SELECT passed FROM probe`);assert.equal(result.passed,true,label);
  }
  await session('office');
 });
 await t.test('both private owners resolve actor without Auth USAGE; direct auth.uid is denied',async()=>{
  for(const role of ['lucid_sps_promoter','lucid_order_operator']){
   await exec(`RESET ROLE;SET ROLE ${role}`);
   assert.equal((await one('SELECT public.lucid_request_actor_id() AS actor')).actor,ids.office);
   const rights=await one("SELECT has_schema_privilege(current_user,'auth','USAGE') AS usage,rolbypassrls,rolcanlogin FROM pg_roles WHERE rolname=current_user");
   assert.equal(rights.usage,false);assert.equal(rights.rolbypassrls,false);assert.equal(rights.rolcanlogin,false);
   await expectDenied('SELECT auth.uid()',/permission denied for schema auth/);
  }
 });
 } finally {await db.close();}
});
