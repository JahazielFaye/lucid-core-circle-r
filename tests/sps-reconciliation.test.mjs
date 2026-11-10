import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = text('../supabase/migrations/030_sps_reconciliation_hardening.sql');
const staging = text('../src/lib/integrations/circle-r-sps-staging.ts');
const mapper = text('../src/lib/integrations/circle-r-po-mapper.ts');
const reuse = text('../src/lib/integrations/sps-staging-mapping-reuse.ts');
const promotion = text('../src/lib/integrations/sps-order-promotion.ts');
const page = text('../src/app/page.tsx');
const preflight = text('../docs/security/030-sps-reconciliation-preflight.sql');
const postApply = text('../docs/security/030-sps-reconciliation-post-apply-verify.sql');

test('SPS source documents preserve 850/860 identity separately from the business PO', () => {
  for (const field of ['document_type', 'sps_id', 'fulfillment_document_id', 'business_po_number', 'source_filename', 'payload_hash', 'source_document_key']) assert.match(migration, new RegExp(`add column if not exists ${field}`));
  assert.match(migration, /drop index if exists public\.sps_staged_orders_partner_po_unique/);
  assert.match(migration, /sps_staged_orders_source_document_key_unique/);
  assert.match(staging, /const documentType = '850'/);
  assert.match(staging, /sourceDocumentKey/);
});

test('identical retries reuse evidence while promoted or conflicting documents are never silently replaced', () => {
  assert.match(staging, /current\.review_status === 'promoted' \|\| current\.payload_hash === payloadHash/);
  assert.match(staging, /SOURCE_DOCUMENT_CONFLICT/);
  assert.match(staging, /review_status: 'needs_review'/);
  assert.match(staging, /if \(stagedOrder\.reused\)/);
  assert.match(staging, /source-identity conflict must never refresh staged evidence/);
  assert.match(staging, /existingOrder\?\.review_status === 'promoted'/);
});

test('promoted SPS source evidence is immutable at the database boundary while unpromoted review remains writable', () => {
  assert.match(migration, /create or replace function public\.protect_lucid_promoted_sps_source\(\)/);
  assert.match(migration, /Promoted SPS source documents are immutable\./);
  for (const trigger of ['protect_lucid_promoted_sps_staged_order', 'protect_lucid_promoted_sps_staged_line', 'protect_lucid_promoted_sps_exception']) {
    assert.match(migration, new RegExp(`create trigger ${trigger}`));
  }
  assert.match(migration, /before update or delete on public\.sps_staged_orders/);
  assert.match(migration, /before insert or update or delete on public\.sps_staged_order_lines/);
  assert.match(migration, /before insert or update or delete on public\.sps_order_exceptions/);
  assert.doesNotMatch(migration, /protect_lucid_promoted_sps_staged_order before insert/);
});

test('850 and 860 documents remain independently identifiable, but 860 cannot promote', () => {
  assert.match(migration, /if staged\.document_type = '860' then raise exception 'Purchase Order Change requires review and cannot be promoted as a new order\.'/);
  assert.match(migration, /document_type is null or document_type in \('850', '860'\)/);
  assert.match(migration, /sps_staged_orders_source_document_key_unique/);
  assert.doesNotMatch(migration, /unique .*business_po_number/i);
});

test('parent staged documents are enforced as same-organization relationships', () => {
  assert.match(migration, /create or replace function public\.validate_lucid_sps_parent_scope\(\)/);
  assert.match(migration, /parent_order\.organization_id = new\.organization_id/);
  assert.match(migration, /An SPS source document parent must belong to the same organization\./);
  assert.match(migration, /before insert or update of parent_staged_order_id, organization_id on public\.sps_staged_orders/);
});

test('item reconciliation detects conflicting authoritative candidates rather than selecting the first match', () => {
  assert.match(reuse, /ambiguousLineNumbers/);
  assert.match(reuse, /targetKeys\.size > 1/);
  assert.match(staging, /ITEM_MAPPING_AMBIGUOUS/);
  assert.match(staging, /More than one explicit Lucid item mapping matches this SPS line/);
});

test('quantity and exact-UOM conflicts are blocking reconciliation conditions', () => {
  assert.match(mapper, /code: 'UOM_MISMATCH',\s*severity: 'blocking'/);
  assert.match(mapper, /code: 'INVALID_QUANTITY', severity: 'blocking'/);
  assert.match(migration, /l\.quantity is null or l\.quantity <= 0 or l\.sps_uom is null or l\.uom_status <> 'match'/);
});

test('Production is denied staging, mapping, exception, and promotion mutation at the database and route boundaries', () => {
  assert.match(migration, /actor\.role not in \('office', 'leadership', 'lucid_admin'\)/);
  for (const table of ['integration_customer_mappings', 'integration_ship_to_mappings', 'integration_item_mappings', 'sps_staged_orders', 'sps_staged_order_lines', 'sps_order_exceptions']) assert.match(migration, new RegExp(`enforce_lucid_sps_.*write_role[\\s\\S]*${table}|on public\\.${table} for each row execute function public\\.assert_lucid_sps_write_role`));
  for (const route of ['import-sandbox-po', 'import-new-sandbox-pos', 'reimport-canonical-sandbox-po']) assert.match(text(`../src/app/api/sps/${route}/route.ts`), /requireActiveLucidRouteUser\(\['office', 'leadership', 'lucid_admin'\]\)/);
  assert.match(promotion, /\['office', 'leadership', 'lucid_admin'\]/);
  assert.match(migration, /if tg_op = 'DELETE' then target_organization_id := old\.organization_id;/);
  assert.match(migration, /if tg_op = 'DELETE' then payload := to_jsonb\(old\);/);
});

test('Office, Leadership, and Lucid Admin retain the intended SPS reconciliation mutation path', () => {
  assert.match(migration, /actor\.role not in \('office', 'leadership', 'lucid_admin'\)/);
  assert.match(migration, /grant execute on function public\.promote_sps_staged_order\(uuid\) to authenticated/);
  assert.match(migration, /if actor\.organization_id is distinct from target_organization_id then/);
});

test('promotion remains authenticated, org-derived, idempotent, and audit-backed', () => {
  assert.match(migration, /where s\.id = p_staged_order_id and s\.organization_id = actor\.organization_id for update/);
  assert.match(migration, /if found then return query select existing_order_id, true/);
  assert.match(migration, /promoted SPS order to Lucid operational order/);
  assert.match(migration, /revoke all on function public\.promote_sps_staged_order\(uuid\) from public, anon/);
});

test('Order Review exposes source-document identity and clear readiness without claiming an SPS acknowledgment', () => {
  assert.match(page, /Source document/);
  assert.match(page, /Ready to promote/);
  assert.match(page, /Change order review required/);
  assert.doesNotMatch(page, /SPS acknowledgment sent/);
});

test('030 release gates are read-only, distinguish grandfathered evidence, and report an explicit final decision', () => {
  assert.match(preflight, /Read-only data-safety release gate/);
  assert.match(preflight, /to_jsonb\(s\)->>'source_document_key'/);
  assert.match(preflight, /legacy rows without durable source identity/);
  assert.match(preflight, /SAFE TO APPLY 030/);
  assert.match(preflight, /BLOCKERS FOUND/);
  assert.doesNotMatch(preflight, /\b(insert|update|delete|alter|create|drop)\b/i);
  assert.match(postApply, /POST-APPLY VERIFICATION PASS/);
  assert.match(postApply, /promoted source immutability/);
  assert.match(postApply, /parent same-org scope/);
  assert.match(postApply, /860 denial/);
});
