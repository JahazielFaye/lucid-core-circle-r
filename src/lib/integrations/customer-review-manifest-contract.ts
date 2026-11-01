// Public read-only artifact contract; no database or planning capabilities.
import { z } from 'zod';
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const scalar=z.union([z.string(),z.number().finite(),z.boolean()]);
export const manifestValueSchema=z.object({visibility:z.enum(['PUBLIC','WITHHELD','PROTECTED','NOT_PROVIDED']),value:scalar.nullable(),sha256:hash}).strict().refine(v=>v.visibility==='PUBLIC'||v.value===null,'Non-public values must not contain plaintext');
const finding=z.object({severity:z.enum(['error','warning','info']),code:z.string(),message:z.string(),field:z.string().optional()}).strict();
export const manifestActions=['CREATE','UPDATE','NO_CHANGE','SKIP','CONFLICT'] as const;
export const relatedEntities=['ship_tos','contacts','customer_identifiers','customer_items'] as const;
export const relatedSourceSchema=z.object({entity:z.enum(relatedEntities),source_record_id:z.string().min(1),parent_customer_source_record_id:z.string().min(1),ship_to_source_record_id:z.string().optional(),source_status:z.string().optional(),proposed_record:z.record(z.union([scalar,z.null()])).default({}),source_reference:z.string().optional()}).strict();
export type RelatedManifestSource=z.infer<typeof relatedSourceSchema>;
const recordSchema=z.object({record_key:z.string(),entity:z.enum(['customers',...relatedEntities]),customer_code:z.string().nullable(),source_record_id:z.string().nullable(),source_status:manifestValueSchema,customer_name:manifestValueSchema,
 parent_customer_record_key:z.string().nullable(),source_parent_customer_id:z.string().nullable(),source_ship_to_id:z.string().nullable(),existing_lucid_match:z.object({id:z.string(),snapshot_hash:hash}).nullable(),
 proposed_lucid_record:z.record(manifestValueSchema),comparison_scope:z.enum(['PLANNER_CHANGED_FIELDS','UNPLANNED_SOURCE_ONLY']),field_comparison:z.array(z.object({field:z.string(),current:manifestValueSchema,proposed:manifestValueSchema}).strict()),
 action:z.enum(manifestActions),validation_findings:z.array(finding),unresolved_warnings:z.array(finding),source_provenance:z.object({source_system:z.literal('food_connex'),source_reference:z.string(),source_hash:hash,proposal_number:z.number().int().positive().nullable()}),
 approval_state:z.literal('UNREVIEWED'),record_hash:hash,
}).strict();
export type ManifestRecord=z.infer<typeof recordSchema>;
const customerRecordSchema=recordSchema.extend({related_records:z.array(recordSchema)});
const counts=z.object({total:z.number().int().nonnegative(),by_action:z.object({CREATE:z.number(),UPDATE:z.number(),NO_CHANGE:z.number(),SKIP:z.number(),CONFLICT:z.number()}),by_entity:z.record(z.number().int().nonnegative())});
export const customerManifestSchema=z.object({schema_version:z.literal('customer-review-manifest-v1'),manifest_version:z.number().int().positive().safe(),manifest_id:hash,lineage_id:hash,previous_manifest_id:hash.nullable(),generated_at:z.string().datetime(),generated_by:z.object({actor_id:z.string(),assurance:z.literal('SERVER_SESSION_NOT_SIGNED')}),environment:z.string(),organization_id:z.string(),source_system:z.literal('food_connex'),source_dataset:z.object({reference:z.string(),version:z.string().nullable(),hash:hash,hash_scope:z.literal('CANONICAL_PROPOSED_CUSTOMERS_AND_SUPPLIED_RELATIONSHIPS')}),planner_version:z.string(),plan_hash:hash,snapshot_hash:hash,counts,customers:z.array(customerRecordSchema),unlinked_related_records:z.array(recordSchema),related_coverage:z.record(z.object({supplied:z.number(),state:z.enum(['NOT_SUPPLIED','MANUAL_REVIEW_REQUIRED'])})),
 validation_findings:z.array(finding),approval_storage:z.literal('NONE_EXPORT_ONLY'),executable:z.literal(false),privacy_policy:z.literal('PRIVATE_PLAINTEXT_WITHHELD_V1'),
 comparison:z.object({added:z.array(z.string()),removed:z.array(z.string()),changed:z.array(z.string()),resolved_conflicts:z.array(z.string()),introduced_conflicts:z.array(z.string())}),
 integrity:z.object({algorithm:z.literal('SHA-256'),source_hash:hash,plan_hash:hash,content_hash:hash,artifact_hash:hash,signature:z.null()}),
}).strict();
export type CustomerReviewManifest=z.infer<typeof customerManifestSchema>;
export type ReviewChoice='APPROVE'|'REJECT'|'NEEDS_REVIEW';
export function allManifestRecords(manifest:CustomerReviewManifest):ManifestRecord[]{return manifest.customers.flatMap(c=>[c,...c.related_records]).concat(manifest.unlinked_related_records);}
/** Local intent only. This does not grant permission, claim identity or call a server. */
export function reviewDraft(manifest:CustomerReviewManifest,choices:Record<string,ReviewChoice>,createdAt:string) {
 z.string().datetime().parse(createdAt);
 const records=allManifestRecords(manifest);const blocked=manifest.validation_findings.some(f=>f.severity==='error');
 const decisions=Object.entries(choices).sort(([a],[b])=>a<b?-1:a>b?1:0).map(([key,decision])=>{
  const record=records.find(r=>r.record_key===key);if(!record||!['APPROVE','REJECT','NEEDS_REVIEW'].includes(decision))throw Error('Unknown review selection.');
  if(decision==='APPROVE'&&(blocked||record.action==='CONFLICT'))throw Error('Conflicts require manual review and cannot be approved.');
  return {record_key:key,decision,record_hash:record.record_hash};
 });
 return {schema_version:'customer-review-draft-v1',state:'UNVERIFIED_EXPORT_DRAFT',created_at:createdAt,reviewer_identity_verified:false,server_persisted:false,operational_authorization:false,manifest_id:manifest.manifest_id,manifest_version:manifest.manifest_version,artifact_hash:manifest.integrity.artifact_hash,source_hash:manifest.integrity.source_hash,plan_hash:manifest.integrity.plan_hash,decisions};
}
/** Human formatting of local intent only; canonical actions and server summary stay unchanged. */
export function reviewSummaryDraft(summary:string,manifest:CustomerReviewManifest,choices:Record<string,ReviewChoice>,createdAt:string):string {
 const draft=reviewDraft(manifest,choices,createdAt);
 return [summary,'','UNVERIFIED LOCAL REVIEW INTENT — NOT SAVED TO SERVER',`Bound artifact: ${draft.artifact_hash}`,`Reviewer identity verified: false | Operational authorization: false`,...draft.decisions.map(d=>`${JSON.stringify(d.record_key)} | ${d.decision} | record hash ${d.record_hash}`),draft.decisions.length?'':'No reviewer selections.'].join('\n');
}
/** File provenance adapter, not a planner: retain explicit provenance and add an available filename only when absent. */
export function relatedFileProvenance(raw:unknown,filename:string):unknown {
 return Array.isArray(raw)?raw.map(record=>record&&typeof record==='object'&&!Array.isArray(record)&&!Object.hasOwn(record,'source_reference')?{...record,source_reference:filename}:record):raw;
}
