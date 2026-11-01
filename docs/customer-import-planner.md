# Customer Master import planner — local, dry-run only

This component does not import data. Food Connex, production records, migrations,
deployment, commits and pushes are outside this implementation. Existing unrelated
drafts are retained. No new dependencies are required.

## Entry points and reuse

- `src/lib/integrations/customer-import-planner.ts`: server-only pure
  `planCustomerImport(request, snapshot)` and read-only
  `previewCustomerImport(request, reader)`; shared decision/finding/change types,
  canonical hashes, strict field validation, protected values and source matching.
- Existing `previewHistoricalImport` delegates current **customers** to this planner.
  It reuses the existing authenticated Lucid Admin context and organization-scoped
  Supabase client. It reads snapshots in ordered 500-row pages. Read failures produce
  no plan; a 10,000-row limit produces an incomplete-snapshot BLOCK.
- Customer Master `commitHistoricalImport` is explicitly blocked in every mode **before** context
  creation or batch insertion. Non-customer historical and other entity paths are unchanged;
  this does not certify those existing paths as safe.

The existing UI receives compatibility counts plus `plan`; it does not yet show the
complete field diff. No UI changes, new API route, database writes or migrations
were added. The existing preview caller does not yet forward a filename reference;
its fallback is clearly labeled `Customer Master preview`. Direct server callers
must provide a meaningful `sourceReference`. A preview is not an approval token.

## Contract

`request` has `organizationId`, `sourceReference`, and 1–500 proposed structured
objects. A complete snapshot must be loaded by an authenticated server caller.
The pure planner itself does not authenticate, fetch, persist or accept a write client.
Never use a caller-supplied snapshot as authority for a future commit.

Every active proposed record requires text `source_record_id`, text `customer_code`,
nonblank/unredacted `name`, and explicit `status: 'active'`. Numeric IDs are rejected;
case, spaces, punctuation and zeros are preserved. Case/whitespace variants are
collision findings, not normalized matches. `source_system`, if supplied, must be
`food_connex`. `is_historical`, if supplied, must be a boolean. Inactive/deleted/
historical source rows are excluded. Exact historical/inactive destination matches
are never reactivated or converted. Name alone never establishes identity.

Supported optional text fields: `legal_name`, `address_line_1`, `address_line_2`,
`city`, `state`, `postal_code`, `country`, `phone`, `general_email`,
`default_warehouse_id`, `customer_type`, `customer_group`,
`payment_terms_reference`, `invoice_preferences`, `delivery_preferences`,
`operational_notes`. Existing aliases `email` → `general_email` and
`default_warehouse_code` → `default_warehouse_id` are retained; the warehouse value
is a legacy text reference, not a newly validated foreign key.

`po_required` and `order_guide_enabled` require real booleans;
`order_guide_retention_days` requires a nonnegative integer. CSV strings such as
`"false"` need an explicit typed parsing layer; the planner does not coerce them.
Unknown fields (including draft-only columns) BLOCK rather than disappear.
Operational terms references are supported; accounting balances and EDI/document/
carrier configuration are not.

Optional missing, undefined, null, whitespace-only and known extraction/redaction
placeholders are ignored with warnings. They never clear existing values. Required
identity/name placeholders BLOCK. There is deliberately no clear-field capability.
An explicit valid boolean `false` remains a real proposed change. Partial snapshots
that omit a proposed comparison field BLOCK rather than assume its value is null.

## Decisions and audit

- CREATE: no source/business-key collision; proposed valid fields and explicit
  current Food Connex provenance are listed as changes. Unspecified optional fields
  are absent, not invented.
- UPDATE: one exact Food Connex source match with the same code, active and current;
  only provided valid changed fields are listed, including before/after.
- SKIP: unchanged, excluded, or later byte-equivalent canonical duplicate. Findings
  distinguish these cases; compatibility `duplicates` counts all SKIPs.
- BLOCK: invalid fields, conflicting duplicate source IDs, code ownership conflict,
  ambiguous/multiple existing matches, case/whitespace variants, identity change,
  incomplete/wrong-scope snapshot, unknown fields or uncertain comparison values.

The plan has version, organization/source references, per-row findings, target IDs,
field diffs and reconciliation counts. Canonical SHA-256 input/snapshot/plan hashes
are stable for the same ordered proposal batch and snapshot contents, independent
of object-key or snapshot-row order. Snapshot `updated_at` changes alter its hash.
There is no volatile timestamp or random ID; the caller may associate the plan with
an actor/time outside the pure component. Results are deeply frozen and marked
`dry_run: true, executable: false`. No audit table/log is written. Plans contain field
values and belong only in authorized review/storage, never general application logs.

## Local validation and synthetic sample

Requires Node 24+ and the existing installed dependencies:

```sh
npm run test:import-planner
node_modules/.bin/tsc --noEmit --incremental false
node --import ./tests/register-server-only.mjs tests/customer-import-planner.example.mjs
```

The test-only hook resolves Next's `server-only` marker to its bundled server entry
and replaces the authenticated database context with synthetic read/write spies.
It does not remove the application's Next client-boundary protection. Tests never
load production credentials or make real database/network calls. Node may emit a
module-type detection warning; no package-wide ESM migration is needed.

Tests cover all ten requested cases, plus aliases, type validation, organization
scope, incomplete snapshots, field omissions, hash stability, snapshot paging,
read failures, immutable plans and the current-customer commit guard. The example
uses only synthetic customers and produces one CREATE, UPDATE, SKIP and BLOCK.

## Remaining work / next smallest step

Next: a Customer-only **read-only preview review UI** displaying the full plan and
findings, forwarding the actual source reference, and explicitly parsing typed
booleans/integers while retaining code strings. Keep confirmation/commit disabled.

Before any writer: approved plan hash/version binding, same-planner revalidation
against a current transactional snapshot, concurrency checks, explicit source-owner
approval, database constraints, atomic application and before-image rollback/audit
ledger. Snapshot paging is not a database point-in-time transaction. No production
behavior, schema deployment or real import was tested here. Source vendor status,
Ship-To defaults, identifier conflicts and order-guide/SKU holds in the migration
inventory remain unresolved. SPS owns EDI, QuickBooks accounting, SharePoint
controlled documents, and carriers their booking/tracking systems.
