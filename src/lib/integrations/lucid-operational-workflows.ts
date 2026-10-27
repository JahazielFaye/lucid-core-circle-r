import 'server-only';

import { createClient } from '@/utils/supabase/server';
import { commitHistoricalImport, previewHistoricalImport } from '@/lib/integrations/historical-import';

export class OperationalWorkflowAuthError extends Error {}

type WorkflowAction =
  | 'create_receipt' | 'append_receipt_line' | 'post_inventory_transaction' | 'create_production_run'
  | 'record_consumption' | 'record_output' | 'link_case' | 'create_shipment'
  | 'allocate_case' | 'remove_allocation' | 'add_shipment_case' | 'add_shipment_pallet' | 'complete_shipment';

const roleByAction: Record<WorkflowAction, string[]> = {
  create_receipt: ['office', 'leadership', 'lucid_admin'],
  append_receipt_line: ['office', 'leadership', 'lucid_admin'],
  post_inventory_transaction: ['office', 'leadership', 'lucid_admin'],
  create_production_run: ['production', 'office', 'leadership', 'lucid_admin'],
  record_consumption: ['production', 'office', 'leadership', 'lucid_admin'],
  record_output: ['production', 'office', 'leadership', 'lucid_admin'],
  link_case: ['production', 'office', 'leadership', 'lucid_admin'],
  allocate_case: ['office', 'leadership', 'lucid_admin'],
  remove_allocation: ['office', 'leadership', 'lucid_admin'],
  create_shipment: ['office', 'leadership', 'lucid_admin'],
  add_shipment_case: ['office', 'leadership', 'lucid_admin'],
  add_shipment_pallet: ['office', 'leadership', 'lucid_admin'],
  complete_shipment: ['office', 'leadership', 'lucid_admin'],
};

async function context(action: WorkflowAction) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new OperationalWorkflowAuthError('An authenticated Lucid Core session is required.');
  const { data: profile, error } = await supabase.from('profiles').select('id, organization_id, active, role').eq('id', user.id).maybeSingle();
  if (error || !profile?.active) throw new OperationalWorkflowAuthError('An active Lucid Core profile is required.');
  if (!roleByAction[action].includes(profile.role)) throw new OperationalWorkflowAuthError('Your role cannot perform this operational action.');
  return { supabase, profile };
}
function controlledSourceSystem(value: unknown) {
  if (value == null || value === '') return 'lucid_core' as const;
  if (value !== 'lucid_core' && value !== 'lucid_qa') throw new Error('Use the Lucid Core or controlled QA source only.');
  return value;
}
function qaReference(value: unknown) {
  const reference = string(value, 'QA reference');
  if (!reference) throw new Error('QA reference is required.');
  if (!reference.toUpperCase().startsWith('QA-')) throw new Error('Controlled QA references must begin with QA-.');
  return reference;
}

