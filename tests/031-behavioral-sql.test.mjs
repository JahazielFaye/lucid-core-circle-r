import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const source=readFileSync(new URL('../docs/security/031-authorization-behavioral-rollback.sql',import.meta.url),'utf8');
const walk=(value,visit)=>{if(!value||typeof value!=='object')return;visit(value);for(const x of Object.values(value))if(x&&typeof x==='object')Array.isArray(x)?x.forEach(y=>walk(y,visit)):walk(x,visit);};
function mismatches(ast,tableWidths=new Map()){
 const errors=[];walk(ast,node=>{
  if(!node.InsertStmt)return;const insert=node.InsertStmt;
  const expected=insert.cols?.length??tableWidths.get(insert.relation.relname);
  assert.ok(Number.isInteger(expected),`Unverified implicit-column INSERT: ${insert.relation.relname}`);
  const select=insert.selectStmt?.SelectStmt;if(!select)return; // DEFAULT VALUES has no row shape.
  const widths=select.valuesLists?.map(x=>x.List.items.length)??(select.targetList?[select.targetList.length]:[]);
  assert.ok(widths.length,`Unverified INSERT source: ${insert.relation.relname}`);
  walk(select.targetList,node=>assert.ok(!node.A_Star,'INSERT SELECT * requires schema-aware validation'));
  for(const actual of widths)if(actual!==expected)errors.push({table:insert.relation.relname,expected,actual});
 });return errors;
}

test('prepared 031 rollback SQL shape and grammar (static only)',{skip:!process.env.LUCID_SQL_PARSER},async t=>{
 const parser=createRequire(import.meta.url)(process.env.LUCID_SQL_PARSER);await parser.loadModule();
 const plain=source.replace(/^\\[^\n]*$/gm,'');const ast=parser.parseSync(plain);const pl=parser.parsePlPgSQLSync(plain);
 const queries=new Map([['top-level',ast]]);const widths=new Map();
 walk(ast,node=>{
  if(node.CreateStmt)widths.set(node.CreateStmt.relation.relname,node.CreateStmt.tableElts.filter(x=>x.ColumnDef).length);
  const value=node.String?.sval??node.A_Const?.sval?.sval;
  if(typeof value==='string'&&/^\s*(?:INSERT|SELECT|UPDATE|DELETE)\b/i.test(value))queries.set(value,parser.parseSync(value));
 });
 walk(pl,node=>{
  const query=node.PLpgSQL_stmt_execsql?.sqlstmt?.PLpgSQL_expr?.query;
  if(query)queries.set(query,parser.parseSync(query));
 });
 await t.test('SQL and PLpgSQL bodies parse, including quoted scenario commands',()=>{assert.ok(ast.stmts.length);assert.ok(pl.plpgsql_funcs.length);assert.ok(queries.size>10);});
 await t.test('every INSERT VALUES row and INSERT SELECT projection matches its target width',()=>{
  let insertCount=0;for(const [context,tree] of queries){assert.deepEqual(mismatches(tree,widths),[],context);walk(tree,n=>{if(n.InsertStmt)insertCount++;});}
  assert.ok(insertCount>=40,`Only ${insertCount} INSERTs inspected`);t.diagnostic(`Inspected ${insertCount} INSERT statements, including helper bodies and quoted denial probes.`);
 });
 await t.test('the audit-resolution fixture explicitly starts open before its resolution UPDATE',()=>{
  let fixture;walk(ast,node=>{const i=node.InsertStmt;if(i?.relation.relname==='sps_order_exceptions'&&JSON.stringify(i).includes('valid-ex'))fixture=i;});
  assert.ok(fixture);const index=fixture.cols.findIndex(c=>c.ResTarget.name==='status');assert.ok(index>=0);
  assert.equal(fixture.selectStmt.SelectStmt.valuesLists[0].List.items[index].A_Const.sval.sval,'open');
  assert.match(source,/UPDATE sps_order_exceptions SET status='resolved'[\s\S]*?pg_temp.qid\('valid-ex'\)/);
 });
 await t.test('the checker rejects the original typo, malformed later VALUES rows and SELECT mismatches',()=>{
  for(const sql of ["INSERT INTO x(a,b) VALUES(1)","INSERT INTO x(a,b) VALUES(1,2),(3)","INSERT INTO x(a,b) SELECT 1"]){assert.equal(mismatches(parser.parseSync(sql)).length,1,sql);}
  assert.deepEqual(mismatches(parser.parseSync('INSERT INTO x(a,b) VALUES(1,2),(3,4)')),[]);
 });
 await t.test('test transaction remains rollback-only and retains final result/cleanup summaries',()=>{
  const transactions=ast.stmts.filter(x=>x.stmt.TransactionStmt).map(x=>x.stmt.TransactionStmt.kind);
  assert.deepEqual(transactions,['TRANS_STMT_BEGIN','TRANS_STMT_ROLLBACK']);assert.match(source,/\\set ON_ERROR_STOP on/);
  assert.match(source,/QA031_RESULTS=/);assert.match(source,/QA031_ROLLBACK=/);
 });
});

