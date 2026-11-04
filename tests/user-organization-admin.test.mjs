import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const text = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const migration = text('../supabase/migrations/025_user_organization_administration_foundation.sql');
const inviteRoute = text('../src/app/api/admin/users/route.ts');
const userRoute = text('../src/app/api/admin/users/[id]/route.ts');
const adminClient = text('../src/lib/supabase/admin.ts');
const helperGrantPatch = text('../supabase/migrations/026_revoke_admin_helper_direct_execute.sql');

test('active profiles alone resolve an organization for RLS', () => {
  assert.match(migration, /add column if not exists active boolean not null default true/);
  assert.match(migration, /where p\.id = auth\.uid\(\) and p\.active = true/);
  assert.match(migration, /join public\.organizations o on o\.id = p\.organization_id and o\.active = true/);
});

test('organization deactivation cannot strand active profiles outside the organization gate', () => {
  assert.match(migration, /prevent_inactive_organization_with_active_profiles/);
  assert.match(migration, /where p\.organization_id = new\.id/);
  assert.match(migration, /and p\.active = true/);
});

test('inactive identities lose RLS organization resolution and protected scanner RPCs still require active actors', () => {
  const scannerMigration = text('../supabase/migrations/022_scanning_weighing_foundation.sql');
  assert.match(migration, /where p\.id = auth\.uid\(\) and p\.active = true/);
  assert.match(scannerMigration, /where p\.id=auth\.uid\(\) and p\.active=true/);
  assert.match(scannerMigration, /where p\.id = auth\.uid\(\) and p\.active = true/);
});

test('profile mutations are admin-only, same-org, self-protected, and audited', () => {
  for (const fn of ['admin_change_lucid_profile_role', 'admin_set_lucid_profile_active', 'admin_create_lucid_profile']) assert.match(migration, new RegExp(`function public\\.${fn}`));
  assert.match(migration, /Only Lucid Admin can manage users/);
  assert.match(migration, /You cannot change your own role/);
  assert.match(migration, /You cannot change your own active state/);
  assert.match(migration, /organization_id = actor\.organization_id/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('lucid-admin-coverage:'/);
  assert.match(migration, /user role changed/);
  assert.match(migration, /user deactivated/);
  assert.match(migration, /user reactivated/);
});

test('profile table has no generic write policy and same-org active profiles remain readable', () => {
  assert.match(migration, /create policy "profiles active same org read"/);
  assert.doesNotMatch(migration, /on public\.profiles\s+for update/);
  assert.match(migration, /revoke all on function public\.admin_change_lucid_profile_role/);
  assert.match(migration, /grant execute on function public\.admin_set_lucid_profile_active.*authenticated/);
});

test('invite route derives authority from the active Admin session and never accepts an organization', () => {
  assert.match(inviteRoute, /requireActiveLucidRouteUser\(\['lucid_admin'\]\)/);
  assert.match(inviteRoute, /inviteUserByEmail/);
  assert.match(inviteRoute, /admin_create_lucid_profile/);
  assert.doesNotMatch(inviteRoute, /organizationId:\s*body/);
  assert.match(adminClient, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(adminClient, /server-only/);
  assert.doesNotMatch(text('../src/app/page.tsx'), /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(text('../src/components/admin-users-workspace.tsx'), /SUPABASE_SERVICE_ROLE_KEY/);
});

test('invite cleanup does not falsely claim success if the Auth cleanup fails', () => {
  assert.match(inviteRoute, /profile finalization and invite cleanup failed/);
  assert.match(inviteRoute, /pending invitation before retrying/);
  assert.doesNotMatch(inviteRoute, /console\.error\([^\n]*SUPABASE_SERVICE_ROLE_KEY/);
});

test('role and active-state API calls remain controlled RPCs', () => {
  assert.match(userRoute, /admin_change_lucid_profile_role/);
  assert.match(userRoute, /admin_set_lucid_profile_active/);
  assert.match(userRoute, /requireActiveLucidRouteUser\(\['lucid_admin'\]\)/);
});

test('the internal Admin helper is not directly executable by authenticated callers', () => {
  assert.match(helperGrantPatch, /revoke all on function public\.require_lucid_admin_actor\(\) from public/);
  assert.match(helperGrantPatch, /revoke all on function public\.require_lucid_admin_actor\(\) from anon/);
  assert.match(helperGrantPatch, /revoke all on function public\.require_lucid_admin_actor\(\) from authenticated/);
  assert.doesNotMatch(helperGrantPatch, /grant execute on function public\.require_lucid_admin_actor\(\) to authenticated/);
});
