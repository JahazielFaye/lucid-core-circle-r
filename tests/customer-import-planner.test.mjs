import assert from 'node:assert/strict';
import test from 'node:test';
import { planCustomerImport, previewCustomerImport } from '../src/lib/integrations/customer-import-planner.ts';
import { org, proposed, customer, request, snapshot } from './customer-import-planner.fixtures.mjs';
const decide = (rows = [proposed()], records = []) => planCustomerImport(request(rows), snapshot(records));
const codes = row => row.findings.map(finding => finding.code);

test('new customer CREATE contains provenance and preserves identifier text', () => {
  const plan = decide();
  assert.deepEqual(plan.counts, { total: 1, CREATE: 1, UPDATE: 0, SKIP: 0, BLOCK: 0 });
  assert.equal(plan.rows[0].changes.find(c => c.field === 'customer_code').after, '0000123');
  assert.equal(plan.rows[0].changes.find(c => c.field === 'source_system').after, 'food_connex');
  assert.equal(plan.rows[0].changes.find(c => c.field === 'is_historical').after, false);
  assert.equal(plan.dry_run, true); assert.equal(plan.executable, false);
});
test('exact source match plans UPDATE with field-level before/after and existing ID', () => {
  const plan = decide([proposed({ city: 'Synthetic City' })], [customer({ city: 'Previous Synthetic City' })]);
  assert.equal(plan.rows[0].decision, 'UPDATE');
  assert.equal(plan.rows[0].matched_id, 'synthetic-customer-id');
  assert.deepEqual(plan.rows[0].changes, [{ field: 'city', before: 'Previous Synthetic City', after: 'Synthetic City' }]);
});
test('identical repeat against existing snapshot is a SKIP', () => {
  const plan = decide([proposed()], [customer()]);
  assert.equal(plan.rows[0].decision, 'SKIP'); assert.deepEqual(plan.rows[0].changes, []);
  assert.ok(codes(plan.rows[0]).includes('UNCHANGED'));
});
test('same code on Lucid-native or different Food Connex record is blocked', () => {
  for (const record of [customer({ source_system: 'lucid_core', source_record_id: null }), customer({ source_record_id: 'OTHER-SOURCE' })]) {
    const row = decide([proposed()], [record]).rows[0];
    assert.equal(row.decision, 'BLOCK'); assert.ok(codes(row).includes('CUSTOMER_CODE_CONFLICT'));
  }
});
test('source match cannot rename its customer code', () => {
  assert.ok(codes(decide([proposed({ customer_code: 'DIFFERENT-CODE' })], [customer()]).rows[0]).includes('IDENTITY_CHANGE'));
});
test('required IDs, name and explicit active status are validated', () => {
  for (const field of ['source_record_id', 'customer_code', 'name', 'status']) {
    const row = proposed(); delete row[field];
    assert.equal(decide([row]).rows[0].decision, 'BLOCK', field);
  }
});
test('blank, null, redacted and missing optional values never erase existing fields', () => {
  const existing = customer({ phone: '555-0100', city: 'Synthetic City', address_line_1: 'Synthetic Street', po_required: true });
  for (const value of [undefined, null, '', '  ', '<redacted>', '[REDACTED]', 'Redacted by browser tool', 'Blank in source', 'Not captured', '***', 'REDACTED', '(redacted)', '***-***-1234', 'j***@example.invalid', 'XXX-XXX-1234']) {
    const row = decide([proposed({ phone: value, city: null, address_line_1: ' ', po_required: null })], [existing]).rows[0];
    assert.equal(row.decision, 'SKIP'); assert.deepEqual(row.changes, []);
  }
});
test('required names cannot be redaction placeholders', () => {
  assert.equal(decide([proposed({ name: '<redacted>' })]).rows[0].decision, 'BLOCK');
});
test('numeric IDs are rejected instead of coercing away leading zeros', () => {
  for (const field of ['customer_code', 'source_record_id']) assert.equal(decide([proposed({ [field]: 123 })]).rows[0].decision, 'BLOCK');
});
test('codes preserve case, spaces, slashes, punctuation and leading zeros exactly', () => {
  const code = ' 0000123 / QA ';
  const row = decide([proposed({ customer_code: code, source_record_id: code })]).rows[0];
  assert.equal(row.customer_code, code); assert.equal(row.source_record_id, code);
  assert.equal(row.changes.find(c => c.field === 'customer_code').after, code);
});
test('inactive, deleted and historical source records excluded', () => {
  for (const patch of [{ status: 'inactive' }, { status: 'deleted' }, { is_historical: true }, { customer_code: 'QA (deleted)' }]) {
    const row = decide([proposed(patch)]).rows[0];
    assert.equal(row.decision, 'SKIP'); assert.ok(codes(row).includes('EXCLUDED_SOURCE')); assert.deepEqual(row.changes, []);
  }
});
test('existing historical/inactive source match never reactivates or changes mode', () => {
  for (const patch of [{ status: 'inactive' }, { is_historical: true }]) {
    const row = decide([proposed({ city: 'New Synthetic City' })], [customer(patch)]).rows[0];
    assert.equal(row.decision, 'SKIP'); assert.deepEqual(row.changes, []); assert.ok(codes(row).includes('EXCLUDED_DESTINATION'));
  }
});
test('ambiguous existing source or business-code matches BLOCK', () => {
  const plan = decide([proposed()], [customer(), customer({ id: 'second-synthetic-id' })]);
  assert.equal(plan.rows[0].decision, 'BLOCK'); assert.ok(codes(plan.rows[0]).includes('AMBIGUOUS_MATCH'));
});
test('identical duplicates in batch plan one CREATE and one SKIP', () => {
  const plan = decide([proposed(), proposed()]);
  assert.deepEqual(plan.rows.map(r => r.decision), ['CREATE', 'SKIP']);
  assert.equal(plan.rows[1].duplicate_of_row, 1); assert.deepEqual(plan.rows[1].changes, []);
});
test('conflicting duplicate source rows BLOCK every occurrence, including first', () => {
  const plan = decide([proposed(), proposed({ phone: '555-0199' })]);
  assert.deepEqual(plan.rows.map(r => r.decision), ['BLOCK', 'BLOCK']);
});
test('two proposed source identities sharing a customer code both BLOCK', () => {
  assert.deepEqual(decide([proposed(), proposed({ source_record_id: 'QA-OTHER' })]).rows.map(r => r.decision), ['BLOCK', 'BLOCK']);
});
test('case/whitespace variants cause review rather than fuzzy matching or duplicate creation', () => {
  assert.equal(decide([proposed({ customer_code: '0000123 ' })], [customer()]).rows[0].decision, 'BLOCK');
  assert.equal(decide([proposed()], [customer({ source_record_id: '0000123 ' })]).rows[0].decision, 'BLOCK');
  assert.deepEqual(decide([proposed(), proposed({ source_record_id: '0000123 ' })]).rows.map(r => r.decision), ['BLOCK', 'BLOCK']);
});
test('no matching by name alone', () => {
  const row = decide([proposed()], [customer({ id: 'other-id', source_record_id: 'OTHER', customer_code: 'OTHER' })]).rows[0];
  assert.equal(row.decision, 'CREATE');
});
test('strict optional types; explicit false is a valid update, missing false is never invented', () => {
  for (const patch of [{ po_required: 'false' }, { phone: 555 }, { order_guide_retention_days: -1 }, { order_guide_retention_days: 1.5 }, { is_historical: 'false' }]) assert.equal(decide([proposed(patch)]).rows[0].decision, 'BLOCK');
  assert.deepEqual(decide([proposed({ po_required: false })], [customer({ po_required: true })]).rows[0].changes, [{ field: 'po_required', before: true, after: false }]);
  assert.equal(decide().rows[0].changes.some(c => c.field === 'po_required'), false);
});
test('unsupported fields and conflicting aliases do not disappear silently', () => {
  assert.ok(codes(decide([proposed({ balance: 100 })]).rows[0]).includes('UNSUPPORTED_FIELD'));
  assert.ok(codes(decide([proposed({ email: 'qa@example.invalid', general_email: 'other@example.invalid' })]).rows[0]).includes('ALIAS_CONFLICT'));
});
test('existing email and warehouse import aliases are reused', () => {
  const row = decide([proposed({ email: 'qa@example.invalid', default_warehouse_code: 'QA-WH' })]).rows[0];
  assert.equal(row.changes.find(c => c.field === 'general_email').after, 'qa@example.invalid');
  assert.equal(row.changes.find(c => c.field === 'default_warehouse_id').after, 'QA-WH');
});
test('incomplete, cross-organization and invalid snapshots fail closed', () => {
  for (const snap of [snapshot([], { complete: false }), snapshot([], { organizationId: 'OTHER' }), snapshot([customer({ organization_id: 'OTHER' })]), snapshot([customer(), customer()])]) {
    const row = planCustomerImport(request(), snap).rows[0]; assert.equal(row.decision, 'BLOCK'); assert.deepEqual(row.changes, []);
  }
});
test('missing compared snapshot field blocks an update instead of assuming null', () => {
  const existing = customer(); delete existing.phone;
  const row = decide([proposed({ phone: '555-0100' })], [existing]).rows[0];
  assert.equal(row.decision, 'BLOCK'); assert.ok(codes(row).includes('SNAPSHOT_FIELD_MISSING'));
});
test('dry-run uses only read capability, no network or database writes', async () => {
  let reads = 0; let writes = 0;
  const reader = new Proxy({ async readCustomers(id) { assert.equal(id, org); reads++; return snapshot([customer()]); } }, {
    get(target, key) { if (key !== 'readCustomers') { writes++; throw new Error('Unexpected capability'); } return target[key]; },
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => { writes++; throw new Error('Network forbidden in planner test'); };
  try {
    const plan = await previewCustomerImport(request([proposed({ phone: '555-0100' })]), reader);
    assert.equal(plan.rows[0].decision, 'UPDATE'); assert.equal(reads, 1); assert.equal(writes, 0);
  } finally { globalThis.fetch = originalFetch; }
});
test('plan hashes are stable across object-key and snapshot-order differences, but capture changes', () => {
  const second = customer({ id: 'other-id', customer_code: 'OTHER', source_record_id: 'OTHER' });
  const plan = decide([proposed()], [customer(), second]);
  const reordered = Object.fromEntries(Object.entries(proposed()).reverse());
  assert.deepEqual(plan, decide([reordered], [second, customer()]));
  assert.notEqual(plan.plan_id, decide([proposed({ phone: '555-0100' })], [customer(), second]).plan_id);
  assert.notEqual(plan.snapshot_hash, decide([proposed()], [customer({ updated_at: '2026-01-02T00:00:00Z' }), second]).snapshot_hash);
});
test('planner leaves source/snapshot untouched and returns a frozen auditable plan', () => {
  const req = request(); const snap = snapshot([customer()]); const before = JSON.stringify([req, snap]);
  const plan = planCustomerImport(req, snap);
  assert.equal(JSON.stringify([req, snap]), before); assert.equal(Object.isFrozen(plan.rows[0].findings), true);
  assert.throws(() => { plan.rows[0].decision = 'CREATE'; }, TypeError);
});
test('invalid input envelopes and oversized batches cannot produce a partial plan', () => {
  assert.throws(() => planCustomerImport(request([]), snapshot()));
  assert.throws(() => planCustomerImport(request(Array(501).fill(proposed())), snapshot()));
  assert.throws(() => planCustomerImport({ ...request(), sourceReference: '' }, snapshot()));
  assert.equal(decide([null]).rows[0].decision, 'BLOCK');
});

test('invalid existing field types block comparison rather than treating them as valid data', () => {
  const row = decide([proposed({ po_required: false })], [customer({ po_required: 'true' })]).rows[0];
  assert.equal(row.decision, 'BLOCK'); assert.ok(codes(row).includes('INVALID_EXISTING_VALUE'));
});

// Exercise the actual existing preview/commit entry points with the test-only read/write spy.
import { previewHistoricalImport, commitHistoricalImport } from '../src/lib/integrations/historical-import.ts';
import { resetContext, stats } from './customer-import-context.stub.mjs';
test('existing current-customer preview uses shared planner and reads every snapshot page without writes', async () => {
  const records = Array.from({ length: 501 }, (_, i) => customer({ id: `synthetic-id-${i}`, source_record_id: `SYNTHETIC-${i}`, customer_code: `SYNTHETIC-${i}` }));
  resetContext(records);
  const result = await previewHistoricalImport({ entity: 'customers', mode: 'current', sourceReference: 'SYNTHETIC-INTEGRATION', rows: [proposed()] });
  assert.equal(result.plan.rows[0].decision, 'CREATE'); assert.equal(result.plan.source_reference, 'SYNTHETIC-INTEGRATION');
  assert.equal(stats.reads, 2); assert.equal(stats.writes, 0);
});
test('snapshot read failure returns no plan and performs no writes', async () => {
  resetContext([], true);
  await assert.rejects(previewHistoricalImport({ entity: 'customers', mode: 'current', rows: [proposed()] }), /snapshot could not be read/);
  assert.equal(stats.writes, 0);
});
test('current-customer commit is blocked before even opening an authenticated context or batch', async () => {
  resetContext();
  await assert.rejects(commitHistoricalImport({ entity: 'customers', mode: 'current', rows: [proposed()] }), /planning-only/);
  assert.deepEqual(stats, { contexts: 0, reads: 0, writes: 0 });
});
