import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const scannerConfiguration = text('../supabase/migrations/024_scanner_configuration_admin_only.sql');
const scanningFoundation = text('../supabase/migrations/022_scanning_weighing_foundation.sql');
const masterDataFoundation = text('../supabase/migrations/014_customer_item_master_foundation.sql');
const adminFoundation = text('../supabase/migrations/025_user_organization_administration_foundation.sql');
const helperGrantPatch = text('../supabase/migrations/026_revoke_admin_helper_direct_execute.sql');
const leadershipAdminValidation = text('../docs/security/025-leadership-admin-denial-behavioral-validation.sql');
const routeAuthorization = text('../src/lib/security/route-auth.ts');
const inviteRoute = text('../src/app/api/admin/users/route.ts');
const profileRoute = text('../src/app/api/admin/users/[id]/route.ts');

const configurationTables = [
  ['production_stations', 'scanner stations'],
  ['item_weight_bands', 'scanner bands'],
  ['item_packaging_instructions', 'scanner packaging'],
];

test('Leadership has same-organization configuration reads but no scanner configuration mutation path', () => {
  assert.match(scannerConfiguration, /actor\.role <> 'lucid_admin'/);
  assert.match(scannerConfiguration, /Only Lucid Admin can change scanner and weighing configuration\./);

  for (const [table, policyPrefix] of configurationTables) {
    const escapedTable = table.replaceAll('_', '\\_');
    assert.match(scannerConfiguration, new RegExp(`on public\\.${escapedTable}\\s+for select using \\(organization_id = public\\.current_org_id\\(\\)\\)`));
    assert.match(scannerConfiguration, new RegExp(`create policy "${policyPrefix} admin insert" on public\\.${escapedTable}[\\s\\S]*?p\\.role = 'lucid_admin'`));
    assert.match(scannerConfiguration, new RegExp(`create policy "${policyPrefix} admin update" on public\\.${escapedTable}[\\s\\S]*?for update using[\\s\\S]*?p\\.role = 'lucid_admin'[\\s\\S]*?with check[\\s\\S]*?p\\.role = 'lucid_admin'`));
    assert.match(scannerConfiguration, new RegExp(`create policy "${policyPrefix} admin delete" on public\\.${escapedTable}[\\s\\S]*?for delete using[\\s\\S]*?p\\.role = 'lucid_admin'`));
  }

  assert.match(scannerConfiguration, /p\.active = true and p\.organization_id = public\.current_org_id\(\)/);
  assert.match(scanningFoundation, /create trigger enforce_lucid_scanning_station_scope before insert or update on production_stations/);
  assert.match(scanningFoundation, /create trigger enforce_lucid_scanning_band_scope before insert or update on item_weight_bands/);
  assert.match(scanningFoundation, /create trigger enforce_lucid_scanning_packaging_scope before insert or update on item_packaging_instructions/);
});

test('Leadership is rejected before every Admin user-management API mutation and controlled RPC', () => {
  assert.match(routeAuthorization, /if \(roles && !roles\.includes\(profile\.role as LucidRole\)\)[\s\S]*?RouteAuthorizationError\('Your role is not authorized for this action\.', 403\)/);
  assert.match(inviteRoute, /requireActiveLucidRouteUser\(\['lucid_admin'\]\)/);
  assert.match(profileRoute, /requireActiveLucidRouteUser\(\['lucid_admin'\]\)/);

  for (const rpc of ['admin_create_lucid_profile', 'admin_change_lucid_profile_role', 'admin_set_lucid_profile_active']) {
    assert.match(adminFoundation, new RegExp(`function public\\.${rpc}`));
    assert.match(adminFoundation, new RegExp(`${rpc}[\\s\\S]*?actor := public\\.require_lucid_admin_actor\\(\\)`));
  }
  assert.match(adminFoundation, /if actor\.role <> 'lucid_admin' then raise exception 'Only Lucid Admin can manage users\.';/);
  assert.match(helperGrantPatch, /revoke all on function public\.require_lucid_admin_actor\(\) from authenticated/);
  assert.match(leadershipAdminValidation, /set local role authenticated/);
  assert.match(leadershipAdminValidation, /admin_create_lucid_profile/);
  assert.match(leadershipAdminValidation, /admin_change_lucid_profile_role/);
  assert.match(leadershipAdminValidation, /admin_set_lucid_profile_active/);
  assert.match(leadershipAdminValidation, /Only Lucid Admin can manage users\./);
  assert.match(leadershipAdminValidation, /rollback;/);
});

test('Leadership retains the intended operational correction and master-data roles', () => {
  assert.match(scanningFoundation, /actor\.role not in \('office','leadership','lucid_admin'\)/);
  assert.match(masterDataFoundation, /actor\.role not in \('lucid_admin', 'leadership', 'office'\)/);
});
