import 'server-only';
import { createCustomerManifest, customerManifestSummary } from './customer-review-manifest';

import { createClient } from '@/utils/supabase/server';
import { previewCustomerImport, type CustomerSnapshot } from '@/lib/integrations/customer-import-planner';

export type HistoricalImportEntity =
  | 'customers' | 'ship_tos' | 'contacts' | 'items' | 'item_identifiers' | 'customer_items'
  | 'vendors' | 'vendor_items' | 'warehouses'
  | 'orders' | 'order_lines' | 'inventory_lots' | 'inventory_transactions'
  | 'production_cases' | 'pallets' | 'shipments';

export type FoodConnexImportMode = 'historical' | 'current';

export type HistoricalImportRow = Record<string, string | number | boolean | null>;

export class HistoricalImportAuthError extends Error {}

const entities = new Set<HistoricalImportEntity>([
  'customers', 'ship_tos', 'contacts', 'items', 'item_identifiers', 'customer_items', 'orders',
  'order_lines', 'inventory_lots', 'inventory_transactions', 'production_cases', 'pallets', 'shipments',
  'vendors', 'vendor_items', 'warehouses',
]);

const currentMasterEntities = new Set<HistoricalImportEntity>([
  'customers', 'ship_tos', 'contacts', 'items', 'item_identifiers', 'customer_items', 'vendors', 'vendor_items', 'warehouses',
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
  if (profile.role !== 'lucid_admin') throw new HistoricalImportAuthError('Only Lucid Admin can commit Food Connex imports.');
  return { supabase, profile };
}

async function sourceId(supabase: Awaited<ReturnType<typeof createClient>>, table: string, organizationId: string, value: string) {
  const { data, error } = await supabase.from(table).select('id').eq('organization_id', organizationId).eq('source_system', 'food_connex').eq('source_record_id', value).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.id) throw new Error(`Referenced Food Connex ${table.replaceAll('_', ' ')} source record ${value} has not been imported.`);
  return data.id as string;
}

async function existingSource(supabase: Awaited<ReturnType<typeof createClient>>, table: string, organizationId: string, sourceRecordId: string) {
  const { data, error } = await supabase.from(table).select('id, is_historical').eq('organization_id', organizationId).eq('source_system', 'food_connex').eq('source_record_id', sourceRecordId).maybeSingle();
  if (error) throw new Error(error.message);
  return data as { id: string; is_historical: boolean } | null;
}

const sourceTables: Record<HistoricalImportEntity, string> = {
  customers: 'customers', ship_tos: 'customer_ship_tos', contacts: 'customer_contacts', items: 'items', item_identifiers: 'item_identifiers', customer_items: 'customer_items',
  vendors: 'vendors', vendor_items: 'vendor_items', warehouses: 'warehouses', orders: 'orders', order_lines: 'order_lines',
  inventory_lots: 'inventory_lots', inventory_transactions: 'inventory_transactions', production_cases: 'production_cases', pallets: 'pallets', shipments: 'shipments',
};

