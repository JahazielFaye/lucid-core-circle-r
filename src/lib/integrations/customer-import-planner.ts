import 'server-only';

import { createHash } from 'node:crypto';
import { z } from 'zod';

// These are confirmed Customer Master columns, not accounting balances or EDI settings.
const textFields = [
  'legal_name', 'address_line_1', 'address_line_2', 'city', 'state', 'postal_code',
  'country', 'phone', 'general_email', 'default_warehouse_id', 'customer_type',
  'customer_group', 'payment_terms_reference', 'invoice_preferences',
  'delivery_preferences', 'operational_notes',
] as const;
const booleanFields = ['po_required', 'order_guide_enabled'] as const;
const integerFields = ['order_guide_retention_days'] as const;
const aliases: Record<string, string> = { email: 'general_email', default_warehouse_code: 'default_warehouse_id' };
const metadata = ['source_record_id', 'customer_code', 'name', 'status', 'source_system', 'is_historical'];
const allowed = new Set<string>([...metadata, ...textFields, ...booleanFields, ...integerFields, ...Object.keys(aliases)]);
const placeholder = /\bredacted\b|\*{2,}|•{2,}|^x{3,}[- .()/x\d]*$|^(blank in source|not captured|unverified)(:.*)?$/i;
const identifier = z.string().refine(value => value.trim().length > 0, 'Nonblank text required');
const snapshotRecord = z.object({
  id: identifier, organization_id: identifier, customer_code: z.string().nullable(),
  name: z.string(), source_system: identifier, source_record_id: z.string().nullable(),
  status: z.enum(['active', 'inactive']), is_historical: z.boolean(),
}).passthrough();

export type ImportDecision = 'CREATE' | 'UPDATE' | 'SKIP' | 'BLOCK';
export type ImportFinding = { severity: 'error' | 'warning' | 'info'; code: string; field?: string; message: string };
export type FieldChange = { field: string; before: string | number | boolean | null; after: string | number | boolean };
export type ExistingCustomer = z.infer<typeof snapshotRecord>;
export type CustomerSnapshot = { organizationId: string; complete: boolean; records: readonly ExistingCustomer[] };
export type CustomerPlanRequest = { organizationId: string; sourceReference: string; rows: readonly unknown[] };
export type CustomerPlanRow = {
  row: number; source_record_id: string | null; customer_code: string | null;
  decision: ImportDecision; matched_id: string | null; duplicate_of_row: number | null;
  findings: ImportFinding[]; changes: FieldChange[];
};
export type CustomerImportPlan = {
  version: 'customer-master-plan-v1'; entity: 'customers'; mode: 'current'; dry_run: true;
  executable: false; organization_id: string; source_system: 'food_connex'; source_reference: string;
  input_hash: string; snapshot_hash: string; plan_id: string;
  findings: ImportFinding[]; rows: CustomerPlanRow[];
  counts: { total: number; CREATE: number; UPDATE: number; SKIP: number; BLOCK: number };
};

