import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const read = path => readFileSync(new URL(path, import.meta.url),'utf8');
const migration=read('../supabase/migrations/031_sps_and_operational_authorization_hardening.sql');
const pre=read('../docs/security/031-authorization-preflight.sql');
const post=read('../docs/security/031-authorization-post-apply-verify.sql');
const behavior=read('../docs/security/031-authorization-behavioral-rollback.sql');
const body=name=>migration.match(new RegExp(`function public\\.${name}\\([\\s\\S]*?as \\$fn\\$([\\s\\S]*?)\\$fn\\$;`,'i'))?.[1];

test('authorization inventory is bounded to exactly 48 distinct application tables',()=>{
 const reviewed=[...migration.match(/actual is distinct from ARRAY\[([\s\S]*?)\]::pg_catalog.text\[\]/)[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
 const revoke=migration.match(/revoke truncate, references, trigger, maintain on table([\s\S]*?)from public, anon, authenticated;/i)[1];
 assert.equal(reviewed.length,48); assert.equal(new Set(reviewed).size,48);
 assert.deepEqual([...revoke.matchAll(/public\.(\w+)/g)].map(x=>x[1]).sort(),reviewed.sort());
 assert.match(migration,/inventory mismatch/); assert.match(migration,/unexpected browser\/service column ACL/);
});
test('six-table authenticated SPS row access does not expose operational writes or service persistence',()=>{
 const grants=[...migration.matchAll(/^grant\s+([^;]*?)\s+on\s+(?:table\s+)?([^;]*?)\s+to\s+([^;]+);/gim)];
 const client=grants.filter(g=>g[3].trim()==='authenticated' && !/^execute$/i.test(g[1].trim()));
 assert.equal(client.length,3);
 const write=client.filter(g=>/insert|update|delete/i.test(g[1])); assert.equal(write.length,1);
 assert.equal([...write[0][2].matchAll(/public\.(\w+)/g)].length,6);
 assert.doesNotMatch(write[0][2],/public\.(orders|order_lines|audit_events)\b/);
 assert.match(migration,/revoke all privileges on table public.orders, public.order_lines, public.audit_events/);
 assert.doesNotMatch(migration,/\bgrant[^;]*\bto service_role\b/i);
});
test('private owner bootstrap is transactional, nonlogin and leaves no delegation',()=>{
 for(const role of ['lucid_sps_promoter','lucid_order_operator']){
  assert.match(migration,new RegExp(`create role ${role} nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls`));
 }
 assert.match(migration,/^begin;/m); assert.match(migration,/commit;\s*$/);
 assert.match(migration,/revoke lucid_sps_promoter,lucid_order_operator from postgres/);
 assert.match(migration,/revoke create on schema public from lucid_sps_promoter,lucid_order_operator/);
 assert.doesNotMatch(migration,/alter table[^;]*owner to lucid_/i);
 assert.doesNotMatch(migration,/grant[^;]*lucid_(sps_promoter|order_operator)[^;]*to (authenticated|anon|service_role)/i);
});
test('all four operational RPCs have empty search paths, actor-derived scopes and private ownership',()=>{
 for(const name of ['promote_sps_staged_order','create_lucid_qa_order','start_lucid_production','complete_lucid_production']){
  assert.match(migration,new RegExp(`function public\\.${name}\\([\\s\\S]*?security definer set search_path = ''`));
  const sql=body(name); assert.ok(sql); assert.match(sql,/p.id=public.lucid_request_actor_id\(\) and p.active and o.active/);
  assert.match(sql,/actor.organization_id/); assert.match(migration,new RegExp(`alter function public\\.${name}[^;]*owner to lucid_`));
  assert.doesNotMatch(sql,/\b(?:from|join|into|update)\s+(?:orders|profiles|organizations|order_lines|audit_events)\b/i);
 }
 assert.match(body('create_lucid_qa_order'),/actor.role<>'lucid_admin'/);
 assert.match(body('create_lucid_qa_order'),/not like 'QA-%'/);
 assert.match(migration,/grant update\(status\) on public.orders to lucid_order_operator/);
});
test('promotion checks native identity, actual UOM/quantity, ambiguity, scope and idempotency',()=>{
 const sql=body('promote_sps_staged_order');
 for(const fragment of ['for update',"document_type='860'","document_type is distinct from '850'",'l.quantity is null or l.quantity<=0','l.sps_uom is distinct from','m.item_id is null','Ambiguous exact item identifiers','existing_id,true','e.status=\'open\'','reviewer.role in']) assert.ok(sql.includes(fragment),fragment);
 assert.ok(sql.indexOf('for update')<sql.indexOf('select o.id into existing_id'));
 assert.ok(sql.indexOf('select o.id into existing_id')<sql.indexOf("staged.review_status<>'ready'"));
 assert.match(sql,/customer_map.customer_id is null/); assert.match(sql,/ship_map.ship_to_id is null/);
 assert.match(sql,/actor.role not in \('office','leadership','lucid_admin'\)/);
});
test('database guards close OLD/NEW escape, metadata forgery and Office price-finalization bypasses',()=>{
 const immutable=body('protect_lucid_promoted_sps_source');
 assert.match(immutable,/old_parent:=OLD.staged_order_id/);assert.match(immutable,/new_parent:=NEW.staged_order_id/);
 assert.match(immutable,/s.id in \(old_parent,new_parent\)/);
 assert.match(body('protect_lucid_sps_promotion_metadata'),/current_user <> 'lucid_sps_promoter'/);
 const price=body('protect_lucid_sps_price_authority');
 for(const fragment of ["actor.role='office'",'Only leadership or Lucid Admin','NEW.resolved_by:=actor.id','cannot rewrite the source purchase price','cannot remove an approved price']) assert.ok(price.includes(fragment));
});
test('only postgres/public future TABLE defaults change; managed defaults and old migrations untouched',()=>{
 assert.equal([...migration.matchAll(/alter default privileges/gi)].length,1);
 assert.match(migration,/alter default privileges for role postgres in schema public\s+revoke all privileges on tables from public, anon, authenticated, service_role/);
 assert.doesNotMatch(migration,/alter (?:default privileges[^;]*\b(?:auth|storage|realtime|extensions|supabase_admin)\b|role service_role)/i);
});
test('read-only gates fail closed, include ACLs/ownership/RLS/bootstrap and distinguish structural checks',()=>{
 for(const gate of [pre,post]) {
  assert.doesNotMatch(gate.replace(/--[^\n]*/g,''),/^\s*(?:insert|update|delete|create|alter|drop|grant|revoke|do|call)\b/im);
  assert.match(gate,/coalesce\(passed,false\)/); assert.match(gate,/failed_checks/);
 }
 assert.match(pre,/SAFE TO APPLY 031/);assert.match(pre,/BLOCKERS FOUND/);
 for(const field of ['Private role attributes','No private memberships','No private table ownership','RPC execute','Future table defaults','Operator status-only UPDATE','Promoter metadata-only UPDATE','OLD and NEW parent guard','Price authority definition'])assert.ok(post.includes(field),field);
 assert.match(post,/POST-APPLY VERIFICATION PASS/); assert.match(post,/Structural markers do not claim behavioral execution/);
});
test('authored rollback suite covers required database scenarios without a commit path',()=>{
 for(const scenario of ['Office','office 850 promotion','leadership 850 promotion','lucid_admin 850 promotion','Production promotion denied','860 promotion denied','Idempotent same order','Cross org promotion denied','nullqty','zeroqty','negativeqty','Actual CS EA mismatch','inactive-customers','inactive-customer_ship_tos','inactive-items','Actual conflicting exact identifiers','Source identity conflicting insert','NEW promoted line parent','NEW promoted exception parent','Promoted line reparent','Promoted exception reparent','metadata forgery','Office direct price finalization','Direct audit forgery','Direct operational order creation','Production start through private RPC','Production complete through private RPC','Production arbitrary order update','Admin QA order RPC','Non-Admin QA order','anon SPS mutation','Unsafe browser privileges absent'])assert.ok(behavior.includes(scenario),scenario);
 assert.match(behavior,/\bROLLBACK;/);assert.doesNotMatch(behavior,/^\s*COMMIT;/im);
 assert.match(behavior,/QA031_FAILED_CHECKS/);
});
test('PostgreSQL SQL and PL/pgSQL grammar, including gates and rollback suite',{skip:!process.env.LUCID_SQL_PARSER},async()=>{
 const parser=createRequire(import.meta.url)(process.env.LUCID_SQL_PARSER); await parser.loadModule();
 for(const sql of [migration,pre,post,behavior.replace(/^\\[^\n]*$/gm,'')]) assert.ok(parser.parseSync(sql).stmts.length);
 assert.ok(parser.parsePlPgSQLSync(migration));assert.ok(parser.parsePlPgSQLSync(behavior.replace(/^\\[^\n]*$/gm,'')));
});

test('actor-only helper eliminates direct Auth schema delegation without broadening RPC owners',()=>{
 const helper=body('lucid_request_actor_id'); assert.ok(helper);
 assert.match(migration,/create function public\.lucid_request_actor_id\(\)\s+returns pg_catalog.uuid language plpgsql stable security definer set search_path = ''/);
 assert.match(helper,/request_actor:=auth.uid\(\)/); assert.match(helper,/if request_actor is null/); assert.match(helper,/return request_actor/);
 assert.doesNotMatch(helper,/\b(insert|update|delete|execute|set_config|from|join)\b/i);
 assert.doesNotMatch(migration,/grant\s+(?:usage|execute)[^;]*\bon\s+(?:schema\s+auth|function\s+auth\.uid)/i);
 assert.match(migration,/grant execute on function public.lucid_request_actor_id\(\) to authenticated,lucid_sps_promoter,lucid_order_operator/);
 assert.match(migration,/revoke all on function public.lucid_request_actor_id\(\) from public,anon,authenticated,service_role/);
 assert.match(body('assert_lucid_sps_write_role'),/p.id=public.lucid_request_actor_id\(\)/);
 assert.doesNotMatch(body('assert_lucid_sps_write_role'),/auth\./);
 assert.match(migration,/alter policy "audit insert own actor"[\s\S]*?actor_id=public.lucid_request_actor_id\(\)/);
 assert.ok(pre.includes('Actor helper owner auth access'));assert.ok(pre.includes('Actor helper name unused'));
 assert.ok(post.includes('Private owners have no auth USAGE'));assert.ok(post.includes('Actor helper exact definition'));
 assert.ok(post.includes('Actor helper exact EXECUTE ACL'));assert.ok(post.includes('Audit RLS uses same actor helper'));
});