function string(value: unknown, name: string, optional = false) {
  if (typeof value !== 'string') {
    if (optional && (value == null || value === '')) return null;
    throw new Error(`${name} is required.`);
  }
  const result = value.trim();
  if (!result && !optional) throw new Error(`${name} is required.`);
  return result || null;
}
function numeric(value: unknown, name: string, optional = false) {
  if (optional && (value == null || value === '')) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || (!optional && result <= 0)) throw new Error(`${name} must be a positive number.`);
  return result;
}
async function rpc(action: WorkflowAction, name: string, args: Record<string, unknown>, sourceSystem: 'lucid_core'|'lucid_qa' = 'lucid_core') {
  const { supabase, profile } = await context(action);
  if (sourceSystem === 'lucid_qa' && profile.role !== 'lucid_admin') {
    throw new OperationalWorkflowAuthError('Only Lucid Admin can create controlled QA records.');
  }
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

export async function runOperationalWorkflow(action: string, body: Record<string, unknown>) {
  const sourceSystem = controlledSourceSystem(body.sourceSystem);
  switch (action) {
    case 'preview-historical-import': return previewHistoricalImport({
      entity: string(body.entity, 'Historical entity') as import('@/lib/integrations/historical-import').HistoricalImportEntity,
      rows: Array.isArray(body.rows) ? body.rows as import('@/lib/integrations/historical-import').HistoricalImportRow[] : [],
    });
    case 'commit-historical-import': return commitHistoricalImport({
      entity: string(body.entity, 'Historical entity') as import('@/lib/integrations/historical-import').HistoricalImportEntity,
      sourceReference: string(body.sourceReference, 'Source reference', true) || undefined,
      rows: Array.isArray(body.rows) ? body.rows as import('@/lib/integrations/historical-import').HistoricalImportRow[] : [],
    });
    case 'create-receipt': {
      const isQa = sourceSystem === 'lucid_qa';
      const transactionNumber = isQa ? qaReference(body.transactionNumber) : string(body.transactionNumber, 'Receipt number');
      const sourceReference = isQa ? qaReference(body.qaReference ?? transactionNumber) : null;
      return rpc('create_receipt', isQa ? 'create_lucid_qa_receipt' : 'create_lucid_receipt', {
        p_transaction_number: transactionNumber, p_item_id: string(body.itemCode, 'Item code'), p_lot_code: string(body.lotCode, 'Lot code'),
        p_quantity: numeric(body.quantity, 'Quantity'), p_quantity_uom: string(body.uom, 'UOM'), p_net_weight: numeric(body.netWeight, 'Net weight', true), p_weight_uom: string(body.weightUom, 'Weight UOM', true), p_warehouse_id: string(body.warehouse, 'Warehouse', true), p_source_record_id: sourceReference, p_vendor_name: string(body.vendor, 'Vendor', true), p_purchase_order_reference: string(body.purchaseOrder, 'PO reference', true), p_internal_lot_number: string(body.internalLot, 'Internal lot', true), p_unit_cost: numeric(body.unitCost, 'Unit cost', true), p_charge: numeric(body.charge, 'Charge', true) ?? 0,
      }, sourceSystem);
    }
    case 'append-receipt-line': return rpc('append_receipt_line', 'append_lucid_receipt_line', { p_transaction_id: string(body.transactionId, 'Receipt'), p_item_id: string(body.itemCode, 'Item code'), p_lot_code: string(body.lotCode, 'Lot code'), p_quantity: numeric(body.quantity, 'Quantity'), p_quantity_uom: string(body.uom, 'UOM'), p_net_weight: numeric(body.netWeight, 'Net weight', true), p_weight_uom: string(body.weightUom, 'Weight UOM', true), p_internal_lot_number: string(body.internalLot, 'Internal lot', true), p_unit_cost: numeric(body.unitCost, 'Unit cost', true), p_charge: numeric(body.charge, 'Charge', true) ?? 0 });
    case 'post-inventory': return rpc('post_inventory_transaction', 'post_lucid_inventory_transaction', { p_transaction_id: string(body.transactionId, 'Inventory transaction') });
    case 'create-production-run': return rpc('create_production_run', 'create_lucid_production_run', { p_order_id: string(body.orderId, 'Order'), p_output_production_lot_id: string(body.productionLotId, 'Production lot'), p_output_item_id: string(body.itemCode, 'Item code'), p_reference: string(body.reference, 'Reference', true) });
    case 'record-consumption': return rpc('record_consumption', 'record_lucid_production_consumption', { p_production_run_id: string(body.productionRunId, 'Production run'), p_inventory_lot_id: string(body.inventoryLotId, 'Inventory lot'), p_item_id: string(body.itemCode, 'Item code'), p_quantity: numeric(body.quantity, 'Quantity'), p_quantity_uom: string(body.uom, 'UOM', true), p_net_weight: numeric(body.netWeight, 'Net weight', true), p_weight_uom: string(body.weightUom, 'Weight UOM', true) });
    case 'record-output': return rpc('record_output', 'record_lucid_production_output', { p_production_run_id: string(body.productionRunId, 'Production run'), p_item_id: string(body.itemCode, 'Item code'), p_quantity: numeric(body.quantity, 'Quantity'), p_quantity_uom: string(body.uom, 'UOM', true), p_weight: numeric(body.weight, 'Weight', true), p_weight_uom: string(body.weightUom, 'Weight UOM', true) });
    case 'link-case': return rpc('link_case', 'link_lucid_case_to_production_run', { p_production_case_id: string(body.productionCaseId, 'Production case'), p_production_run_id: string(body.productionRunId, 'Production run') });
    case 'allocate-case': return rpc('allocate_case', 'allocate_lucid_case', { p_order_id: string(body.orderId, 'Order'), p_order_line_id: string(body.orderLineId, 'Order line'), p_production_case_id: string(body.productionCaseId, 'Production case') });
    case 'remove-allocation': return rpc('remove_allocation', 'remove_lucid_case_allocation', { p_pick_allocation_id: string(body.pickAllocationId, 'Pick allocation'), p_reason: string(body.reason, 'Reason') });
    case 'create-shipment': return rpc('create_shipment', 'create_lucid_shipment', { p_order_id: string(body.orderId, 'Order'), p_bol_reference: string(body.bolReference, 'BOL reference', true), p_carrier_name: string(body.carrierName, 'Carrier', true), p_carrier_reference: string(body.carrierReference, 'Carrier reference', true) });
    case 'add-shipment-case': return rpc('add_shipment_case', 'add_lucid_shipment_content', { p_shipment_id: string(body.shipmentId, 'Shipment'), p_production_case_id: string(body.productionCaseId, 'Production case'), p_pallet_id: null });
    case 'add-shipment-pallet': return rpc('add_shipment_pallet', 'add_lucid_shipment_content', { p_shipment_id: string(body.shipmentId, 'Shipment'), p_production_case_id: null, p_pallet_id: string(body.palletId, 'Pallet') });
    case 'complete-shipment': return rpc('complete_shipment', 'complete_lucid_shipment', { p_shipment_id: string(body.shipmentId, 'Shipment'), p_invoice_number: string(body.invoiceNumber, 'Invoice number', true), p_external_accounting_id: string(body.externalAccountingId, 'Accounting reference', true), p_invoice_status: string(body.invoiceStatus, 'Invoice status', true) });
    default: throw new Error('Unknown operational workflow action.');
  }
}
