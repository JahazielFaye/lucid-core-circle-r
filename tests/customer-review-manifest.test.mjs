import test from 'node:test';import assert from 'node:assert/strict';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
import {canonicalCustomerManifestPayload,createCustomerManifest,matchesCustomerManifestAuthority,validateCustomerManifest,customerManifestSummary} from '../src/lib/integrations/customer-review-manifest.ts';
import {allManifestRecords,reviewDraft} from '../src/lib/integrations/customer-review-manifest-contract.ts';
import {CustomerManifestReview} from '../src/components/customer-review-manifest.tsx';
import {manifestInput,manifestSource,manifestExisting,relatedEvidence,changedInput} from './customer-review-manifest.fixtures.mjs';
import {proposed,request,snapshot} from './customer-import-planner.fixtures.mjs';import {planCustomerImport} from '../src/lib/integrations/customer-import-planner.ts';import {previewHistoricalImport,commitHistoricalImport} from '../src/lib/integrations/historical-import.ts';import {runOperationalWorkflow} from '../src/lib/integrations/lucid-operational-workflows.ts';import {resetContext,stats} from './customer-import-context.stub.mjs';
test('Customer actions are derived from the exact preview: CREATE UPDATE NO_CHANGE SKIP CONFLICT',()=>{
 const m=createCustomerManifest(manifestInput());assert.deepEqual(m.customers.map(r=>r.action),['CREATE','UPDATE','NO_CHANGE','SKIP','CONFLICT']);assert.equal(m.counts.total,9);assert.equal(m.counts.by_action.CONFLICT,5);assert.equal(m.executable,false);
});
test('Ship-To/contact/identifier/SKU evidence stays nested under exact source customer, each held for own planner',()=>{
 const m=createCustomerManifest(manifestInput());const parent=m.customers[0];assert.equal(parent.related_records.length,4);for(const r of parent.related_records){assert.equal(r.parent_customer_record_key,parent.record_key);assert.equal(r.action,'CONFLICT');assert.equal(r.source_parent_customer_id,'0000001');assert.ok(r.validation_findings.some(f=>f.code==='RELATED_PLANNER_REQUIRED'));}assert.equal(parent.related_records.find(r=>r.entity==='customer_items').source_ship_to_id,'QA-SHIP-01');
});
test('missing/ambiguous source parents stay unlinked; no fabricated joins',()=>{
 const m=createCustomerManifest(manifestInput({relatedRecords:[{...relatedEvidence[0],parent_customer_source_record_id:'MISSING'}]}));assert.equal(m.unlinked_related_records.length,1);assert.equal(m.unlinked_related_records[0].parent_customer_record_key,null);assert.equal(m.unlinked_related_records[0].action,'CONFLICT');
 const rows=[proposed(),proposed()];const duplicate=createCustomerManifest(changedInput(rows,[],{relatedRecords:[{...relatedEvidence[0],parent_customer_source_record_id:'0000123'}]}));assert.equal(duplicate.unlinked_related_records.length,1);
});
test('provenance, identifiers as text and exact comparisons bind source and snapshot',()=>{
 const m=createCustomerManifest(manifestInput());assert.equal(m.customers[0].customer_code,'0000001');assert.equal(m.customers[1].field_comparison[0].field,'phone');assert.equal(m.customers[1].existing_lucid_match.id,'synthetic-customer-id');assert.equal(m.source_dataset.version,'SYNTHETIC-v1');assert.equal(m.source_dataset.hash,m.integrity.source_hash);assert.equal(m.planner_version,'customer-master-plan-v1');assert.equal(m.approval_storage,'NONE_EXPORT_ONLY');
});
test('manifest retains no private plaintext or literal redaction placeholders',()=>{
 const m=createCustomerManifest(manifestInput());const json=JSON.stringify(m);for(const token of ['SYNTHETIC PRIVATE NAME','SYNTHETIC_PRIVATE_PHONE','SYNTHETIC_PRIVATE_ADDRESS','SYNTHETIC_PRIVATE_PERSON','<redacted>'])assert.ok(!json.includes(token),token);assert.equal(m.customers[0].customer_name.visibility,'WITHHELD');assert.ok(m.customers[1].field_comparison[0].proposed.sha256);assert.ok(m.customers[0].related_records.some(r=>r.entity==='contacts'&&r.proposed_lucid_record.email.visibility==='PROTECTED'));
});
test('identical deterministic inputs produce identical manifests/hashes',()=>{
 assert.deepEqual(createCustomerManifest(manifestInput()),createCustomerManifest(manifestInput()));
});
test('same plan regenerated at another time keeps the authoritative artifact and passes registration binding',()=>{
 const first=createCustomerManifest(manifestInput());
 const regenerated=createCustomerManifest(manifestInput({generatedAt:'2026-10-31T19:00:00.000Z',generatedBy:'different-display-session'}));
 assert.notEqual(first.generated_at,regenerated.generated_at);assert.notEqual(first.generated_by.actor_id,regenerated.generated_by.actor_id);
 assert.equal(first.integrity.content_hash,regenerated.integrity.content_hash);assert.equal(first.integrity.artifact_hash,regenerated.integrity.artifact_hash);assert.equal(first.manifest_id,regenerated.manifest_id);
 assert.deepEqual(canonicalCustomerManifestPayload(first),canonicalCustomerManifestPayload(regenerated));assert.ok(matchesCustomerManifestAuthority(regenerated,first));
});
test('identical content with prior version returns that artifact unchanged, including timestamp',()=>{
 const m=createCustomerManifest(manifestInput());const next=createCustomerManifest(manifestInput({previousManifest:m,generatedAt:'2026-10-31T19:00:00.000Z'}));assert.deepEqual(next,m);assert.equal(next.manifest_version,1);assert.ok(Object.isFrozen(next));
});
test('source changes increment version, link prior ID, change hashes and isolate changed records',()=>{
 const first=createCustomerManifest(manifestInput());const rows=manifestSource();rows[0]={...rows[0],name:'SYNTHETIC_PRIVATE_CHANGED'};const next=createCustomerManifest(changedInput(rows,manifestExisting(),{previousManifest:first}));assert.equal(next.manifest_version,2);assert.equal(next.previous_manifest_id,first.manifest_id);assert.notEqual(next.integrity.source_hash,first.integrity.source_hash);assert.notEqual(next.plan_hash,first.plan_hash);assert.notEqual(next.integrity.content_hash,first.integrity.content_hash);assert.notEqual(next.integrity.artifact_hash,first.integrity.artifact_hash);assert.ok(!matchesCustomerManifestAuthority(next,first));assert.deepEqual(next.comparison.changed,[first.customers[0].record_key]);
});
test('added/removed records and resolved/introduced conflicts are explicit',()=>{
 const first=createCustomerManifest(manifestInput());const rows=manifestSource().filter(r=>r.source_record_id!=='QA-SKIP');rows.push(proposed({source_record_id:'QA-ADDED',customer_code:'QA-ADDED'}));const existing=manifestExisting().filter(r=>r.id!=='native-id');const next=createCustomerManifest(changedInput(rows,existing,{previousManifest:first,relatedRecords:[]}));assert.ok(next.comparison.added.length);assert.ok(next.comparison.removed.length);assert.ok(next.comparison.resolved_conflicts.includes(first.customers[4].record_key));
 const introduced=createCustomerManifest(changedInput(manifestSource().map((r,i)=>i===0?{...r,name:''}:r),manifestExisting(),{previousManifest:first}));assert.ok(introduced.comparison.introduced_conflicts.includes(first.customers[0].record_key));assert.notEqual(introduced.integrity.artifact_hash,first.integrity.artifact_hash);
});
test('related source change creates new version without changing unrelated customer record fingerprints',()=>{
 const first=createCustomerManifest(manifestInput());const next=createCustomerManifest(manifestInput({previousManifest:first,relatedRecords:relatedEvidence.map((r,i)=>i===0?{...r,proposed_record:{...r.proposed_record,address_line_1:'SYNTHETIC_OTHER_ADDRESS'}}:r)}));assert.equal(next.manifest_version,2);assert.equal(next.plan_hash,first.plan_hash);assert.notEqual(next.integrity.source_hash,first.integrity.source_hash);assert.equal(next.comparison.changed.length,1);assert.ok(next.comparison.changed[0].includes('ship_tos'));
});
test('tampered prior artifact, mismatched plan/source and cross-org/environment versions rejected',()=>{
 const first=createCustomerManifest(manifestInput());const tampered=JSON.parse(JSON.stringify(first));tampered.customers[0].action='UPDATE';assert.throws(()=>validateCustomerManifest(tampered));assert.throws(()=>createCustomerManifest(manifestInput({sourceRows:[proposed()]})));assert.throws(()=>createCustomerManifest(manifestInput({previousManifest:first,environment:'production'})));
});
test('a different organization cannot produce an equivalent authoritative artifact',()=>{
 const first=createCustomerManifest(manifestInput());const rows=manifestSource();const otherOrganization='synthetic-other-org';
 const otherPlan=planCustomerImport({...request(rows),organizationId:otherOrganization},{...snapshot([],{}),organizationId:otherOrganization});
 const other=createCustomerManifest(manifestInput({plan:otherPlan,sourceRows:rows,generatedBy:'other-admin'}));
 assert.notEqual(other.organization_id,first.organization_id);assert.notEqual(other.manifest_id,first.manifest_id);assert.notEqual(other.integrity.artifact_hash,first.integrity.artifact_hash);assert.ok(!matchesCustomerManifestAuthority(other,first));
});
test('unavailable relationships not represented as an empty proven dataset',()=>{
 const m=createCustomerManifest(manifestInput({relatedRecords:[]}));for(const c of Object.values(m.related_coverage))assert.equal(c.state,'NOT_SUPPLIED');
});
test('unknown or duplicate related identities rejected rather than merged',()=>{
 assert.throws(()=>createCustomerManifest(manifestInput({relatedRecords:[relatedEvidence[0],relatedEvidence[0]]})));assert.throws(()=>createCustomerManifest(manifestInput({relatedRecords:[{entity:'vendors'}]})));
});
test('local review decisions export a bound unverified draft without mutating the canonical base',()=>{
 const m=createCustomerManifest(manifestInput());const before=JSON.stringify(m);const artifact=m.integrity.artifact_hash;const draft=reviewDraft(m,{[m.customers[0].record_key]:'APPROVE',[m.customers[1].record_key]:'REJECT',[m.customers[2].record_key]:'NEEDS_REVIEW'},'2026-10-31T19:00:00.000Z');assert.equal(draft.operational_authorization,false);assert.equal(draft.server_persisted,false);assert.equal(draft.artifact_hash,artifact);assert.equal(m.integrity.artifact_hash,artifact);assert.equal(JSON.stringify(m),before);assert.equal(m.customers[0].approval_state,'UNREVIEWED');
});
test('conflicts and unknown records cannot be approved through review export',()=>{
 const m=createCustomerManifest(manifestInput());assert.throws(()=>reviewDraft(m,{[m.customers[4].record_key]:'APPROVE'},'2026-10-31T19:00:00.000Z'));assert.throws(()=>reviewDraft(m,{UNKNOWN:'APPROVE'},'2026-10-31T19:00:00.000Z'));
});
test('manifest UI shows review/export controls, no commit, no private values or localStorage persistence',()=>{
 const m=createCustomerManifest(manifestInput());const html=renderToStaticMarkup(React.createElement(CustomerManifestReview,{manifest:m,summary:customerManifestSummary(m)}));for(const s of ['Export JSON manifest','Export review summary','Export review draft','Not reviewed','Needs review','Version comparison'])assert.ok(html.includes(s),s);assert.ok(!html.includes('SYNTHETIC_PRIVATE_PHONE'));assert.ok(!html.includes('Confirm and import'));assert.match(html,/drafts, not saved approvals/);
});
test('authenticated preview produces manifest from same plan with zero operational write calls',async()=>{
 resetContext(manifestExisting());const result=await previewHistoricalImport({entity:'customers',mode:'current',sourceReference:'SYNTHETIC-QA-CUSTOMERS-v1',rows:manifestSource(),relatedRecords:relatedEvidence});assert.equal(result.manifest.plan_hash,result.plan.plan_id);assert.equal(result.manifest.generated_by.actor_id,'synthetic-admin');assert.equal(result.manifest.customers[0].related_records.length,4);assert.equal(stats.writes,0);
 const before=stats.writes;reviewDraft(result.manifest,{[result.manifest.customers[0].record_key]:'APPROVE'},'2026-10-31T19:00:00.000Z');assert.equal(stats.writes,before);
});
test('every Customer/Ship-To/Contact/Customer Item write attempt blocked in all modes, including existing dispatcher',async()=>{
 for(const entity of ['customers','ship_tos','contacts','customer_items'])for(const mode of ['current','historical',undefined]){resetContext();await assert.rejects(commitHistoricalImport({entity,mode,rows:[proposed()]}),/planning-only/);assert.deepEqual(stats,{contexts:0,reads:0,writes:0});await assert.rejects(runOperationalWorkflow('commit-historical-import',{entity,mode,rows:[proposed()]}),/planning-only/);assert.equal(stats.writes,0);}
});
test('new versions do not mutate earlier exported review intent or carry approvals forward',()=>{
 const first=createCustomerManifest(manifestInput());const before=JSON.stringify(first);const draft=reviewDraft(first,{[first.customers[0].record_key]:'APPROVE'},'2026-10-31T19:00:00.000Z');const rows=manifestSource();rows[0]={...rows[0],name:'SYNTHETIC_NEW_PRIVATE_NAME'};const next=createCustomerManifest(changedInput(rows,manifestExisting(),{previousManifest:first}));assert.equal(JSON.stringify(first),before);assert.equal(draft.artifact_hash,first.integrity.artifact_hash);assert.notEqual(next.integrity.artifact_hash,draft.artifact_hash);assert.ok(allManifestRecords(next).every(r=>r.approval_state==='UNREVIEWED'));
});
test('unsupported customer-identifier writer is rejected before any database capability',async()=>{
 resetContext();await assert.rejects(commitHistoricalImport({entity:'customer_identifiers',mode:'current',rows:[proposed()]}),/supported/);assert.deepEqual(stats,{contexts:0,reads:0,writes:0});
});
test('human summary escapes source control characters instead of fabricating extra review lines',()=>{
 const rows=[proposed({customer_code:'QA\nSYNTHETIC',source_record_id:'QA\nSYNTHETIC'})];const m=createCustomerManifest(changedInput(rows,[],{relatedRecords:[]}));const summary=customerManifestSummary(m);assert.ok(summary.includes('QA\\nSYNTHETIC'));assert.ok(!summary.includes('QA\nSYNTHETIC'));
});
import {reviewSummaryDraft} from '../src/lib/integrations/customer-review-manifest-contract.ts';
test('human-readable approval summary preserves unverified local intent and artifact binding',()=>{
 const m=createCustomerManifest(manifestInput());const text=reviewSummaryDraft(customerManifestSummary(m),m,{[m.customers[0].record_key]:'APPROVE'},'2026-10-31T19:00:00.000Z');assert.match(text,/UNVERIFIED LOCAL REVIEW INTENT/);assert.match(text,/APPROVE/);assert.ok(text.includes(m.integrity.artifact_hash));assert.ok(!text.includes('SYNTHETIC PRIVATE NAME'));assert.equal(m.customers[0].approval_state,'UNREVIEWED');
});
test('generic workflow route offers no approval persistence or execution action',async()=>{
 for(const action of ['approve-customer-manifest','commit-customer-manifest','save-customer-review']){resetContext();await assert.rejects(runOperationalWorkflow(action,{manifest_id:'synthetic',decision:'APPROVE'}));assert.deepEqual(stats,{contexts:0,reads:0,writes:0});}
});
test('identical duplicate of an existing unchanged customer remains SKIP rather than NO_CHANGE',()=>{
 const rows=[proposed(),proposed()];const m=createCustomerManifest(changedInput(rows,manifestExisting(),{relatedRecords:[]}));assert.deepEqual(m.customers.map(r=>r.action),['NO_CHANGE','SKIP']);
});
import {relatedFileProvenance} from '../src/lib/integrations/customer-review-manifest-contract.ts';
test('related-file provenance retains explicit references and adds the available filename without mutating source',()=>{
 const raw=[relatedEvidence[0],{...relatedEvidence[1],source_reference:'EXPLICIT-SYNTHETIC-SOURCE'}];const before=JSON.stringify(raw);const attached=relatedFileProvenance(raw,'SYNTHETIC-RELATIONSHIPS.json');assert.equal(attached[0].source_reference,'SYNTHETIC-RELATIONSHIPS.json');assert.equal(attached[1].source_reference,'EXPLICIT-SYNTHETIC-SOURCE');assert.equal(JSON.stringify(raw),before);
});
test('an existing-target/plan change with identical source creates a new unreviewed version',()=>{
 const first=createCustomerManifest(manifestInput());const existing=manifestExisting().map(r=>r.id==='synthetic-customer-id'?{...r,phone:'SYNTHETIC_PRIVATE_PHONE',updated_at:'2026-10-31T19:00:00Z'}:r);const next=createCustomerManifest(changedInput(manifestSource(),existing,{previousManifest:first}));assert.equal(next.integrity.source_hash,first.integrity.source_hash);assert.notEqual(next.plan_hash,first.plan_hash);assert.notEqual(next.integrity.artifact_hash,first.integrity.artifact_hash);assert.ok(!matchesCustomerManifestAuthority(next,first));assert.equal(next.manifest_version,2);assert.equal(next.customers[1].action,'NO_CHANGE');assert.equal(next.customers[1].approval_state,'UNREVIEWED');
});
