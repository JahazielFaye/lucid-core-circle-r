import 'server-only';

import { createClient } from '@/utils/supabase/server';

export type HistoricalImportEntity =
  | 'customers' | 'ship_tos' | 'items' | 'item_identifiers' | 'customer_items'
  | 'orders' | 'order_lines' | 'inventory_lots' | 'inventory_transactions'
  | 'production_cases' | 'pallets' | 'shipments';

export type HistoricalImportRow = Record<string, string | number | boolean | null>;

export class HistoricalImportAuthError extends Error {}

const entities = new Set<HistoricalImportEntity>([
  'customers', 'ship_tos', 'items', 'item_identifiers', 'customer_items', 'orders',
  'order_lines', 'inventory_lots', 'inventory_transactions', 'production_cases', 'pallets', 'shipments',
]);

function text(row: HistoricalImportRow, key: string) {
  const value = row[key];
  return value == null ? null : String(value).trim() || null;
}
function numberValue(row: HistoricalImportRow, key: string) {
  const value = text(row, key);
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function bool(row: HistoricalImportRow, key: string) {
  return ['true', 'yes', '1', 'y'].includes((text(row, key) || '').toLowerCase());
}
function required(row: HistoricalImportRow, key: string) {
  const value = text(row, key);
  if (!value) throw new Error(`${key.replaceAll('_', ' ')} is required.`);
  return value;
}

async function importContext() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new HistoricalImportAuthError('An authenticated Lucid Core session is required.');
  const { data: profile, error } = await supabase.from('profiles').select('id, organization_id, active, role').eq('id', user.id).maybeSingle();
  if (error || !profile?.active) throw new HistoricalImportAuthError('An active Lucid Core profile is required.');
  if (profile.role !== 'lucid_admin') throw new HistoricalImportAuthError('Only Lucid Admin can commit historical imports.');
  return { supabase, profile };
}

async function sourceId(supabase: Awaited<ReturnType<typeof createClient>>, table: string, organizationId: string, value: string) {
  const { data, error } = await supabase.from(table).select('id').eq('organization_id', organizationId).eq('source_system', 'food_connex').eq('source_record_id', value).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error(`Referenced Food Connex ${table.replaceAll('_', ' ')} source record ${value} has not been imported.`);
  return data.id as string;
}

async function existingSource(supabase: Awaited<ReturnType<typeof createClient>>, table: string, organizationId: string, sourceRecordId: string) {
  const { data, error } = await supabase.from(table).select('id').eq('organization_id', organizationId).eq('source_system', 'food_connex').eq('source_record_id', sourceRecordId).maybeSingle();
  if (error) throw new Error(error.message);
  return data?.id as string | undefined;
}

