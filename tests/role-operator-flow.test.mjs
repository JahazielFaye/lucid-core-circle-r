import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = text('../supabase/migrations/022_scanning_weighing_foundation.sql');
const roleIsolationMigration = text('../supabase/migrations/024_scanner_configuration_admin_only.sql');
const production = text('../src/app/page.tsx');
const correctionRoute = text('../src/app/api/production/cases/[id]/weight-corrections/route.ts');

test('scanner and atomic case RPCs keep production capture roles explicit', () => {
  const captures = migration.match(/actor\.role not in \('production','office','leadership','lucid_admin'\)/g) || [];
  assert.ok(captures.length >= 2);
  assert.match(migration, /Weight reading has already been used for another case/);
  assert.match(migration, /weight_operation_key/);
});

test('weight corrections are denied to production and remain an append-only path', () => {
  assert.match(migration, /actor\.role not in \('office','leadership','lucid_admin'\)/);
  assert.match(migration, /Weight capture history is immutable\. Record a correction event instead\./);
  assert.match(correctionRoute, /correctLucidProductionCaseWeight/);
  assert.match(production, /const canCorrectWeight = role === 'office' \|\| role === 'leadership' \|\| role === 'lucid_admin'/);
});

test('admin-only hardware diagnostics remain explicitly gated', () => {
  const diagnostics = text('../src/components/hardware-diagnostics.tsx');
  assert.match(diagnostics, /role !== 'lucid_admin'/);
});

test('scanner configuration preserves same-org reads but makes every write admin-only', () => {
  for (const table of ['production_stations', 'item_weight_bands', 'item_packaging_instructions']) {
    assert.match(roleIsolationMigration, new RegExp(`on public\\.${table}[\\s\\S]*?for select using \\(organization_id = public\\.current_org_id\\(\\)\\)`));
    assert.match(roleIsolationMigration, new RegExp(`on public\\.${table}[\\s\\S]*?p\\.role = 'lucid_admin'`));
  }
  assert.match(roleIsolationMigration, /actor\.role <> 'lucid_admin'/);
  assert.doesNotMatch(roleIsolationMigration, /actor\.role not in \('lucid_admin','leadership','office'\)/);
});

test('operator UI resolves scans before capture and labels manual entry honestly', () => {
  assert.match(production, /Scan an item to start Weigh Mode/);
  assert.match(production, /Manual weight entry/);
  assert.match(production, /manualWeightReading\(weight\)/);
  assert.match(production, /Create Case & Preview Label/);
  assert.match(production, /preview only/);
});

test('cross-organization scope is enforced in scanner and correction SQL', () => {
  assert.match(migration, /organization_id=actor\.organization_id/);
  assert.match(migration, /Case and weight event must belong to your organization/);
  assert.match(migration, /Production case station must belong to your organization/);
});