async function insertOne(supabase: Awaited<ReturnType<typeof createClient>>, entity: HistoricalImportEntity, row: HistoricalImportRow, organizationId: string, batchId: string, actorId: string, mode: FoodConnexImportMode) {
  const sourceRecordId = required(row, 'source_record_id');
  const sourceFields = { organization_id: organizationId, source_system: 'food_connex', source_record_id: sourceRecordId, import_batch_id: batchId, is_historical: mode === 'historical' };
  const sourceTable = sourceTables[entity];
  const existing = await existingSource(supabase, sourceTable, organizationId, sourceRecordId);
  if (existing && existing.is_historical !== (mode === 'historical')) {
    throw new Error('This Food Connex source record is already stored in the other import mode. Review it instead of converting archive data into current master data.');
  }
  const existingId = existing?.id;
  if (existingId && mode === 'historical') return 'skipped' as const;
  let payload: Record<string, unknown>;
  switch (entity) {
    case 'customers':
      payload = { ...sourceFields, customer_code: text(row, 'customer_code'), name: required(row, 'name'), status: text(row, 'status') || 'active', legal_name: text(row, 'legal_name'), address_line_1: text(row, 'address_line_1'), address_line_2: text(row, 'address_line_2'), city: text(row, 'city'), state: text(row, 'state'), postal_code: text(row, 'postal_code'), country: text(row, 'country'), phone: text(row, 'phone'), general_email: text(row, 'email'), default_warehouse_id: text(row, 'default_warehouse_code'), customer_type: text(row, 'customer_type'), customer_group: text(row, 'customer_group'), chain_name: text(row, 'chain_name'), salesperson_name: text(row, 'salesperson_name'), broker_name: text(row, 'broker_name'), po_required: bool(row, 'po_required'), payment_terms_reference: text(row, 'payment_terms_reference'), delivery_preferences: text(row, 'delivery_preferences'), invoice_preferences: text(row, 'invoice_preferences'), operational_notes: text(row, 'operational_notes') }; break;
    case 'ship_tos':
      payload = { ...sourceFields, customer_id: await sourceId(supabase, 'customers', organizationId, required(row, 'customer_source_record_id')), location_code: text(row, 'location_code'), name: required(row, 'name'), status: text(row, 'status') || 'active', address_summary: text(row, 'address_summary'), address_line_1: text(row, 'address_line_1'), address_line_2: text(row, 'address_line_2'), city: text(row, 'city'), state: text(row, 'state'), postal_code: text(row, 'postal_code'), country: text(row, 'country'), contact_name: text(row, 'contact_name'), phone: text(row, 'phone'), email: text(row, 'email'), delivery_instructions: text(row, 'delivery_instructions'), delivery_preferences: text(row, 'delivery_preferences'), ship_via_preference: text(row, 'ship_via_preference') }; break;
    case 'contacts':
      payload = { ...sourceFields, customer_id: await sourceId(supabase, 'customers', organizationId, required(row, 'customer_source_record_id')), contact_type: text(row, 'contact_type') || 'other', name: required(row, 'name'), email: text(row, 'email'), phone: text(row, 'phone'), is_primary: bool(row, 'is_primary'), status: text(row, 'status') || 'active', notes: text(row, 'notes') }; break;
    case 'items':
      payload = { ...sourceFields, item_code: required(row, 'item_code'), description: required(row, 'description'), status: text(row, 'status') || 'active', vendor_id: text(row, 'vendor_source_record_id') ? await sourceId(supabase, 'vendors', organizationId, required(row, 'vendor_source_record_id')) : null, vendor_name: text(row, 'vendor_name'), vendor_item_code: text(row, 'vendor_item_code'), brand: text(row, 'brand'), category: text(row, 'category'), stock_uom: text(row, 'stock_uom'), sell_uom: text(row, 'sell_uom'), bill_uom: text(row, 'bill_uom'), standard_weight: numberValue(row, 'standard_weight'), standard_weight_uom: text(row, 'weight_uom'), catch_weight: bool(row, 'catch_weight'), weight_only: bool(row, 'weight_only'), case_conversion: numberValue(row, 'case_conversion'), tare_weight: numberValue(row, 'tare_weight'), tare_weight_uom: text(row, 'tare_weight_uom'), pack_size: text(row, 'pack_size'), container: text(row, 'container'), shelf_life_days: numberValue(row, 'shelf_life_days'), availability_status: text(row, 'availability_status'), reorder_point: numberValue(row, 'reorder_point'), reorder_quantity: numberValue(row, 'reorder_quantity'), label_notes: text(row, 'label_notes') }; break;
    case 'item_identifiers':
      payload = { ...sourceFields, item_id: await sourceId(supabase, 'items', organizationId, required(row, 'item_source_record_id')), identifier_type: required(row, 'identifier_type'), identifier_value: required(row, 'identifier_value'), uom: text(row, 'uom'), is_primary: bool(row, 'is_primary'), verified: bool(row, 'verified'), status: text(row, 'status') || 'active' }; break;
    case 'customer_items':
      payload = { ...sourceFields, customer_id: await sourceId(supabase, 'customers', organizationId, required(row, 'customer_source_record_id')), ship_to_id: text(row, 'ship_to_source_record_id') ? await sourceId(supabase, 'customer_ship_tos', organizationId, required(row, 'ship_to_source_record_id')) : null, item_id: await sourceId(supabase, 'items', organizationId, required(row, 'item_source_record_id')), customer_sku: text(row, 'customer_sku'), customer_description: text(row, 'customer_description'), customer_uom: text(row, 'customer_uom'), status: text(row, 'status') || 'active' }; break;
    case 'vendors':
      payload = { ...sourceFields, vendor_code: required(row, 'vendor_code'), name: required(row, 'name'), status: text(row, 'status') || 'active', address_line_1: text(row, 'address_line_1'), address_line_2: text(row, 'address_line_2'), city: text(row, 'city'), state: text(row, 'state'), postal_code: text(row, 'postal_code'), country: text(row, 'country'), phone: text(row, 'phone'), email: text(row, 'email'), contact_name: text(row, 'contact_name'), payment_terms_reference: text(row, 'payment_terms_reference'), purchasing_comments: text(row, 'purchasing_comments'), pickup_instructions: text(row, 'pickup_instructions'), default_shipping_information: text(row, 'default_shipping_information') }; break;
    case 'vendor_items':
      payload = { ...sourceFields, vendor_id: await sourceId(supabase, 'vendors', organizationId, required(row, 'vendor_source_record_id')), item_id: await sourceId(supabase, 'items', organizationId, required(row, 'item_source_record_id')), vendor_item_code: required(row, 'vendor_item_code'), vendor_description: text(row, 'vendor_description'), vendor_uom: text(row, 'vendor_uom'), status: text(row, 'status') || 'active' }; break;
    case 'warehouses':
      payload = { ...sourceFields, warehouse_code: required(row, 'warehouse_code'), name: required(row, 'name'), status: text(row, 'status') || 'active', address_line_1: text(row, 'address_line_1'), address_line_2: text(row, 'address_line_2'), city: text(row, 'city'), state: text(row, 'state'), postal_code: text(row, 'postal_code'), country: text(row, 'country') }; break;
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
  const { error } = existingId
    ? await supabase.from(sourceTable).update(payload).eq('id', existingId).eq('organization_id', organizationId).eq('source_system', 'food_connex')
    : await supabase.from(sourceTable).insert(payload);
  if (error) throw new Error(error.message);
  return existingId ? 'reconciled' as const : 'created' as const;
}

export async function commitHistoricalImport(input: { entity: HistoricalImportEntity; sourceReference?: string; rows: HistoricalImportRow[]; mode?: FoodConnexImportMode }) {
  if (!entities.has(input.entity)) throw new Error('Choose a supported historical entity.');
  const mode = input.mode || 'historical';
  if (mode === 'current' && !currentMasterEntities.has(input.entity)) throw new Error('Current Master Data imports support master records only.');
  if (!Array.isArray(input.rows) || !input.rows.length) throw new Error('No import rows were supplied.');
  if (input.rows.length > 500) throw new Error('Import at most 500 rows per confirmed batch.');
  // Planning is the only authorized current-customer operation; never enter the legacy row writer.
  if (['customers','ship_tos','contacts','customer_items'].includes(input.entity)) throw new Error('Customer Master and related imports are planning-only in every mode. No records were written.');
  const { supabase, profile } = await importContext();
  const { data: batch, error: batchError } = await supabase.from('integration_import_batches').insert({ organization_id: profile.organization_id, source_system: 'food_connex', source_reference: input.sourceReference || null, status: 'started', created_by: profile.id, details: { entity: input.entity, mode, received_rows: input.rows.length } }).select('id').single();
  if (batchError || !batch) throw new Error(batchError?.message || 'Could not create the import batch.');
  const errors: Array<{ row: number; message: string }> = []; let created = 0; let skipped = 0; let reconciled = 0;
  for (const [index, row] of input.rows.entries()) {
    try { const result = await insertOne(supabase, input.entity, row, profile.organization_id, batch.id, profile.id, mode); if (result === 'created') created += 1; else if (result === 'reconciled') reconciled += 1; else skipped += 1; }
    catch (error) { errors.push({ row: index + 2, message: error instanceof Error ? error.message : 'This row could not be imported.' }); }
  }
  const status = errors.length ? 'failed' : 'completed';
  await supabase.from('integration_import_batches').update({ status, completed_at: status === 'completed' ? new Date().toISOString() : null, details: { entity: input.entity, mode, received_rows: input.rows.length, created, reconciled, skipped, errors } }).eq('id', batch.id).eq('organization_id', profile.organization_id);
  return { batchId: batch.id, created, reconciled, skipped, errors, status };
}

/** Current customers use the shared field-level planner and cannot commit.
 * Other existing entities retain the legacy key-only preflight below. */
export async function previewHistoricalImport(input: { entity: HistoricalImportEntity; rows: HistoricalImportRow[]; mode?: FoodConnexImportMode; sourceReference?: string; relatedRecords?: unknown; previousManifest?: unknown; datasetVersion?: string }) {
  if (!entities.has(input.entity)) throw new Error('Choose a supported historical entity.');
  const mode = input.mode || 'historical';
  if (mode === 'current' && !currentMasterEntities.has(input.entity)) throw new Error('Current Master Data imports support master records only.');
  if (!Array.isArray(input.rows) || !input.rows.length) throw new Error('No import rows were supplied.');
  const { supabase, profile } = await importContext();
  if (mode === 'current' && input.entity === 'customers') {
    const plan = await previewCustomerImport({ organizationId: profile.organization_id, sourceReference: input.sourceReference || 'Customer Master preview', rows: input.rows }, {
      async readCustomers(organizationId) {
        // Read every page; a truncated snapshot must never authorize an apparent CREATE.
        const records: CustomerSnapshot['records'][number][] = [];
        for (let offset = 0; offset < 10000; offset += 500) {
          const { data, error } = await supabase.from('customers').select('*').eq('organization_id', organizationId).order('id').range(offset, offset + 499);
          if (error) throw new Error('Customer snapshot could not be read; no plan was produced.');
          records.push(...(data || []) as CustomerSnapshot['records'][number][]);
          if ((data || []).length < 500) return { organizationId, complete: true, records };
        }
        return { organizationId, complete: false, records };
      },
    });
    // A registered predecessor is authoritative. A user-supplied prior export is
    // only a comparison aid before the registry exists; it never overrides the
    // durable lineage once one has been registered.
    const { data: registeredPrior, error: registryError } = await supabase
      .from('customer_review_manifests')
      .select('canonical_manifest')
      .eq('organization_id', profile.organization_id)
      .eq('entity_family', 'customer_master')
      .eq('source_system', 'food_connex')
      .eq('source_dataset_identifier', plan.source_reference)
      .order('manifest_version', { ascending: false })
      .limit(1)
      .maybeSingle();
    // Migration 021 is intentionally optional until applied; its absence must
    // not turn the existing read-only planner into a Customer write path.
    if (registryError && registryError.code !== '42P01') throw new Error('Manifest registry could not be read; no plan was produced.');
    const manifest = createCustomerManifest({plan,sourceRows:input.rows,relatedRecords:input.relatedRecords,previousManifest:registeredPrior?.canonical_manifest ?? input.previousManifest,datasetVersion:input.datasetVersion,generatedAt:new Date().toISOString(),generatedBy:profile.id,environment:process.env.NODE_ENV||'development'});
    return { detected: plan.counts.total, willCreate: plan.counts.CREATE, reconcile: plan.counts.UPDATE, duplicates: plan.counts.SKIP,
      errors: plan.rows.filter(row => row.decision === 'BLOCK').map(row => ({ row: row.row + 1, message: row.findings.filter(finding => finding.severity === 'error').map(finding => finding.code).join(', ') })), plan, manifest, manifestSummary: customerManifestSummary(manifest) };
  }
  const table = sourceTables;
  const errors: Array<{ row:number; message:string }> = []; let duplicates = 0; let willCreate = 0; let reconcile = 0; const seen = new Set<string>();
  for (const [index, row] of input.rows.entries()) {
    const sourceRecordId = text(row, 'source_record_id');
    if (!sourceRecordId) { errors.push({ row:index + 2, message:'Food Connex source record ID is required.' }); continue; }
    if (seen.has(sourceRecordId)) { duplicates += 1; continue; }
    seen.add(sourceRecordId);
    const existing = await existingSource(supabase, table[input.entity], profile.organization_id, sourceRecordId);
    if (existing) {
      if (existing.is_historical !== (mode === 'historical')) { errors.push({ row:index + 2, message:'This source record already exists in the other import mode. It cannot be silently converted.' }); continue; }
      if (mode === 'current') { reconcile += 1; continue; }
      duplicates += 1; continue;
    }
    const businessKey = input.entity === 'customers' ? ['customer_code', text(row, 'customer_code')] as const
      : input.entity === 'items' ? ['item_code', text(row, 'item_code')] as const
      : input.entity === 'vendors' ? ['vendor_code', text(row, 'vendor_code')] as const
      : input.entity === 'warehouses' ? ['warehouse_code', text(row, 'warehouse_code')] as const
      : input.entity === 'orders' ? ['external_po', text(row, 'external_po')] as const : null;
    if (businessKey?.[1]) {
      const [nativeField, nativeKey] = businessKey;
      const { data, error } = await supabase.from(table[input.entity]).select('id, source_system, source_record_id').eq('organization_id', profile.organization_id).eq(nativeField, nativeKey).limit(1);
      if (error) throw new Error(error.message);
      if (data?.length) {
        const matchingSource = data.some((record: { source_record_id?: string | null }) => record.source_record_id === sourceRecordId);
        const message = data.some((record: { source_system?: string }) => record.source_system !== 'food_connex')
          ? 'A Lucid-native record uses this business key. It will not be overwritten.'
          : 'A different Food Connex record uses this business key. Resolve the conflict before importing.';
        if (!matchingSource) { errors.push({ row:index + 2, message }); continue; }
      }
    }
    willCreate += 1;
  }
  return { detected: input.rows.length, willCreate, reconcile, duplicates, errors };
}