async function insertOne(supabase: Awaited<ReturnType<typeof createClient>>, entity: HistoricalImportEntity, row: HistoricalImportRow, organizationId: string, batchId: string, actorId: string) {
  const sourceRecordId = required(row, 'source_record_id');
  const sourceFields = { organization_id: organizationId, source_system: 'food_connex', source_record_id: sourceRecordId, import_batch_id: batchId, is_historical: true };
  const sourceTable: Record<HistoricalImportEntity, string> = {
    customers: 'customers', ship_tos: 'customer_ship_tos', items: 'items', item_identifiers: 'item_identifiers', customer_items: 'customer_items', orders: 'orders', order_lines: 'order_lines', inventory_lots: 'inventory_lots', inventory_transactions: 'inventory_transactions', production_cases: 'production_cases', pallets: 'pallets', shipments: 'shipments',
  };
  if (await existingSource(supabase, sourceTable[entity], organizationId, sourceRecordId)) return 'skipped' as const;
  let payload: Record<string, unknown>;
  switch (entity) {
    case 'customers':
      payload = { ...sourceFields, customer_code: text(row, 'customer_code'), name: required(row, 'name'), status: text(row, 'status') || 'active' }; break;
    case 'ship_tos':
      payload = { ...sourceFields, customer_id: await sourceId(supabase, 'customers', organizationId, required(row, 'customer_source_record_id')), location_code: text(row, 'location_code'), name: required(row, 'name'), status: text(row, 'status') || 'active', address_summary: text(row, 'address_summary') }; break;
    case 'items':
      payload = { ...sourceFields, item_code: required(row, 'item_code'), description: required(row, 'description'), status: text(row, 'status') || 'active', stock_uom: text(row, 'stock_uom'), sell_uom: text(row, 'sell_uom'), catch_weight: bool(row, 'catch_weight') }; break;
    case 'item_identifiers':
      payload = { ...sourceFields, item_id: await sourceId(supabase, 'items', organizationId, required(row, 'item_source_record_id')), identifier_type: required(row, 'identifier_type'), identifier_value: required(row, 'identifier_value'), uom: text(row, 'uom'), is_primary: bool(row, 'is_primary'), verified: bool(row, 'verified'), status: text(row, 'status') || 'active' }; break;
    case 'customer_items':
      payload = { ...sourceFields, customer_id: await sourceId(supabase, 'customers', organizationId, required(row, 'customer_source_record_id')), ship_to_id: text(row, 'ship_to_source_record_id') ? await sourceId(supabase, 'customer_ship_tos', organizationId, required(row, 'ship_to_source_record_id')) : null, item_id: await sourceId(supabase, 'items', organizationId, required(row, 'item_source_record_id')), customer_sku: text(row, 'customer_sku'), customer_description: text(row, 'customer_description'), customer_uom: text(row, 'customer_uom'), status: text(row, 'status') || 'active' }; break;
    case 'orders': {
      const customerSource = text(row, 'customer_source_record_id'); const shipToSource = text(row, 'ship_to_source_record_id');
      payload = { ...sourceFields, external_po: required(row, 'external_po'), customer: required(row, 'customer'), ship_to: text(row, 'ship_to'), status: text(row, 'status') || 'new', customer_id: customerSource ? await sourceId(supabase, 'customers', organizationId, customerSource) : null, ship_to_id: shipToSource ? await sourceId(supabase, 'customer_ship_tos', organizationId, shipToSource) : null, requested_ship_date: text(row, 'requested_ship_date'), requested_delivery_date: text(row, 'requested_delivery_date'), source: 'food_connex' }; break;
    }
    case 'order_lines':
      payload = { ...sourceFields, order_id: await sourceId(supabase, 'orders', organizationId, required(row, 'order_source_record_id')), external_sku: text(row, 'external_sku'), vendor_item: text(row, 'vendor_item'), internal_item_id: text(row, 'internal_item_id'), description: required(row, 'description'), quantity_cases: numberValue(row, 'quantity_cases') ?? 0, unit_price: numberValue(row, 'unit_price'), uom: text(row, 'uom'), lot_code: text(row, 'lot_code') }; break;
    case 'inventory_lots':
      payload = { ...sourceFields, item_id: required(row, 'item_code'), lot_code: required(row, 'lot_code'), internal_lot_number: text(row, 'internal_lot_number'), received_date: text(row, 'received_date'), production_date: text(row, 'production_date'), status: text(row, 'status') || 'active' }; break;
    case 'inventory_transactions':
      payload = { ...sourceFields, transaction_number: required(row, 'transaction_number'), transaction_type: required(row, 'transaction_type'), status: 'posted', transaction_date: text(row, 'transaction_date') || new Date().toISOString(), posted_at: text(row, 'posted_at') || new Date().toISOString(), posted_by: actorId, warehouse_id: text(row, 'warehouse_id') }; break;
    case 'pallets':
      payload = { ...sourceFields, order_id: await sourceId(supabase, 'orders', organizationId, required(row, 'order_source_record_id')), label: required(row, 'pallet_identifier'), pallet_identifier: required(row, 'pallet_identifier'), status: text(row, 'status') || 'complete' }; break;
    case 'shipments':
      payload = { ...sourceFields, order_id: await sourceId(supabase, 'orders', organizationId, required(row, 'order_source_record_id')), bol_reference: text(row, 'bol_reference'), carrier_name: text(row, 'carrier_name'), carrier_reference: text(row, 'carrier_reference'), invoice_number: text(row, 'invoice_number'), external_accounting_id: text(row, 'external_accounting_id'), invoice_status: text(row, 'invoice_status'), status: text(row, 'status') || 'completed', shipped_at: text(row, 'shipped_at') || null }; break;
    case 'production_cases':
      throw new Error('Production case import requires a validated production-lot and order-line source mapping. Map and import those source records first; Lucid will not fabricate genealogy.');
    default: throw new Error('Unsupported import entity.');
  }
  const { error } = await supabase.from(sourceTable[entity]).insert(payload);
  if (error) throw new Error(error.message);
  return 'created' as const;
}

