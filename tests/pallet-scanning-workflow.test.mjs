import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activePalletCaseIds } from '../src/lib/production/pallet-membership.ts';

const text = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = text('../supabase/migrations/027_pallet_scanning_workflow.sql');
const palletCaseRpc = text('../supabase/migrations/011_fix_pallet_case_identifier_ambiguity.sql');
const palletCorrections = text('../supabase/migrations/012_pallet_collaboration_corrections.sql');
const securityPatch = text('../supabase/migrations/028_revoke_legacy_pallet_remove_execute.sql');
const hardeningPatch = text('../supabase/migrations/029_harden_pallet_rpc_execute_privileges.sql');
const authorizationValidation = text('../docs/security/027-pallet-rpc-authorization-behavioral-validation.sql');
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

test('the add-case RPC rejects completed pallets before it can create a legacy or durable membership side effect', () => {
  const addCaseFunction = palletCaseRpc.match(/create or replace function add_lucid_case_to_pallet[\s\S]*?\n\$\$;/)?.[0] || '';
  assert.match(addCaseFunction, /if target_pallet\.status <> 'building' then raise exception 'This pallet is complete and cannot be changed\.'; end if;/);
  assert.match(addCaseFunction, /insert into pallet_cases/);
  assert.match(addCaseFunction, /update production_cases as case_row\s+set pallet_id = target_pallet\.id, status = 'palletized'/);
  assert.match(addCaseFunction, /'case added to pallet'/);
  assert.ok(
    addCaseFunction.indexOf("This pallet is complete and cannot be changed.") < addCaseFunction.indexOf('insert into pallet_cases'),
    'completed status must be checked before membership insert',
  );
  assert.ok(
    addCaseFunction.indexOf("This pallet is complete and cannot be changed.") < addCaseFunction.indexOf("'case added to pallet'"),
    'completed status must be checked before the audit insert',
  );
});

test('Production is rejected by every pallet correction RPC while Office, Leadership, and Lucid Admin remain authorized', () => {
  const removeFunction = migration.match(/create or replace function public\.remove_lucid_case_from_pallet\([\s\S]*?\n\$\$;/)?.[0] || '';
  const moveFunction = migration.match(/create or replace function public\.move_lucid_case_between_pallets[\s\S]*?\n\$\$;/)?.[0] || '';
  const reopenFunction = palletCorrections.match(/create or replace function reopen_lucid_pallet[\s\S]*?\n\$\$;/)?.[0] || '';
  for (const fn of [removeFunction, moveFunction, reopenFunction]) {
    assert.match(fn, /(?:actor|current_profile)\.role not in \('office', 'leadership', 'lucid_admin'\)/);
    assert.doesNotMatch(fn, /'production'/);
  }
  assert.match(removeFunction, /A correction reason is required to remove a case/);
  assert.match(moveFunction, /A correction reason is required to move a case/);
  assert.match(reopenFunction, /A correction reason is required to reopen this pallet/);
});

test('durable assignment and completion invariants remain enforced by the backend foundation', () => {
  const traceability = text('../supabase/migrations/013_traceability_foundation.sql');
  assert.match(traceability, /create unique index if not exists pallet_case_assignments_one_active_case_idx\s+on pallet_case_assignments \(production_case_id\) where status = 'active';/);
  assert.match(traceability, /create trigger sync_trace_pallet_case_assignment_insert/);
  assert.match(traceability, /create trigger sync_trace_pallet_case_assignment_delete/);
  assert.match(palletCorrections, /if target_pallet\.status <> 'complete' then raise exception 'Only completed pallets can be reopened for correction\.'; end if;/);
  assert.match(palletCorrections, /set status = 'building'/);
});

test('the rollback-only pallet authorization validation exercises completed-pallet, Production, and authorized correction RPC paths', () => {
  assert.match(authorizationValidation, /^begin;/m);
  assert.match(authorizationValidation, /^set local role authenticated;/m);
  assert.match(authorizationValidation, /add_lucid_case_to_pallet\(f\.completed_pallet_id, 'QA-027-PALLET-CASE-2'\)/);
  assert.match(authorizationValidation, /Completed-pallet add denial left a side effect/);
  for (const rpc of ['remove_lucid_case_from_pallet', 'move_lucid_case_between_pallets', 'reopen_lucid_pallet']) {
    assert.match(authorizationValidation, new RegExp(`public\\.${rpc}`));
  }
  assert.match(authorizationValidation, /QA Office correction authorization/);
  assert.match(authorizationValidation, /QA Leadership move authorization/);
  assert.match(authorizationValidation, /QA Admin move authorization/);
  assert.match(authorizationValidation, /exactly one active durable pallet assignment/);
  assert.match(authorizationValidation, /^rollback;/m);
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
