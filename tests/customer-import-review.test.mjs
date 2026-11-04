import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { planCustomerImport } from '../src/lib/integrations/customer-import-planner.ts';
import { readCustomerPlan, filterCustomerPlan, reviewValue, readCustomerFile, customerProposals } from '../src/lib/integrations/customer-import-review.ts';
import { readHardenedCsv } from '../src/lib/security/hardened-csv.ts';
import { CustomerImportPlanReview, CustomerImportReviewWorkspace } from '../src/components/customer-import-plan-review.tsx';
import { HistoricalImportWorkspace } from '../src/components/historical-import-workspace.tsx';
import { customer, proposed, request, snapshot } from './customer-import-planner.fixtures.mjs';
import { previewHistoricalImport, commitHistoricalImport } from '../src/lib/integrations/historical-import.ts';
import {resetContext,stats} from './customer-import-context.stub.mjs';
const plan=()=>planCustomerImport(request([proposed({source_record_id:'0000001',customer_code:'0000001'}),proposed({phone:'555-0100'}),proposed({source_record_id:'QA-SKIP',customer_code:'QA-SKIP',status:'inactive'}),proposed({source_record_id:'QA-BLOCK',customer_code:'QA-NATIVE'})]),snapshot([customer(),customer({id:'native-id',source_system:'lucid_core',source_record_id:null,customer_code:'QA-NATIVE'})]));
const render=(props)=>renderToStaticMarkup(React.createElement(CustomerImportPlanReview,props));
test('review presents all four actual planner decisions and exact authoritative counts',()=>{
 const p=readCustomerPlan(JSON.parse(JSON.stringify(plan())));const html=render({plan:p});
 assert.deepEqual(p.counts,{total:4,CREATE:1,UPDATE:1,SKIP:1,BLOCK:1});for(const d of ['CREATE','UPDATE','SKIP','BLOCK'])assert.match(html,new RegExp(d));assert.match(html,/4.*customer records reviewed/s);assert.match(html,/0000001/);
});
test('response integrity rejects missing, malformed, executable and inconsistent plans',()=>{
 for(const bad of [null,{}, {...plan(),executable:true},{...plan(),counts:{...plan().counts,CREATE:2}}])assert.throws(()=>readCustomerPlan(bad));
});
test('field comparison headers, duplicate explanations and validation findings are rendered',()=>{
 const p=planCustomerImport(request([proposed(),proposed(),proposed({source_record_id:'QA-MISSING',customer_code:'QA-MISSING',name:''})]),snapshot());const html=render({plan:p});
 assert.match(html,/Current/);assert.match(html,/Proposed/);assert.match(html,/Repeated record/);assert.match(html,/A nonblank, unredacted customer name is required/);
});
test('private changes hidden by default and protected values never disclosed',()=>{
 const html=render({plan:plan()});assert.doesNotMatch(html,/555-0100/);assert.match(html,/Private value hidden/);assert.match(html,/Show private values/);
 assert.equal(reviewValue('phone','<redacted>',true),'Protected source value');assert.equal(reviewValue('phone','555-0100',true),'555-0100');assert.equal(reviewValue('customer_code','0000001'),'0000001');
});
test('filter/search uses identities and finding labels, not hidden personal values',()=>{
 const p=plan();assert.equal(filterCustomerPlan(p.rows,'0000001','ALL','ALL').length,1);assert.equal(filterCustomerPlan(p.rows,'','BLOCK','error').length,1);assert.equal(filterCustomerPlan(p.rows,'555-0100','ALL','ALL').length,0);assert.equal(filterCustomerPlan(p.rows,'missing','ALL','ALL').length,0);
});
test('loading, empty and failure states are accessible and do not retain old results',()=>{
 assert.match(render({plan:plan(),loading:true}),/role="status"/);assert.doesNotMatch(render({plan:plan(),loading:true}),/QA-NATIVE/);
 assert.match(render({plan:null}),/Start with a customer file/);assert.match(render({plan:null,error:'Synthetic failure'}),/role="alert"/);
});
test('review provides labeled controls, native disclosures, comparison headings and pagination',()=>{
 const html=render({plan:plan()});for(const term of ['Search customer code','All decisions','All findings','<details','<summary','scope="col"','aria-label="Customer records pages"','aria-live="polite"'])assert.ok(html.includes(term),term);
});
test('500-row plan is paged at 25 rather than mounting the entire dataset',()=>{
 const p=planCustomerImport(request(Array.from({length:500},(_,i)=>proposed({source_record_id:`QA-${i}`,customer_code:`QA-${i}`}))),snapshot());const html=render({plan:p});assert.equal((html.match(/class="customer-plan-row"/g)||[]).length,25);assert.match(html,/of 20/);
});
test('CSV text codes and explicit typed field adaptation preserve leading zeros',()=>{
 const bytes=new TextEncoder().encode('source_record_id,customer_code,name,status,po_required\n0000001,0000001,Synthetic,active,false\n');const f=readCustomerFile(bytes.buffer);const rows=customerProposals(f,Object.fromEntries(f.headers.map(h=>[h,h])));assert.equal(rows[0].customer_code,'0000001');assert.equal(rows[0].po_required,false);assert.equal(planCustomerImport(request(rows),snapshot()).rows[0].decision,'CREATE');
});
test('malformed, duplicate-header, empty and excessive source files rejected',()=>{
 for(const csv of ['', 'code,code\na,b', 'code,name\n', 'code,name\n'+Array(501).fill('x,Synthetic').join('\n')])assert.throws(()=>readCustomerFile(new TextEncoder().encode(csv).buffer));
});
test('the shared CSV reader handles quoted fields and makes formulas inert for every import consumer',()=>{
 const bytes=new TextEncoder().encode('\uFEFFcode,notes\nQA-1,"quoted, value"\nQA-2,"=SUM(A1:A2)"\nQA-3,+cmd\nQA-4,-1+2\nQA-5,"@HYPERLINK(""https://example.test"")"\n');
 const shared=readHardenedCsv(bytes.buffer); const customer=readCustomerFile(bytes.buffer);
 assert.deepEqual(customer.headers,shared.headers);assert.deepEqual(customer.rows,shared.rows);
 assert.equal(shared.rows[0][1],'quoted, value');
 assert.deepEqual(shared.rows.slice(1).map(row=>row[1]),["'=SUM(A1:A2)","'+cmd","'-1+2","'@HYPERLINK(\"https://example.test\")"]);
});
test('the shared CSV reader rejects binary content and malformed quoted fields',()=>{
 for(const csv of ['code,name\nQA,\0binary','code,name\nQA,"unterminated']) assert.throws(()=>readHardenedCsv(new TextEncoder().encode(csv).buffer));
});
test('Imports navigation mounts only read-only review and offers no commit action',()=>{
 const html=renderToStaticMarkup(React.createElement(HistoricalImportWorkspace,{role:'lucid_admin'}));assert.match(html,/Read-only preview/);assert.doesNotMatch(html,/Confirm and import|Historical Archive|Importing|SaveButton/);
});
test('non-admin UI has no upload or planner action and server authorization rejects each role',async()=>{
 for(const role of ['office','production','leadership']) {const html=renderToStaticMarkup(React.createElement(CustomerImportReviewWorkspace,{role,fields:[]}));assert.doesNotMatch(html,/type="file"|Build read-only review/);resetContext(undefined,false,role);await assert.rejects(previewHistoricalImport({entity:'customers',mode:'current',rows:[proposed()]}),/Only Lucid Admin/);assert.equal(stats.writes,0);}
});
test('all customer commit modes are blocked before authentication or write capabilities',async()=>{
 for(const mode of ['current','historical',undefined]){resetContext();await assert.rejects(commitHistoricalImport({entity:'customers',mode,rows:[proposed()]}),/planning-only/);assert.deepEqual(stats,{contexts:0,reads:0,writes:0});}
});
import {runOperationalWorkflow} from '../src/lib/integrations/lucid-operational-workflows.ts';
test('existing workflow dispatcher forwards actual source reference and still blocks historical customer commits',async()=>{
 resetContext();const result=await runOperationalWorkflow('preview-historical-import',{entity:'customers',mode:'current',sourceReference:'SYNTHETIC-ACTUAL-FILENAME.csv',rows:[proposed()]});assert.equal(result.plan.source_reference,'SYNTHETIC-ACTUAL-FILENAME.csv');assert.equal(stats.writes,0);
 resetContext();await assert.rejects(runOperationalWorkflow('commit-historical-import',{entity:'customers',mode:'historical',rows:[proposed()]}),/planning-only/);assert.equal(stats.writes,0);
});
test('proposal indexes are not misrepresented as physical file lines after blank rows are omitted',()=>{
 const html=render({plan:plan()});assert.match(html,/Record /);assert.doesNotMatch(html,/File row/);
});
