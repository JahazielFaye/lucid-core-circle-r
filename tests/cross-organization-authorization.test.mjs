import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const tenancy = text('../supabase/migrations/025_user_organization_administration_foundation.sql');
const traceability = text('../supabase/migrations/013_traceability_foundation.sql');
const scanner = text('../supabase/migrations/024_scanner_configuration_admin_only.sql');
const weighing = text('../supabase/migrations/022_scanning_weighing_foundation.sql');
const operations = text('../supabase/migrations/016_operational_backbone_workflows.sql');
const inventory = text('../supabase/migrations/019_authoritative_production_inventory_consumption.sql');
const admin = text('../supabase/migrations/025_user_organization_administration_foundation.sql');
const dispatcher = text('../src/lib/integrations/lucid-operational-workflows.ts');
const inviteRoute = text('../src/app/api/admin/users/route.ts');
const profileRoute = text('../src/app/api/admin/users/[id]/route.ts');
const liveValidation = text('../docs/security/cross-organization-mutation-behavioral-validation.sql');

test('active organization resolution and core traceability records remain organization-scoped', () => {
  assert.match(tenancy, /where p\.id = auth\.uid\(\) and p\.active = true/);
  assert.match(tenancy, /join public\.organizations o on o\.id = p\.organization_id and o\.active = true/);

  for (const table of [
    'customers', 'customer_ship_tos', 'inventory_transactions', 'inventory_lots',
    'inventory_transaction_lines', 'production_runs', 'production_run_consumptions',
    'production_run_outputs', 'shipments', 'shipment_contents', 'case_pick_allocations',
    'pallet_case_assignments',
  ]) {
    const escaped = table.replaceAll('_', '\\_');
    assert.match(traceability, new RegExp(`on ${escaped} for all[\\s\\S]*?organization_id = current_org_id\\(\\)`));
  }
  assert.match(traceability, /The ship-to customer must belong to the same organization\./);
  assert.match(traceability, /The production run must belong to the same organization\./);
  assert.match(traceability, /Shipment contents must belong to the shipment organization\./);
});

test('native master data and scanner configuration reject foreign organization relationships', () => {
  assert.match(text('../supabase/migrations/014_customer_item_master_foundation.sql'), /Master data must belong to your organization\./);
  assert.match(traceability, /The ship-to customer must belong to the same organization\./);

  for (const table of ['production_stations', 'item_weight_bands', 'item_packaging_instructions']) {
    const escaped = table.replaceAll('_', '\\_');
    assert.match(scanner, new RegExp(`on public\\.${escaped}\\s+for select using \\(organization_id = public\\.current_org_id\\(\\)\\)`));
  }
  assert.match(scanner, /Scanner and weight data must belong to your organization\./);
  assert.match(scanner, /Weight band item must belong to your organization\./);
  assert.match(scanner, /Packaging item must belong to your organization\./);
});

test('production, inventory, allocation, pallet, and shipment RPCs derive organization from the actor', () => {
  assert.match(weighing, /where o\.id=p_order_id and o\.organization_id=actor\.organization_id/);
  assert.match(weighing, /where r\.id=p_weight_reading_id and r\.organization_id=actor\.organization_id/);
  assert.match(weighing, /where c\.id = p_production_case_id and c\.organization_id = actor\.organization_id/);
  assert.match(operations, /where id = p_production_run_id and organization_id = actor\.organization_id/);
  assert.match(operations, /where id = p_production_case_id and organization_id = actor\.organization_id/);
  assert.match(operations, /where o\.id = p_order_id and o\.organization_id = actor\.organization_id/);
  assert.match(inventory, /where pr\.id = p_production_run_id and pr\.organization_id = actor\.organization_id/);
  assert.match(inventory, /where il\.id = p_inventory_lot_id and il\.organization_id = actor\.organization_id/);
  assert.match(text('../supabase/migrations/011_fix_pallet_case_identifier_ambiguity.sql'), /pallet_row\.organization_id = current_profile\.organization_id/);
});

test('Admin management and browser dispatchers cannot accept a caller-selected organization', () => {
  for (const fn of ['admin_create_lucid_profile', 'admin_change_lucid_profile_role', 'admin_set_lucid_profile_active']) {
    assert.match(admin, new RegExp(`${fn}[\\s\\S]*?actor := public\\.require_lucid_admin_actor\\(\\)`));
  }
  assert.match(admin, /target\.organization_id <> actor\.organization_id/);
  assert.match(admin, /p\.id = p_target_profile_id and p\.organization_id = actor\.organization_id/);
  assert.match(inviteRoute, /requireActiveLucidRouteUser\(\['lucid_admin'\]\)/);
  assert.match(profileRoute, /requireActiveLucidRouteUser\(\['lucid_admin'\]\)/);
  assert.doesNotMatch(inviteRoute, /organizationId:\s*body/);
  assert.doesNotMatch(profileRoute, /organizationId:\s*body/);
  for (const field of ['actorId', 'actor_id', 'organizationId', 'organization_id', 'profileId', 'profile_id']) {
    assert.match(dispatcher, new RegExp(`['\"]${field}['\"]`));
  }
  assert.match(dispatcher, /Actor and organization are derived from your authenticated session\./);
});

test('the live cross-organization mutation validation is rollback-only and covers both directions', () => {
  assert.match(liveValidation, /^begin;/m);
  assert.match(liveValidation, /^set local role authenticated;/m);
  assert.match(liveValidation, /Circle R Beef/);
  assert.match(liveValidation, /lucid-qa-isolation/);
  assert.match(liveValidation, /Org A → Org B/);
  assert.match(liveValidation, /Org B → Org A/);
  assert.match(liveValidation, /admin_create_lucid_profile/);
  assert.match(liveValidation, /organization_id/);
  assert.match(liveValidation, /^rollback;/m);
});