/** Reusable canonical JSON/hash primitive. No clock, randomness, logging or persistence. */
export function canonicalImportJson(value: unknown): string {
  return JSON.stringify(value, (_key, current: unknown) => {
    if (current && typeof current === 'object' && !Array.isArray(current)) {
      if (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
        throw new Error('Import plans accept plain structured JSON records only.');
      }
      return Object.fromEntries(Object.entries(current).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
    }
    if (typeof current === 'bigint' || typeof current === 'function' || typeof current === 'symbol' || typeof current === 'number' && !Number.isFinite(current)) {
      throw new Error('Import plans accept finite structured JSON values only.');
    }
    return current;
  });
}
const hash = (value: unknown) => createHash('sha256').update(canonicalImportJson(value)).digest('hex');
const similarKey = (value: string) => value.trim().toLowerCase(); // Collision detection only; never used to rewrite an ID.
const fieldType = (field: string) => (booleanFields as readonly string[]).includes(field) ? z.boolean()
  : (integerFields as readonly string[]).includes(field) ? z.number().int().nonnegative() : z.string();
const isMissing = (value: unknown) => value == null || typeof value === 'string' && !value.trim();
const isPlaceholder = (value: unknown) => typeof value === 'string' && placeholder.test(value.trim());
const error = (code: string, message: string, field?: string): ImportFinding => ({ severity: 'error', code, message, ...(field ? { field } : {}) });
const info = (code: string, message: string): ImportFinding => ({ severity: 'info', code, message });
const hasError = (findings: ImportFinding[]) => findings.some(finding => finding.severity === 'error');
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

/** Pure server-side planning. The caller supplies a complete authorized snapshot; no DB/client is accepted. */
export function planCustomerImport(request: CustomerPlanRequest, snapshot: CustomerSnapshot): CustomerImportPlan {
  identifier.parse(request.organizationId);
  identifier.parse(request.sourceReference);
  if (!Array.isArray(request.rows) || !request.rows.length || request.rows.length > 500) throw new Error('Plan between 1 and 500 proposed customer rows.');
  // Reject non-JSON inputs before hashing, rather than generating misleading audit fingerprints.
  const inputHash = hash(request);
  const findings: ImportFinding[] = [];
  if (snapshot.organizationId !== request.organizationId || snapshot.complete !== true || !Array.isArray(snapshot.records)) {
    findings.push(error('INCOMPLETE_OR_WRONG_SCOPE', 'A complete snapshot for the authenticated organization is required.'));
  }
  const existing: ExistingCustomer[] = [];
  const ids = new Set<string>();
  for (const record of snapshot.records || []) {
    const parsed = snapshotRecord.safeParse(record);
    if (!parsed.success || parsed.data.organization_id !== request.organizationId || ids.has(parsed.data.id)) {
      findings.push(error('INVALID_SNAPSHOT', 'Snapshot records must have valid metadata, unique IDs and the same organization.'));
    } else { ids.add(parsed.data.id); existing.push(parsed.data); }
  }
  const snapshotHash = hash({ ...snapshot, records: [...(snapshot.records || [])].sort((a, b) => canonicalImportJson(a) < canonicalImportJson(b) ? -1 : canonicalImportJson(a) > canonicalImportJson(b) ? 1 : 0) });
  const candidates = request.rows.map((raw, index) => {
    const row: CustomerPlanRow = { row: index + 1, source_record_id: null, customer_code: null, decision: 'BLOCK', matched_id: null, duplicate_of_row: null, findings: [], changes: [] };
    const values: Record<string, string | number | boolean> = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      row.findings.push(error('INVALID_ROW', 'Each proposed customer must be a structured object.'));
      return { raw, row, values, excluded: false };
    }
    const record = raw as Record<string, unknown>;
    for (const key of ['source_record_id', 'customer_code'] as const) {
      if (!identifier.safeParse(record[key]).success || isPlaceholder(record[key])) row.findings.push(error('REQUIRED_TEXT_IDENTIFIER', 'Supply the original nonblank identifier as text; numeric/coerced identifiers are not accepted.', key));
      else row[key] = record[key] as string;
    }
    for (const key of Object.keys(record).sort()) if (!allowed.has(key)) row.findings.push(error('UNSUPPORTED_FIELD', 'This field is not supported by the Customer Master planner; it will not be silently discarded.', key));
    if (record.source_system !== undefined && record.source_system !== 'food_connex') row.findings.push(error('WRONG_SOURCE_SYSTEM', 'Only Food Connex source records are supported.', 'source_system'));
    if (record.is_historical !== undefined && typeof record.is_historical !== 'boolean') row.findings.push(error('INVALID_TYPE', 'Historical status must be an explicit boolean.', 'is_historical'));
    const excluded = record.is_historical === true || record.status === 'inactive' || record.status === 'deleted' || /\(deleted\)\s*$/i.test(row.customer_code || '');
    if (!excluded) {
      if (record.status !== 'active') row.findings.push(error('ACTIVE_STATUS_REQUIRED', 'Explicit active source status is required; unknown status is never defaulted active.', 'status'));
      if (!identifier.safeParse(record.name).success || isPlaceholder(record.name)) row.findings.push(error('REQUIRED_NAME', 'A nonblank, unredacted customer name is required.', 'name'));
      else values.name = record.name as string;
    }
    for (const key of Object.keys(record).sort()) {
      if (metadata.includes(key) || !allowed.has(key)) continue;
      const value = record[key]; const field = aliases[key] || key;
      if (isMissing(value) || isPlaceholder(value)) {
        row.findings.push({ severity: 'warning', code: 'VALUE_PROTECTED', field, message: 'Missing, blank, null or redacted value ignored; existing data will be retained.' });
        continue;
      }
      if (!fieldType(field).safeParse(value).success) row.findings.push(error('INVALID_TYPE', 'Field must have its declared text, boolean or nonnegative integer type; no coercion is performed.', field));
      else if (Object.hasOwn(values, field) && values[field] !== value) row.findings.push(error('ALIAS_CONFLICT', 'Two source fields propose different values for the same destination field.', field));
      else values[field] = value as string | number | boolean;
    }
    return { raw, row, values, excluded };
  });
  // Group all proposed identities before deciding any CREATE, so a later conflicting row cannot win.
  for (const candidate of candidates) {
    const { row } = candidate;
    if (row.source_record_id) {
      const peers = candidates.filter(c => c.row.source_record_id === row.source_record_id);
      if (new Set(peers.map(c => canonicalImportJson(c.raw))).size > 1) row.findings.push(error('CONFLICTING_SOURCE_DUPLICATE', 'The batch contains conflicting rows for one source record.'));
      else if (peers[0] !== candidate) row.duplicate_of_row = peers[0].row.row;
      const variants = candidates.filter(c => c.row.source_record_id && similarKey(c.row.source_record_id) === similarKey(row.source_record_id!) && c.row.source_record_id !== row.source_record_id);
      if (variants.length) row.findings.push(error('SIMILAR_SOURCE_ID', 'Source IDs differ only by case or surrounding whitespace; manual reconciliation is required.'));
    }
    if (row.customer_code && candidates.some(c => c.row.customer_code && similarKey(c.row.customer_code) === similarKey(row.customer_code!) && (c.row.source_record_id !== row.source_record_id || c.row.customer_code !== row.customer_code))) {
      row.findings.push(error('CONFLICTING_BATCH_CODE', 'Multiple proposed source identities use the same or visually similar customer code.'));
    }
  }
  for (const { row, values, excluded } of candidates) {
    if (hasError(row.findings)) continue;
    if (excluded) { row.decision = 'SKIP'; row.findings.push(info('EXCLUDED_SOURCE', 'Inactive, deleted or historical source record excluded from current master planning.')); continue; }
    if (hasError(findings)) { row.findings.push(error('SNAPSHOT_BLOCKED', 'The snapshot is not safe for planning.')); continue; }
    const sourceMatches = existing.filter(record => record.source_system === 'food_connex' && record.source_record_id === row.source_record_id);
    const codeMatches = existing.filter(record => record.customer_code === row.customer_code);
    const variants = existing.some(record => record.customer_code && similarKey(record.customer_code) === similarKey(row.customer_code!) && record.customer_code !== row.customer_code
      || record.source_system === 'food_connex' && record.source_record_id && similarKey(record.source_record_id) === similarKey(row.source_record_id!) && record.source_record_id !== row.source_record_id);
    if (sourceMatches.length > 1 || codeMatches.length > 1) { row.findings.push(error('AMBIGUOUS_MATCH', 'Multiple existing records match the source ID or customer code.')); continue; }
    if (variants) { row.findings.push(error('SIMILAR_EXISTING_KEY', 'Existing case/whitespace variant requires manual reconciliation; no normalized match is adopted.')); continue; }
    const match = sourceMatches[0];
    if (codeMatches.some(record => record.id !== match?.id)) { row.findings.push(error('CUSTOMER_CODE_CONFLICT', 'The customer code belongs to a different source or Lucid-native record.')); continue; }
    if (match && match.customer_code !== row.customer_code) { row.findings.push(error('IDENTITY_CHANGE', 'Changing a matched source record customer code requires separate review.')); continue; }
    row.matched_id = match?.id || null;
    if (match && (match.is_historical || match.status !== 'active')) { row.decision = 'SKIP'; row.findings.push(info('EXCLUDED_DESTINATION', 'Matched historical/inactive destination will not be converted or reactivated.')); continue; }
    const proposed = match ? values : { ...values, organization_id: request.organizationId, source_system: 'food_connex', source_record_id: row.source_record_id!, customer_code: row.customer_code!, status: 'active', is_historical: false };
    for (const field of Object.keys(proposed).sort()) {
      if (match && !Object.hasOwn(match, field)) { row.findings.push(error('SNAPSHOT_FIELD_MISSING', 'Snapshot omitted a proposed field; its existing value cannot be safely compared.', field)); continue; }
      const before = match ? match[field] : null;
      if (before !== null && before !== undefined && !fieldType(field).safeParse(before).success) { row.findings.push(error('INVALID_EXISTING_VALUE', 'Snapshot contains an invalid field value.', field)); continue; }
      if (before !== proposed[field]) row.changes.push({ field, before: (before ?? null) as FieldChange['before'], after: proposed[field] });
    }
    if (hasError(row.findings)) { row.changes = []; continue; }
    row.decision = match ? row.changes.length ? 'UPDATE' : 'SKIP' : 'CREATE';
    if (row.decision === 'SKIP') row.findings.push(info('UNCHANGED', 'Provided valid fields already match; omitted fields remain untouched.'));
    if (row.duplicate_of_row !== null) { row.decision = 'SKIP'; row.changes = []; row.findings.push(info('IDENTICAL_BATCH_DUPLICATE', 'Identical repeated source row skipped; only the first occurrence is planned.')); }
  }
  const rows = candidates.map(c => c.row);
  const counts = { total: rows.length, CREATE: 0, UPDATE: 0, SKIP: 0, BLOCK: 0 };
  rows.forEach(row => counts[row.decision]++);
  const body = { version: 'customer-master-plan-v1' as const, entity: 'customers' as const, mode: 'current' as const, dry_run: true as const, executable: false as const, organization_id: request.organizationId, source_system: 'food_connex' as const, source_reference: request.sourceReference, input_hash: inputHash, snapshot_hash: snapshotHash, findings, rows, counts };
  return freeze({ ...body, plan_id: hash(body) });
}

/** Read capability only: auth/organization selection belongs to the server caller. */
export interface CustomerSnapshotReader { readCustomers(organizationId: string): Promise<CustomerSnapshot> }
export async function previewCustomerImport(request: CustomerPlanRequest, reader: CustomerSnapshotReader): Promise<CustomerImportPlan> {
  return planCustomerImport(request, await reader.readCustomers(request.organizationId));
}
