import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activePalletCaseIds } from '../src/lib/production/pallet-membership.ts';

const text = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = text('../supabase/migrations/027_pallet_scanning_workflow.sql');
const securityPatch = text('../supabase/migrations/028_revoke_legacy_pallet_remove_execute.sql');
const hardeningPatch = text('../supabase/migrations/029_harden_pallet_rpc_execute_privileges.sql');
const page = text('../src/app/page.tsx');
const scanCapture = text('../src/components/scan-capture.tsx');

test('pallet sequence is durable, backfilled, and unique per organization/order', () => {
  assert.match(migration, /add column if not exists pallet_sequence integer/);
  assert.match(migration, /row_number\(\) over[\s\S]*partition by p\.organization_id, p\.order_id/);
  assert.match(migration, /pallets_org_order_sequence_unique/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /coalesce\(max\(p\.pallet_sequence\), 0\) \+ 1/);
});

test('atomic move locks the case and both building pallets before replacing the legacy relationship', () => {
  assert.match(migration, /move_lucid_case_between_pallets/);
  assert.match(migration, /target_case[\s\S]*for update/);
  assert.match(migration, /p\.id in \(target_case\.pallet_id, p_target_pallet_id\)[\s\S]*for update/);
  assert.match(migration, /source_pallet\.order_id <> destination_pallet\.order_id/);
  assert.match(migration, /delete from public\.pallet_cases/);
  assert.match(migration, /insert into public\.pallet_cases/);
  assert.match(migration, /case moved between pallets/);
  assert.match(migration, /actor\.role not in \('office', 'leadership', 'lucid_admin'\)/);
});

test('corrections require authorized reason while production retains normal build actions', () => {
  assert.match(migration, /A correction reason is required to remove a case/);
  assert.match(migration, /A correction reason is required to move a case/);
  assert.match(page, /const canCorrect = \['office', 'leadership', 'lucid_admin'\]\.includes\(role\)/);
  assert.match(page, /Scan or enter Case ID/);
  assert.match(page, /onRawCapture/);
});

test('pallet preview is internal-only and never claims GS1 or SSCC', () => {
  assert.match(page, /Internal Lucid Code 39 reference only\. SSCC and GS1 are not configured/);
  assert.match(text('../src/components/lucid-internal-barcode.tsx'), /true Code 39 rendering/);
  assert.match(page, /Physical printing is not configured/);
  assert.doesNotMatch(page, /window\.print\(\)/);
});

test('raw scanner capture supports keyboard/camera/manual without weakening item-resolution callers', () => {
  assert.match(scanCapture, /onRawCapture\?:/);
  assert.match(scanCapture, /onRawCapture\?\.\(raw\.trim\(\), source\)/);
  assert.match(scanCapture, /onResolved\?\.\(result\)/);
});

test('pallet preview avoids newer collection/string helpers that can crash older mobile WebViews', () => {
  const barcode = text('../src/components/lucid-internal-barcode.tsx');
  assert.doesNotMatch(barcode, /\.flatMap\(/);
  assert.match(barcode, /for \(const character of encoded\)/);
  assert.doesNotMatch(page, /\.at\(-1\)/);
});

test('removed pallet assignment history never contributes to current pallet membership or totals', () => {
  const assignments = [
    { pallet_id: 'pallet-1', production_case_id: 'case-1', status: 'removed' },
    { pallet_id: 'pallet-2', production_case_id: 'case-1', status: 'active' },
  ];
  const sourceMembers = activePalletCaseIds(assignments, 'pallet-1');
  const destinationMembers = activePalletCaseIds(assignments, 'pallet-2');
  const cases = [{ id: 'case-1', quantity: 1, net_weight: 20.5 }];
  const sourceCases = cases.filter(productionCase => sourceMembers.has(productionCase.id));
  const destinationCases = cases.filter(productionCase => destinationMembers.has(productionCase.id));
  assert.deepEqual([...sourceMembers], []);
  assert.deepEqual([...destinationMembers], ['case-1']);
  assert.equal(sourceCases.length, 0);
  assert.equal(sourceCases.reduce((total, productionCase) => total + productionCase.net_weight, 0), 0);
  assert.equal(destinationCases.length, 1);
  assert.equal(destinationCases.reduce((total, productionCase) => total + productionCase.net_weight, 0), 20.5);
  assert.equal([...assignments].filter(assignment => assignment.status === 'active').length, 1);
  assert.match(page, /activePalletCaseIds\(assignments, selectedPallet\.id\)/);
});

test('corrective pallet history renders persisted reasons without inventing reasons for normal events', () => {
  assert.match(page, /function palletActivityReason/);
  assert.match(page, /\['case moved between pallets', 'case removed from pallet', 'pallet reopened for correction'\]/);
  assert.match(page, /Reason: \{reason\}/);
  assert.match(page, /typeof values\.reason === 'string'/);
  assert.doesNotMatch(page, /Reason: not provided/);
});

test('every pallet RPC signature explicitly revokes default public and anonymous execution', () => {
  for (const signature of [
    'create_lucid_pallet\\(uuid\\)',
    'add_lucid_case_to_pallet\\(uuid, text\\)',
    'remove_lucid_case_from_pallet\\(uuid, uuid\\)',
    'remove_lucid_case_from_pallet\\(uuid, uuid, text\\)',
    'move_lucid_case_between_pallets\\(uuid, uuid, text\\)',
    'complete_lucid_pallet\\(uuid\\)',
    'reopen_lucid_pallet\\(uuid, text\\)',
  ]) {
    assert.match(securityPatch, new RegExp(`revoke execute on function public\\.${signature} from public, anon;`));
    assert.match(securityPatch, new RegExp(`grant execute on function public\\.${signature} to authenticated;`));
  }
});

test('the forward hardening patch clears all direct public/anon privileges before granting authenticated execution', () => {
  assert.match(hardeningPatch, /revoke all privileges on function public\.remove_lucid_case_from_pallet\(uuid, uuid\) from public, anon;/);
  assert.match(hardeningPatch, /revoke all privileges on function public\.create_lucid_pallet\(uuid\) from public, anon;/);
  assert.match(hardeningPatch, /revoke all privileges on function public\.reopen_lucid_pallet\(uuid, text\) from public, anon;/);
});
