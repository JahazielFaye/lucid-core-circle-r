import test from 'node:test';
import assert from 'node:assert/strict';

import { classifyInvitationFailure } from '../src/lib/security/invitation-diagnostics.ts';

test('all supported Lucid roles reach the same Auth invitation boundary', async () => {
  const route = await import('node:fs/promises').then(fs => fs.readFile(new URL('../src/app/api/admin/users/route.ts', import.meta.url), 'utf8'));
  for (const role of ['leadership', 'office', 'production']) {
    assert.match(route, new RegExp(`['\"]${role}['\"]`));
  }
  assert.match(route, /inviteUserByEmail\(email, \{ data: \{ display_name: displayName \} \}\)/);
});

test('duplicate Auth users receive a safe duplicate classification', () => {
  const result = classifyInvitationFailure({ code: 'email_exists', status: 400 }, false);
  assert.equal(result.kind, 'duplicate_auth_user');
  assert.equal(result.responseStatus, 400);
  assert.equal(result.code, 'email_exists');
});

test('Supabase email and request limits retain a safe 429 response', () => {
  for (const error of [{ code: 'over_email_send_rate_limit', status: 429 }, { code: 'over_request_rate_limit', status: 429 }, { code: 'unexpected', status: 429 }]) {
    const result = classifyInvitationFailure(error, false);
    assert.equal(result.kind, 'rate_limited');
    assert.equal(result.responseStatus, 429);
  }
});

test('email configuration, Auth failures, and missing responses remain safe', () => {
  assert.equal(classifyInvitationFailure({ code: 'email_address_not_authorized', status: 400 }, false).kind, 'email_delivery_or_configuration');
  assert.equal(classifyInvitationFailure({ code: 'unexpected_failure', status: 503 }, false).kind, 'auth_service_failure');
  const missing = classifyInvitationFailure(null, false);
  assert.equal(missing.kind, 'invalid_auth_response');
  assert.doesNotMatch(missing.publicMessage, /email may already have/i);
});

test('diagnostic classification never retains raw provider message text', () => {
  const result = classifyInvitationFailure({ code: 'over_email_send_rate_limit', status: 429, message: 'private provider detail' }, false);
  assert.deepEqual(Object.keys(result).sort(), ['code', 'kind', 'publicMessage', 'receivedUser', 'responseStatus', 'status'].sort());
  assert.doesNotMatch(JSON.stringify(result), /private provider detail/);
});
