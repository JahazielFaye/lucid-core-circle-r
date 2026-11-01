import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonicalImportJson,type CustomerImportPlan} from './customer-import-planner';
import {allManifestRecords,customerManifestSchema,relatedEntities,relatedSourceSchema,type CustomerReviewManifest,type ManifestRecord,type RelatedManifestSource} from './customer-review-manifest-contract';
const digest=(value:unknown)=>createHash('sha256').update(canonicalImportJson(value)).digest('hex');
const privateMarker=/\bredacted\b|\*{2,}|•{2,}|^x{3,}[- .()/x\d]*$/i;
const publicFields=new Set(['customer_code','source_record_id','source_system','status','is_historical','po_required','order_guide_enabled','order_guide_retention_days','location_code','customer_sku','customer_uom','identifier_type','identifier_value']);
function value(field:string,raw:unknown):ManifestRecord['customer_name']{
 if(raw===undefined||raw===null)return {visibility:'NOT_PROVIDED',value:null,sha256:digest(null)};
 if(typeof raw==='string'&&privateMarker.test(raw))return {visibility:'PROTECTED',value:null,sha256:digest(raw)};
 return {visibility:publicFields.has(field)&&['string','number','boolean'].includes(typeof raw)?'PUBLIC':'WITHHELD',value:publicFields.has(field)&&['string','number','boolean'].includes(typeof raw)?raw as string|number|boolean:null,sha256:digest(raw)};
}
function immutable<T>(v:T):T {if(v&&typeof v==='object'){Object.values(v).forEach(immutable);Object.freeze(v);}return v;}
function content(m:CustomerReviewManifest){return {schema_version:m.schema_version,lineage_id:m.lineage_id,environment:m.environment,organization_id:m.organization_id,source_system:m.source_system,source_dataset:m.source_dataset,planner_version:m.planner_version,plan_hash:m.plan_hash,snapshot_hash:m.snapshot_hash,customers:m.customers,unlinked_related_records:m.unlinked_related_records,related_coverage:m.related_coverage,validation_findings:m.validation_findings,privacy_policy:m.privacy_policy,counts:m.counts,approval_storage:m.approval_storage,executable:m.executable};}
function artifact(m:CustomerReviewManifest){const {artifact_hash,...integrity}=m.integrity;return {...m,integrity};}
function recordFingerprint(record:Omit<ManifestRecord,'record_hash'>|ManifestRecord){
 const {record_hash,source_provenance,existing_lucid_match,...rest}=record as ManifestRecord;
 const {source_hash,proposal_number,...provenance}=source_provenance;
 return digest({...rest,source_provenance:provenance,existing_lucid_match:existing_lucid_match?{id:existing_lucid_match.id}:null});
}
export function validateCustomerManifest(raw:unknown):CustomerReviewManifest{
 const m=customerManifestSchema.parse(raw);if(m.unlinked_related_records.some(r=>r.entity==='customers'||r.parent_customer_record_key!==null))throw Error('Invalid unlinked relationship.');const records=allManifestRecords(m);const ids=new Set<string>();
 for(const c of m.customers){if(c.entity!=='customers'||c.parent_customer_record_key!==null)throw Error('Invalid customer hierarchy.');for(const r of c.related_records)if(r.entity==='customers'||r.parent_customer_record_key!==c.record_key)throw Error('Invalid related parent.');}
 for(const r of records){if(ids.has(r.record_key))throw Error('Repeated manifest key.');ids.add(r.record_key);const {related_records,...base}=r as ManifestRecord&{related_records?:ManifestRecord[]};if(recordFingerprint(base)!==r.record_hash)throw Error('Record fingerprint mismatch.');}
 for(const action of ['CREATE','UPDATE','NO_CHANGE','SKIP','CONFLICT'] as const)if(m.counts.by_action[action]!==records.filter(r=>r.action===action).length)throw Error('Manifest counts do not match.');
 const entities=new Set(records.map(r=>r.entity));if(Object.keys(m.counts.by_entity).length!==entities.size||[...entities].some(entity=>m.counts.by_entity[entity]!==records.filter(r=>r.entity===entity).length))throw Error('Entity counts mismatch.');
 if(m.counts.total!==records.length||m.source_dataset.hash!==m.integrity.source_hash||m.plan_hash!==m.integrity.plan_hash||digest(content(m))!==m.integrity.content_hash||digest(artifact(m))!==m.integrity.artifact_hash||digest({lineage:m.lineage_id,version:m.manifest_version,content:m.integrity.content_hash})!==m.manifest_id)throw Error('Manifest integrity mismatch.');
 return m;
}
export function compareCustomerManifests(previous:CustomerReviewManifest|undefined,current:CustomerReviewManifest){
 const before=new Map((previous?allManifestRecords(previous):[]).map(r=>[r.record_key,r]));const after=new Map(allManifestRecords(current).map(r=>[r.record_key,r]));
 return {added:[...after.keys()].filter(k=>!before.has(k)).sort(),removed:[...before.keys()].filter(k=>!after.has(k)).sort(),changed:[...after.keys()].filter(k=>before.has(k)&&before.get(k)!.record_hash!==after.get(k)!.record_hash).sort(),resolved_conflicts:[...after.keys()].filter(k=>before.get(k)?.action==='CONFLICT'&&after.get(k)!.action!=='CONFLICT').sort(),introduced_conflicts:[...after.keys()].filter(k=>after.get(k)!.action==='CONFLICT'&&before.get(k)?.action!=='CONFLICT').sort()};
}
export type ManifestInput={plan:CustomerImportPlan;sourceRows:readonly unknown[];relatedRecords?:unknown;previousManifest?:unknown;datasetVersion?:string;generatedAt:string;generatedBy:string;environment:string};
/** Consumes the exact authenticated preview plan. No DB/client, matching or executor. */
export function createCustomerManifest(input:ManifestInput):CustomerReviewManifest{
 const {plan}=input;const {plan_id,...planBody}=plan;
 if(plan.executable!==false||plan.dry_run!==true||plan.entity!=='customers'||digest(planBody)!==plan_id||digest({organizationId:plan.organization_id,sourceReference:plan.source_reference,rows:input.sourceRows})!==plan.input_hash)throw Error('Manifest source must be the exact server preview plan.');
 z.string().datetime().parse(input.generatedAt);z.string().min(1).parse(input.generatedBy);z.string().min(1).parse(input.environment);
 const related=z.array(relatedSourceSchema).max(2000).parse(input.relatedRecords??[]);
 const previous=input.previousManifest===undefined?undefined:validateCustomerManifest(input.previousManifest);
 if(previous&&(previous.organization_id!==plan.organization_id||previous.environment!==input.environment))throw Error('Prior manifest belongs to a different organization or environment.');
 const sourceHash=digest({customers:input.sourceRows,related_records:related});const lineage=previous?.lineage_id??digest({organization:plan.organization_id,source:plan.source_reference,entity:'customers'});
 const occurrences=new Map<string,number>();
 const customers=plan.rows.map((row,index)=>{
  const source=input.sourceRows[index] as Record<string,unknown>|null;const id=row.source_record_id??`unidentified-proposal-${row.row}`;const n=(occurrences.get(id)??0)+1;occurrences.set(id,n);
  const base:Omit<ManifestRecord,'record_hash'>={record_key:canonicalImportJson(['customers',id,n]),entity:'customers',customer_code:row.customer_code,source_record_id:row.source_record_id,source_status:value('status',source?.status),customer_name:value('name',source?.name),parent_customer_record_key:null,source_parent_customer_id:null,source_ship_to_id:null,existing_lucid_match:row.matched_id?{id:row.matched_id,snapshot_hash:plan.snapshot_hash}:null,
   proposed_lucid_record:{customer_code:value('customer_code',row.customer_code),source_record_id:value('source_record_id',row.source_record_id),...Object.fromEntries(row.changes.map(c=>[c.field,value(c.field,c.after)]))},comparison_scope:'PLANNER_CHANGED_FIELDS',field_comparison:row.changes.map(c=>({field:c.field,current:value(c.field,c.before),proposed:value(c.field,c.after)})),
   action:row.decision==='BLOCK'?'CONFLICT':row.decision==='SKIP'?(row.duplicate_of_row===null&&row.findings.some(f=>f.code==='UNCHANGED')?'NO_CHANGE':'SKIP'):row.decision,
   validation_findings:row.findings,unresolved_warnings:row.findings.filter(f=>f.severity==='warning'),source_provenance:{source_system:'food_connex',source_reference:plan.source_reference,source_hash:sourceHash,proposal_number:row.row},approval_state:'UNREVIEWED'};
  return {...base,record_hash:recordFingerprint(base),related_records:[] as ManifestRecord[]};
 });
 const unlinked:ManifestRecord[]=[];const relatedKeys=new Set<string>();
 for(const source of related){const parent=customers.filter(c=>c.source_record_id===source.parent_customer_source_record_id);const key=canonicalImportJson([source.entity,source.parent_customer_source_record_id,source.source_record_id]);if(relatedKeys.has(key))throw Error('Related source identities must be unique.');relatedKeys.add(key);
  const findings:ManifestRecord['validation_findings']=[{severity:'error',code:'RELATED_PLANNER_REQUIRED',message:'This relationship is preserved as source evidence only. Its own server planner is required before a create, update or unchanged decision can be approved.'}];if(parent.length!==1)findings.push({severity:'error',code:'PARENT_UNRESOLVED',message:'The source customer is missing or ambiguous. No parent was inferred.'});
  const base:Omit<ManifestRecord,'record_hash'>={record_key:key,entity:source.entity,customer_code:parent.length===1?parent[0].customer_code:null,source_record_id:source.source_record_id,source_status:value('status',source.source_status),customer_name:value('name',source.proposed_record.name),parent_customer_record_key:parent.length===1?parent[0].record_key:null,source_parent_customer_id:source.parent_customer_source_record_id,source_ship_to_id:source.ship_to_source_record_id??null,existing_lucid_match:null,proposed_lucid_record:Object.fromEntries(Object.entries(source.proposed_record).map(([f,v])=>[f,value(f,v)])),comparison_scope:'UNPLANNED_SOURCE_ONLY',field_comparison:[],action:'CONFLICT',validation_findings:findings,unresolved_warnings:[],source_provenance:{source_system:'food_connex',source_reference:source.source_reference??plan.source_reference,source_hash:sourceHash,proposal_number:null},approval_state:'UNREVIEWED'};
  const record={...base,record_hash:recordFingerprint(base)};if(parent.length===1)parent[0].related_records.push(record);else unlinked.push(record);
 }
 customers.forEach(c=>c.related_records.sort((a,b)=>a.record_key<b.record_key?-1:1));unlinked.sort((a,b)=>a.record_key<b.record_key?-1:1);
 const records:ManifestRecord[]=customers.flatMap(c=>[c,...c.related_records]).concat(unlinked);const counts={total:records.length,by_action:{CREATE:0,UPDATE:0,NO_CHANGE:0,SKIP:0,CONFLICT:0},by_entity:{} as Record<string,number>};records.forEach(r=>{counts.by_action[r.action]++;counts.by_entity[r.entity]=(counts.by_entity[r.entity]??0)+1;});
 const relatedCoverage=Object.fromEntries(relatedEntities.map(entity=>{const supplied=related.filter(r=>r.entity===entity).length;return [entity,{supplied,state:supplied?'MANUAL_REVIEW_REQUIRED':'NOT_SUPPLIED'}];}));
 let manifest=customerManifestSchema.parse({schema_version:'customer-review-manifest-v1',manifest_version:previous?previous.manifest_version+1:1,manifest_id:'0'.repeat(64),lineage_id:lineage,previous_manifest_id:previous?.manifest_id??null,generated_at:input.generatedAt,generated_by:{actor_id:input.generatedBy,assurance:'SERVER_SESSION_NOT_SIGNED'},environment:input.environment,organization_id:plan.organization_id,source_system:'food_connex',source_dataset:{reference:plan.source_reference,version:input.datasetVersion??null,hash:sourceHash,hash_scope:'CANONICAL_PROPOSED_CUSTOMERS_AND_SUPPLIED_RELATIONSHIPS'},planner_version:plan.version,plan_hash:plan.plan_id,snapshot_hash:plan.snapshot_hash,counts,customers,unlinked_related_records:unlinked,related_coverage:relatedCoverage,validation_findings:plan.findings,approval_storage:'NONE_EXPORT_ONLY',executable:false,privacy_policy:'PRIVATE_PLAINTEXT_WITHHELD_V1',comparison:{added:[],removed:[],changed:[],resolved_conflicts:[],introduced_conflicts:[]},integrity:{algorithm:'SHA-256',source_hash:sourceHash,plan_hash:plan.plan_id,content_hash:'0'.repeat(64),artifact_hash:'0'.repeat(64),signature:null}});
 manifest.integrity.content_hash=digest(content(manifest));if(previous?.integrity.content_hash===manifest.integrity.content_hash)return immutable(previous);
 manifest.manifest_id=digest({lineage,version:manifest.manifest_version,content:manifest.integrity.content_hash});manifest.comparison=compareCustomerManifests(previous,manifest);manifest.integrity.artifact_hash=digest(artifact(manifest));return immutable(validateCustomerManifest(manifest));
}
const oneLine=(text:string)=>JSON.stringify(text).slice(1,-1);
export function customerManifestSummary(manifest:CustomerReviewManifest):string{
 const m=validateCustomerManifest(manifest);return ['CUSTOMER REVIEW MANIFEST — READ ONLY',`Version: ${m.manifest_version} | ${m.manifest_id}`,`Generated: ${m.generated_at} | Environment: ${m.environment}`,`Source: ${oneLine(m.source_dataset.reference)}`,`Source hash: ${m.integrity.source_hash}`,`Plan hash: ${m.plan_hash}`,`Content hash: ${m.integrity.content_hash}`,`Artifact hash: ${m.integrity.artifact_hash}`,`Records: ${m.counts.total} | ${Object.entries(m.counts.by_action).map(([k,v])=>`${k}: ${v}`).join(' | ')}`,'Private plaintext withheld. SHA-256 fingerprints are not signatures or authorization.','Approval persistence: unavailable. Review decisions are unverified export drafts only.','',...allManifestRecords(m).map(r=>`${r.entity} | ${oneLine(r.customer_code??'Unresolved customer')} | source ${oneLine(r.source_record_id??'missing')} | ${r.action} | ${r.validation_findings.map(f=>f.code).join(', ')}`),'','Version comparison:',...Object.entries(m.comparison).map(([key,rows])=>`${key}: ${rows.length}`)].join('\n');
}
