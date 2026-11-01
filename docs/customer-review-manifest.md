# Customer Review Manifest v1 — export only, never executable

## Contract and authority

`customer-review-manifest-contract.ts` is the machine contract (Zod + inferred TS
schema). `customer-review-manifest.ts` is server-only generation, integrity checking,
comparison and text summary. It consumes the **same CustomerImportPlan object**
returned by authenticated current-customer preview and verifies its plan hash and
source input hash. No second matching engine, DB writer or migration is introduced.

Metadata: schema_version, monotonically incremented manifest_version, manifest_id,
lineage_id, previous_manifest_id, generated_at (server ISO UTC), generated_by
(authenticated profile ID, explicitly not signed), environment, organization,
source dataset reference/version/hash, planner_version, plan_hash, snapshot_hash,
counts by entity/action, privacy policy and `executable:false`.

Each customer: exact original text code/source ID, source status, customer-name
commitment, existing match ID/snapshot hash, proposed identity/patch, exact planner
changed-field comparisons, findings/warnings, provenance, initial approval state,
and record_hash. NO_CHANGE derives only from the planner's UNCHANGED finding;
other planner SKIPs remain SKIP; BLOCK maps to CONFLICT. Comparisons are the planner's
changed fields, not a claim to export the entire existing customer snapshot.

Nested `related_records` preserve Customer → Ship-To/Contact/customer identifier/
Customer Item ownership, including an optional source Ship-To reference for SKU
relationships. Orphans/duplicate-parent ambiguities stay in `unlinked_related_records`.
Related source arrays are supplied optionally; absence is NOT_SUPPLIED, never proof
of an empty source dataset. **Related planners do not yet exist:** every supplied
related record is CONFLICT/manual review, never an invented CREATE/UPDATE/NO_CHANGE.

## Privacy

All private plaintext is withheld in the JSON, text summary, screenshots and normal
manifest UI. Each value carries visibility + value (null if non-public) + SHA-256.
Names, contact details, addresses, operational notes and other nonpublic fields are
commitments only. Source redaction markers remain PROTECTED, never literal values.
Original operational codes are retained as text. Fingerprints are not encryption or
anonymization: exports remain confidential organizational review documents.

The authorized existing review UI can still reveal private comparison values on
explicit request; the canonical export intentionally cannot reconstruct them.
Future execution requires the original protected server-side plan/source snapshot,
proper authorization and fresh validation. Do not treat this redacted artifact as
an operational import payload. Human summaries escape control characters; JSON
preserves exact original strings.

## Versioning and integrity

- Source hash: canonical structured customer proposals AND supplied relationship
  evidence. It is **not** falsely labeled an original CSV/XLSX byte hash.
- Plan hash: exact existing server planner plan_id; retains private field/snapshot
  binding without exporting plaintext.
- Record hash: semantic record payload excluding global source/snapshot hashes and
  proposal ordinal, so one changed source record does not mark every sibling changed.
- Content hash: full version content, scope, source dataset, records, hashes and counts;
  excludes generation timestamp/actor and version-comparison envelope metadata.
- Manifest ID: lineage + version + content hash. Artifact hash additionally binds
  the complete export envelope, including timestamp/actor/version comparison.
- SHA-256 is unkeyed. Signature is explicitly null. It detects drift, **not** malicious
  forgery, reviewer identity, authorization or server-backed approval durability.

A supplied prior manifest is schema/hash/count checked and must match organization
and environment. Changed source/plan/content increments version and links prior ID.
Identical content with a supplied prior returns that prior artifact **verbatim**,
including timestamp, ID and hashes. No prior means first version, not an invented
server version history. Re-exporting identical inputs without prior has stable
source/plan/content hashes and ID; generation-envelope hashes may differ with time.
Files from prior versions are never edited. Local sample writer refuses to overwrite
any different existing artifact.

Server comparisons identify added/removed/changed record keys, newly resolved
conflicts and newly introduced conflicts. Removed conflicts are not falsely counted
as resolved. Reordering/global metadata can change plan/content without falsely
reporting every unchanged record as changed. Duplicate source IDs remain explicit
occurrences/manual-review findings; no identities are silently merged.

## Approval state — deliberately not durable yet

Canonical records start UNREVIEWED and are immutable. UI choices (Approve, Reject,
Needs review) form a separate `customer-review-draft-v1` sidecar bound to manifest
version/ID, artifact hash, source hash, plan hash and per-record hashes. Conflicts
cannot be approved. These choices never change canonical actions or field values.
The draft says UNVERIFIED_EXPORT_DRAFT, server_persisted=false,
reviewer_identity_verified=false, operational_authorization=false. No localStorage,
IndexedDB, approval API or operational table update is used. Exporting a bundle
retains intent as a file; refreshing/rebuilding does not persist approval. Uploaded
review bundles are used only for their previous manifest, not to trust/restore intent.

### Future persistence design — NOT implemented or migrated

1. Immutable organization-scoped manifest registry: lineage/version unique key,
   source/plan/content/artifact hashes, planner version, environment, source-version
   references, creating actor/time and a protected document pointer. No update/delete
   of approved content. SharePoint remains document authority for durable files;
   Lucid would store the registry/hash pointers, not replace document management.
2. Append-only approval events: manifest artifact/version + record hash/key,
   authenticated reviewer profile/authorized source-owner role, decision, reason,
   server timestamp and superseding-event reference. Exported drafts are input for
   authenticated review, never accepted as proof of identity or approval.
3. Fresh content creates a new version; earlier approval events remain bound to their
   original hashes. All approvals must be reviewed for the new version, never copied.
4. Separate, explicitly authorized executor must load trusted registry/approvals,
   verify unchanged source/plan/snapshot and parent dependencies under transaction/
   concurrency controls, and retain before-images and rollback/audit records.

No such persistence layer currently exists. Do not infer a durable approval from a
selected dropdown or downloaded draft. No cryptographic signing service is added.

## Commit protection

Existing import commit rejects customers, ship_tos, contacts and customer_items in
current, historical AND omitted mode, before authentication or batch insertion.
Customer identifiers have no supported writer and are rejected. Direct function
and dispatcher tests verify zero context/write access. Manifest generation reads
only the existing authorized customer snapshot; approval/export functions have
no DB capability. Existing unrelated manual Admin maintenance APIs are outside this
feature and unchanged: this is not a claim that the entire application/database is
read-only. No production authorization or RLS policy was changed.

## Local verification

```sh
npm run test:customer-manifest
npx tsc --noEmit
npm run build
git diff --check
node --import ./tests/register-server-only.mjs tests/customer-review-manifest.example.mjs <output-directory>
```

Build validation uses a sanitized local copy of identical src with production .env
and deployment configuration excluded, dummy loopback Supabase settings, and disabled
Next telemetry. It is compilation, not deployment. The isolated synthetic browser
harness uses the actual preview/manifest path with DB stubs, never a production client.
SPS, QuickBooks, SharePoint and carrier ownership boundaries remain unchanged.

Next: implement the immutable, access-controlled manifest registry and authenticated
source-owner approval ledger in an explicitly authorized nonproduction environment,
then test trust, version invalidation and permissions. Do not enable an executor or
operational writes until separately authorized.