test('the two denial expectations use SQLSTATE and unchanged-state assertions',()=>{
 assert.match(source,/qdeny_state\('anon SPS mutation denied',[\s\S]*?\$q\$,'42501'\)/);
 assert.match(source,/qdeny_state\('inactive-items denied',[\s\S]*?\$q\$,'P0001','inactive Lucid master data\|Every incoming line needs an active exact item'\)/);
 assert.match(source,/actual_state=expected_state AND \(pattern IS NULL OR msg ~ pattern\)/);
 for(const label of ['Inactive item fixture remains inactive','Inactive promotion leaves source orders lines and audit unchanged','Anonymous mutation leaves source orders lines and audit unchanged'])assert.ok(source.includes(label));
 for(const name of ['staged','orders','lines','audits'])assert.ok(source.includes(`'${name}',(SELECT md5(`));
});

test('focused denial-assertion helper SQL behavior in disposable PostgreSQL',{skip:!process.env.LUCID_IDENTITY_PGLITE},async t=>{
 const {pathToFileURL}=await import('node:url');const {PGlite}=await import(pathToFileURL(process.env.LUCID_IDENTITY_PGLITE));const db=new PGlite();
 const helper=name=>source.match(new RegExp(`CREATE FUNCTION pg_temp\\.${name}\\([\\s\\S]*?\\$\\$;`))[0];
 const check=async(label,stmt,state,pattern=null)=>{
  await db.query('SELECT pg_temp.qdeny_state($1,$2,$3,$4)',[label,stmt,state,pattern]);
  return (await db.query('SELECT passed FROM qa_results WHERE label=$1',[label])).rows[0].passed;
 };
 const state=async()=> (await db.query('SELECT pg_temp.q_denial_state() AS state')).rows[0].state;
 try{
  await db.exec("CREATE TEMP TABLE qa_results(label text,passed boolean,detail text);CREATE TABLE public.sps_staged_orders(id int,value text);CREATE TABLE public.orders(id int,value text);CREATE TABLE public.order_lines(id int,value text);CREATE TABLE public.audit_events(id int,value text);");
  await db.exec(helper('qdeny_state'));await db.exec(helper('q_denial_state'));
  await t.test('legitimate authorization denials pass independent of database-layer message',async()=>{
   for(const [index,message] of ['permission denied for table sps_staged_orders','permission denied for function current_org_id','new row violates row-level security policy'].entries())assert.equal(await check(`auth-${index}`,`DO $$ BEGIN RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='${message}'; END $$`,'42501'),true);
  });
  await t.test('actual intended inactive-item validation passes without accepting unrelated errors',async()=>{
   const pattern='inactive Lucid master data|Every incoming line needs an active exact item';
   for(const [index,message] of ['An incoming mapping points to inactive Lucid master data.','Every incoming line needs an active exact item, positive quantity, and matching UOM before production.'].entries())assert.equal(await check(`inactive-${index}`,`DO $$ BEGIN RAISE EXCEPTION '${message}'; END $$`,'P0001',pattern),true);
   assert.equal(await check('unrelated','DO $$ BEGIN RAISE EXCEPTION \'unrelated error\'; END $$','P0001',pattern),false);
   assert.equal(await check('syntax-error','invalid syntax','42501'),false);
  });
  await t.test('unexpected success fails and cannot leave mutation side effects',async()=>{
   const before=await state();assert.equal(await check('unexpected-success',"INSERT INTO public.orders VALUES(1,'should roll back')",'42501'),false);assert.deepEqual(await state(),before);
  });
  await t.test('state comparison detects writes to each protected record family',async()=>{
   for(const table of ['sps_staged_orders','orders','order_lines','audit_events']){
    const before=await state();await db.exec(`INSERT INTO public.${table} VALUES(2,'changed')`);assert.notDeepEqual(await state(),before);await db.exec(`DELETE FROM public.${table}`);
   }
  });
 }finally{await db.close();}
});
