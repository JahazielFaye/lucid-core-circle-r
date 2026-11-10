import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const migration=read('../supabase/migrations/031_sps_and_operational_authorization_hardening.sql');
const post=read('../docs/security/031-authorization-post-apply-verify.sql');
const pre=read('../docs/security/031-authorization-preflight.sql');
const cleanup=migration.slice(migration.indexOf('-- No temporary membership or CREATE grant survives the transaction.')).replace(/commit;\s*$/i,'');
const assertion=cleanup.slice(cleanup.indexOf('do $bootstrap_cleanup$'));
const postStart=post.indexOf(" UNION ALL SELECT 'No private memberships with execution access'");
const postLine=post.slice(postStart,post.indexOf(' UNION ALL SELECT',postStart+1)).trimStart();
const roles=['lucid_sps_promoter','lucid_order_operator'];

test('031 membership cleanup reproduces hosted non-superuser creator semantics in disposable PostgreSQL',{skip:!process.env.LUCID_IDENTITY_PGLITE},async t=>{
 const {PGlite}=await import(pathToFileURL(process.env.LUCID_IDENTITY_PGLITE));const db=new PGlite();
 const exec=sql=>db.exec(sql);const row=async(sql)=>(await db.query(sql)).rows[0];
 const verifier=async()=> (await row(`WITH result(label,passed,detail) AS (${postLine.replace(/^UNION ALL /,'')}) SELECT passed FROM result`)).passed;
 const asAdmin=async sql=>{await exec('SET SESSION AUTHORIZATION test_driver');await exec(sql);await exec('SET SESSION AUTHORIZATION postgres');};
 try {
  // Model Supabase's actual role names/IDs and a non-superuser CREATEROLE executor.
  // No staging connection, persistent database, full migration or business fixture.
  await exec(`CREATE ROLE test_driver SUPERUSER; SET SESSION AUTHORIZATION test_driver;
    ALTER ROLE postgres RENAME TO supabase_admin;
    CREATE ROLE postgres NOSUPERUSER CREATEROLE INHERIT;
    CREATE SCHEMA auth; REVOKE ALL ON SCHEMA auth FROM PUBLIC;
    ALTER SCHEMA public OWNER TO postgres;
    SET SESSION AUTHORIZATION postgres;`);
  for(const role of roles)await exec(migration.match(new RegExp(`create role ${role}[^;]+;`,'i'))[0]);
  await exec("CREATE FUNCTION public.lucid_request_actor_id() RETURNS uuid LANGUAGE sql AS 'SELECT null::uuid';");
  await exec('REVOKE ALL ON FUNCTION public.lucid_request_actor_id() FROM PUBLIC;GRANT EXECUTE ON FUNCTION public.lucid_request_actor_id() TO lucid_sps_promoter,lucid_order_operator;');
  const temporaryGrant=migration.match(/^grant lucid_sps_promoter, lucid_order_operator to postgres;/m)[0];
  await t.test('original row-count assertion falsely rejects the automatic ADMIN-only creator grants',async()=>{
   await exec(temporaryGrant);
   await exec('REVOKE lucid_sps_promoter,lucid_order_operator FROM postgres GRANTED BY postgres');
   const grants=(await db.query("SELECT r.rolname,pg_get_userbyid(m.member) AS member,pg_get_userbyid(m.grantor) AS grantor,m.admin_option,m.inherit_option,m.set_option FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid WHERE r.rolname IN ('lucid_sps_promoter','lucid_order_operator') ORDER BY r.rolname")).rows;
   assert.equal(grants.length,2);
   for(const g of grants){assert.equal(g.member,'postgres');assert.equal(g.grantor,'supabase_admin');assert.equal(g.admin_option,true);assert.equal(g.inherit_option,false);assert.equal(g.set_option,false);}
   assert.equal((await row("SELECT EXISTS(SELECT 1 FROM pg_auth_members m WHERE m.roleid IN (SELECT oid FROM pg_roles WHERE rolname IN ('lucid_sps_promoter','lucid_order_operator'))) AS old_false_positive")).old_false_positive,true);
  });
  await t.test('actual ownership bootstrap and corrected cleanup remove temporary access',async()=>{
   await exec(temporaryGrant);
   await exec('GRANT USAGE,CREATE ON SCHEMA public TO lucid_sps_promoter,lucid_order_operator');
   await exec('CREATE FUNCTION public.cleanup_owner_probe() RETURNS int LANGUAGE sql AS \'SELECT 1\';ALTER FUNCTION public.cleanup_owner_probe() OWNER TO lucid_sps_promoter');
   await exec(cleanup);
   assert.equal(await verifier(),true);
   assert.equal((await row("SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE oid='public.cleanup_owner_probe()'::regprocedure")).owner,'lucid_sps_promoter');
   for(const role of roles){
    const g=await row(`SELECT rolcanlogin,rolbypassrls,pg_has_role('postgres',oid,'SET') AS can_set,pg_has_role('postgres',oid,'USAGE') AS inherits FROM pg_roles WHERE rolname='${role}'`);
    assert.deepEqual(g,{rolcanlogin:false,rolbypassrls:false,can_set:false,inherits:false});
    await assert.rejects(()=>exec(`SET ROLE ${role}`),/permission denied to set role/);
   }
  });
  await t.test('any retained self-granted bootstrap membership is rejected',async()=>{
   await exec(temporaryGrant);
   assert.equal(await verifier(),false);
   await assert.rejects(()=>exec(assertion),/unexpected private role membership|temporary bootstrap execution access/);
   await exec(cleanup);assert.equal(await verifier(),true);
  });
  await t.test('application membership is rejected even with SET and INHERIT disabled',async()=>{
   await exec('CREATE ROLE qa_application NOLOGIN;GRANT lucid_sps_promoter TO qa_application WITH ADMIN FALSE,INHERIT FALSE,SET FALSE');
   assert.equal(await verifier(),false);await assert.rejects(()=>exec(assertion),/unexpected private role membership/);
   await exec('REVOKE lucid_sps_promoter FROM qa_application GRANTED BY postgres');assert.equal(await verifier(),true);
  });
  for(const option of ['SET','INHERIT'])await t.test(`platform ADMIN grant with ${option} TRUE is rejected`,async()=>{
   await asAdmin(`GRANT lucid_sps_promoter TO postgres WITH ADMIN TRUE,SET ${option==='SET'?'TRUE':'FALSE'},INHERIT ${option==='INHERIT'?'TRUE':'FALSE'}`);
   assert.equal(await verifier(),false);await assert.rejects(()=>exec(assertion),/unexpected private role membership/);
   await asAdmin('GRANT lucid_sps_promoter TO postgres WITH ADMIN TRUE,SET FALSE,INHERIT FALSE');assert.equal(await verifier(),true);
  });
  await t.test('private role cannot be a member of another role',async()=>{
   await exec('CREATE ROLE qa_external NOLOGIN;GRANT qa_external TO lucid_sps_promoter WITH ADMIN FALSE,INHERIT FALSE,SET FALSE');
   assert.equal(await verifier(),false);await assert.rejects(()=>exec(assertion),/unexpected private role membership/);
   await exec('REVOKE qa_external FROM lucid_sps_promoter GRANTED BY postgres');assert.equal(await verifier(),true);
  });
  await t.test('unknown bootstrap grantor identity fails closed rather than accepting NULL',async()=>{
   await asAdmin('ALTER ROLE supabase_admin RENAME TO qa_unexpected_bootstrap');
   assert.equal(await verifier(),false);await assert.rejects(()=>exec(assertion),/unexpected private role membership/);
   await asAdmin('ALTER ROLE qa_unexpected_bootstrap RENAME TO supabase_admin');assert.equal(await verifier(),true);
  });
  await t.test('preflight recognizes the exact managed creator-admin prerequisites',async()=>{
   const line=pre.split('\n').find(s=>s.startsWith(" UNION ALL SELECT 'Managed creator-admin membership prerequisite'"));assert.ok(line);
   assert.equal((await row(`WITH result(label,passed,detail) AS (${line.replace(/^ UNION ALL /,'')}) SELECT passed FROM result`)).passed,true);
  });
 } finally {await db.close();}
});