export async function commitHistoricalImport(input: { entity: HistoricalImportEntity; sourceReference?: string; rows: HistoricalImportRow[] }) {
  if (!entities.has(input.entity)) throw new Error('Choose a supported historical entity.');
  if (!Array.isArray(input.rows) || !input.rows.length) throw new Error('No import rows were supplied.');
  if (input.rows.length > 500) throw new Error('Import at most 500 rows per confirmed batch.');
  const { supabase, profile } = await importContext();
  const { data: batch, error: batchError } = await supabase.from('integration_import_batches').insert({ organization_id: profile.organization_id, source_system: 'food_connex', source_reference: input.sourceReference || null, status: 'started', created_by: profile.id, details: { entity: input.entity, received_rows: input.rows.length } }).select('id').single();
  if (batchError || !batch) throw new Error(batchError?.message || 'Could not create the import batch.');
  const errors: Array<{ row: number; message: string }> = []; let created = 0; let skipped = 0;
  for (const [index, row] of input.rows.entries()) {
    try { const result = await insertOne(supabase, input.entity, row, profile.organization_id, batch.id, profile.id); if (result === 'created') created += 1; else skipped += 1; }
    catch (error) { errors.push({ row: index + 2, message: error instanceof Error ? error.message : 'This row could not be imported.' }); }
  }
  const status = errors.length ? 'failed' : 'completed';
  await supabase.from('integration_import_batches').update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null, details: { entity: input.entity, received_rows: input.rows.length, created, skipped, errors } }).eq('id', batch.id).eq('organization_id', profile.organization_id);
  return { batchId: batch.id, created, skipped, errors, status };
}

/** A read-only preflight. It deliberately checks only deterministic source/native keys;
 * unmatched relationship data remains a row-level error at commit rather than guessed. */
export async function previewHistoricalImport(input: { entity: HistoricalImportEntity; rows: HistoricalImportRow[] }) {
  if (!entities.has(input.entity)) throw new Error('Choose a supported historical entity.');
  if (!Array.isArray(input.rows) || !input.rows.length) throw new Error('No import rows were supplied.');
  const { supabase, profile } = await importContext();
  const table: Record<HistoricalImportEntity, string> = { customers:'customers', ship_tos:'customer_ship_tos', items:'items', item_identifiers:'item_identifiers', customer_items:'customer_items', orders:'orders', order_lines:'order_lines', inventory_lots:'inventory_lots', inventory_transactions:'inventory_transactions', production_cases:'production_cases', pallets:'pallets', shipments:'shipments' };
  const errors: Array<{ row:number; message:string }> = []; let duplicates = 0; let willCreate = 0; const seen = new Set<string>();
  for (const [index, row] of input.rows.entries()) {
    const sourceRecordId = text(row, 'source_record_id');
    if (!sourceRecordId) { errors.push({ row:index + 2, message:'Food Connex source record ID is required.' }); continue; }
    if (seen.has(sourceRecordId)) { duplicates += 1; continue; }
    seen.add(sourceRecordId);
    if (await existingSource(supabase, table[input.entity], profile.organization_id, sourceRecordId)) { duplicates += 1; continue; }
    const nativeKey = input.entity === 'customers' ? text(row, 'customer_code') : input.entity === 'items' ? text(row, 'item_code') : input.entity === 'orders' ? text(row, 'external_po') : null;
    if (nativeKey) {
      const nativeField = input.entity === 'customers' ? 'customer_code' : input.entity === 'items' ? 'item_code' : 'external_po';
      const { data, error } = await supabase.from(table[input.entity]).select('id, source_system').eq('organization_id', profile.organization_id).eq(nativeField, nativeKey).limit(1);
      if (error) throw new Error(error.message);
      if (data?.some((record: { source_system?: string }) => record.source_system !== 'food_connex')) { errors.push({ row:index + 2, message:'A Lucid-native record uses this business key. It will not be overwritten.' }); continue; }
    }
    willCreate += 1;
  }
  return { detected: input.rows.length, willCreate, duplicates, errors };
}
