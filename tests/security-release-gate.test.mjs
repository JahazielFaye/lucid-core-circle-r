import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const text = path => readFileSync(new URL(path, root), 'utf8');

test('security baseline and environment protections are present', () => {
  assert.match(text('./docs/security/security-baseline.md'), /Security failures are release blockers/);
  const ignore = text('./.gitignore');
  assert.match(ignore, /\.env\.\*/); assert.doesNotMatch(ignore, /\.env\.local\n!/);
});

test('client code contains no service-role credential reference', () => {
  const clientSources = [text('./src/utils/supabase/client.ts'), text('./src/lib/supabase/client.ts')].join('\n');
  assert.doesNotMatch(clientSources, /service_role|SUPABASE_SERVICE/i);
  assert.match(clientSources, /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/);
});

test('scanner parser constrains untrusted payloads before resolution', () => {
  const parser = text('./src/lib/scanning/gs1.ts');
  assert.match(parser, /raw\.includes\('\('/);
});

test('all browser import paths use the shared hardened CSV reader', () => {
  assert.match(text('./src/components/customer-import-plan-review.tsx'), /readCustomerFile/);
  assert.match(text('./src/components/historical-import-workspace.tsx'), /readHardenedCsv/);
  assert.match(text('./src/lib/security/hardened-csv.ts'), /Papa\.parse/);
});

test('production security headers and same-origin API posture are configured', () => {
  const config = text('./next.config.ts');
  for (const directive of ['default-src', "frame-ancestors 'none'", 'connect-src', 'worker-src', 'Permissions-Policy']) assert.match(config, new RegExp(directive.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('operational workflow dispatcher is deny-by-default and rejects browser identity fields', () => {
  const workflow = text('./src/lib/integrations/lucid-operational-workflows.ts');
  assert.match(workflow, /externalActions\.has\(action\)/);
  assert.match(workflow, /Unknown operational workflow action/);
  assert.match(workflow, /Actor and organization are derived from your authenticated session/);
  assert.match(workflow, /requireActiveLucidRouteUser/);
});
