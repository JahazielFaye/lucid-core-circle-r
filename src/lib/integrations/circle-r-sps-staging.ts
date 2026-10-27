import 'server-only';

import { createClient } from '@/utils/supabase/server';

import { mapSpsPurchaseOrderToCircleR } from './circle-r-po-mapper';
import { circleRVerifiedPurchaseOrderFixture } from './circle-r-sps-fixture';
import { circleRMockMappings } from './circle-r-sps-mappings';
import { normalizeSpsPurchaseOrder } from './sps-po-normalizer';
import { getSpsSandboxTransactionText, normalizeSpsSandboxPoPath } from './sps-transactions';
import { listSpsSandboxOutboundPoTransactionEntries } from './sps-transactions';
import { loadReusableSpsMappings } from './sps-staging-mapping-reuse';

type Supabase = Awaited<ReturnType<typeof createClient>>;

export class StagingAuthError extends Error {
  constructor(
    message: string,
    public readonly stage: 'auth' | 'profile' = 'auth',
  ) {
    super(message);
  }
}
export type ImportStage = 'auth' | 'profile' | 'sps_fetch' | 'normalize' | 'map' | 'persist_staged_order' | 'persist_lines' | 'persist_exceptions';
export class StagingPipelineError extends Error {
  constructor(public readonly stage: ImportStage, public readonly cause: unknown) {
    super(`SPS import failed during ${stage}.`);
  }
}

const SANDBOX_PO_SOURCE_PATH = 'out/PO/PO584615-1-v7.7-BulkImport.xml';

/**
 * Imports the known SPS Sandbox PO using no Circle R mapping records. This is
 * read-only against SPS and stages the result for review only.
 */
export async function importSandboxPurchaseOrder() {
  return importSandboxPurchaseOrderFromSourcePath(SANDBOX_PO_SOURCE_PATH);
}

export async function importSandboxPurchaseOrderFromSourcePath(sourcePath: string) {
  sourcePath = normalizeSpsSandboxPoPath(sourcePath);
  const supabase = await createClient();
  let organizationId: string;
  try {
    organizationId = await getActiveOrganizationId(supabase);
  } catch (error) {
    if (error instanceof StagingAuthError) {
      throw new StagingPipelineError(error.stage, error);
    }
    throw new StagingPipelineError('profile', error);
  }
  const transaction = await atStage('sps_fetch', () => getSpsSandboxTransactionText(sourcePath));
  if (transaction.sourcePath !== sourcePath) {
    throw new StagingPipelineError('sps_fetch', new Error('SPS source path integrity check failed.'));
  }
  const purchaseOrder = await atStage('normalize', () => Promise.resolve(normalizeSpsPurchaseOrder(
    transaction.payload, sourcePath,
  )));
  const reusableMappings = await atStage('map', () => loadReusableSpsMappings(
    supabase, organizationId, purchaseOrder,
  ));
  const candidate = await atStage('map', () => Promise.resolve(mapSpsPurchaseOrderToCircleR(
    purchaseOrder, reusableMappings.configuration,
  )));
  const poNumber = candidate.order.poNumber;
  const tradingPartnerId = candidate.order.tradingPartnerId;
  if (!poNumber || !tradingPartnerId) {
    throw new Error('The SPS Sandbox PO is missing its required PO identity.');
  }

  const payload = {
    organization_id: organizationId,
    source_system: 'sps',
    source_file: sourcePath.split('/').at(-1) ?? sourcePath,
    source_path: sourcePath,
    external_po: poNumber,
    trading_partner_id: tradingPartnerId,
    po_date: candidate.order.poDate,
    requested_ship_date: candidate.order.requestedDate,
    requested_delivery_date: null,
    source_customer_name: candidate.order.customer.spsName,
    source_ship_to_name: candidate.order.shipTo.spsName,
    source_ship_to_code: candidate.order.shipTo.spsLocationCode,
    customer_mapping_id: reusableMappings.customerMapping?.id ?? null,
    ship_to_mapping_id: reusableMappings.shipToMapping?.id ?? null,
    mapping_status: candidate.status === 'ready' ? 'mapped' : candidate.order.lines.some(line => line.itemMappingStatus === 'mapped') || reusableMappings.customerMapping || reusableMappings.shipToMapping ? 'partially_mapped' : 'unmapped',
    review_status: candidate.status === 'ready' ? 'ready' : 'needs_review',
    raw_xml: transaction.payload,
    normalized_payload: purchaseOrder,
  };
  const stagedOrder = await atStage('persist_staged_order', () => upsertStagedOrder(
    supabase, organizationId, tradingPartnerId, poNumber, payload,
  ));

  const { error: deleteExceptionsError } = await supabase
    .from('sps_order_exceptions').delete().eq('staged_order_id', stagedOrder.id);
  if (deleteExceptionsError) throw new StagingPipelineError('persist_exceptions', deleteExceptionsError);
  const { error: deleteLinesError } = await supabase
    .from('sps_staged_order_lines').delete().eq('staged_order_id', stagedOrder.id);
  if (deleteLinesError) throw new StagingPipelineError('persist_lines', deleteLinesError);

  const persistedLines = [] as Array<{ id: string; lineNumber: string | null }>;
  for (const line of candidate.order.lines) {
    const sourceLine = purchaseOrder.lines.find(
      (item) => item.lineNumber === line.lineNumber,
    );
    const reusedItemMapping = line.lineNumber ? reusableMappings.itemMappingsByLineNumber.get(line.lineNumber) : undefined;
    const { data, error } = await supabase.from('sps_staged_order_lines').insert({
      organization_id: organizationId, staged_order_id: stagedOrder.id,
      line_number: line.lineNumber, buyer_part_number: line.buyerPartNumber,
      vendor_item: line.vendorPartNumber, gtin: line.gtin,
      description: sourceLine?.description ?? null, quantity: line.quantity,
      sps_uom: line.spsUom, sps_purchase_price: line.spsPurchasePrice,
      item_mapping_id: reusedItemMapping?.id ?? null, mapped_food_connex_item_id: line.mappedFoodConnexItemId,
      mapped_food_connex_item_number: line.mappedFoodConnexItemNumber, food_connex_uom: line.foodConnexUom,
      approved_circle_r_price: line.approvedCircleRPrice, item_mapping_status: line.itemMappingStatus,
      price_status: line.priceStatus, uom_status: line.uomStatus, raw_payload: sourceLine ?? null,
    }).select('id, line_number').single();
    if (error) throw new StagingPipelineError('persist_lines', error);
    persistedLines.push({ id: data.id, lineNumber: data.line_number });
  }

  for (const exception of candidate.exceptions) {
    const stagedLine = persistedLines.find(
      (line) => line.lineNumber === exception.lineNumber,
    );
    const { error } = await supabase.from('sps_order_exceptions').insert({
      organization_id: organizationId, staged_order_id: stagedOrder.id,
      staged_order_line_id: stagedLine?.id ?? null,
      exception_code: exception.code, severity: exception.severity,
      field_name: exception.field, message: exception.message,
      suggested_actions: exception.suggestedActions,
      details: { source: 'sps_sandbox', source_path: sourcePath },
      status: 'open',
    });
    if (error) throw new StagingPipelineError('persist_exceptions', error);
  }

  return {
    stagedOrderId: stagedOrder.id, sourcePath, poNumber,
    lineCount: persistedLines.length, exceptionCount: candidate.exceptions.length,
    mappingStatus: payload.mapping_status, reviewStatus: payload.review_status,
  };
}

export async function importNewSandboxPurchaseOrders() {
  const supabase = await createClient();
  let organizationId: string;
  try {
    organizationId = await getActiveOrganizationId(supabase);
  } catch (error) {
    if (error instanceof StagingAuthError) {
      throw new StagingPipelineError(error.stage, error);
    }
    throw new StagingPipelineError('profile', error);
  }
  const directory = await atStage('sps_fetch', () => listSpsSandboxOutboundPoTransactionEntries());
  const files = directory.results
    .filter((entry) => entry.type === 'file')
    .map((entry) => normalizeSpsSandboxPoPath(entry.path));
  const { data: staged, error } = await supabase
    .from('sps_staged_orders').select('source_path, trading_partner_id, external_po').eq('organization_id', organizationId)
    .eq('source_system', 'sps');
  if (error) throw new StagingPipelineError('persist_staged_order', error);
  const stagedPaths = new Set((staged ?? [])
    .map((row) => row.source_path)
    .filter((path): path is string => typeof path === 'string')
    .filter((path) => path.replace(/^\/+/, '').startsWith('out/PO/'))
    .map(normalizeSpsSandboxPoPath));
  const newPaths = files.filter((path) => !stagedPaths.has(path));
  const imported: Array<Record<string, unknown>> = [];
  const duplicateBusinessIdentity: Array<{ sourcePath: string; existingPoNumber: string }> = [];
  const failed: Array<{ sourcePath: string; stage: string; error: string }> = [];
  for (const path of newPaths.slice(0, 10)) {
    try {
      const transaction = await getSpsSandboxTransactionText(path);
      const normalized = normalizeSpsPurchaseOrder(transaction.payload, path);
      const existingBusinessOrder = (staged ?? []).find(
        (order) => order.trading_partner_id === normalized.tradingPartnerId &&
          order.external_po === normalized.purchaseOrderNumber,
      );
      if (existingBusinessOrder) {
        duplicateBusinessIdentity.push({ sourcePath: path, existingPoNumber: existingBusinessOrder.external_po });
        continue;
      }
      const result = await importSandboxPurchaseOrderFromSourcePath(path);
      imported.push({
        sourcePath: result.sourcePath, poNumber: result.poNumber,
        lineCount: result.lineCount, exceptionCount: result.exceptionCount,
        mappingStatus: result.mappingStatus, reviewStatus: result.reviewStatus,
      });
    } catch (caught) {
      const failure = caught instanceof StagingPipelineError ? caught : null;
      const cause = failure?.cause;
      const message = cause && typeof cause === 'object' && typeof (cause as { message?: unknown }).message === 'string'
        ? (cause as { message: string }).message : 'Import failed.';
      failed.push({ sourcePath: path, stage: failure?.stage ?? 'persist_staged_order', error: message });
    }
  }
  return {
    discoveredCount: files.length, newCount: newPaths.length,
    alreadyStagedCount: files.length - newPaths.length,
    duplicateBusinessIdentityCount: duplicateBusinessIdentity.length,
    newBusinessOrderCount: imported.length,
    duplicateBusinessIdentity, importedCount: imported.length, imported, failed,
  };
}

/** Read-only identity check for every currently discoverable Sandbox PO. */
export async function inspectDiscoveredSandboxPurchaseOrderIdentities() {
  const supabase = await createClient();
  await getActiveOrganizationId(supabase);
  const directory = await listSpsSandboxOutboundPoTransactionEntries();
  const identities: Array<{ sourcePath: string; purchaseOrderNumber: string | null; lineCount: number }> = [];
  for (const entry of directory.results.filter((item) => item.type === 'file')) {
    const sourcePath = normalizeSpsSandboxPoPath(entry.path);
    const transaction = await getSpsSandboxTransactionText(sourcePath);
    if (transaction.sourcePath !== sourcePath) {
      throw new Error('SPS source path integrity check failed.');
    }
    const purchaseOrder = normalizeSpsPurchaseOrder(transaction.payload, sourcePath);
    identities.push({ sourcePath, purchaseOrderNumber: purchaseOrder.purchaseOrderNumber, lineCount: purchaseOrder.lines.length });
  }
  const duplicatePurchaseOrderNumbers = identities
    .filter((identity) => identity.purchaseOrderNumber !== null)
    .reduce<Record<string, string[]>>((duplicates, identity) => {
      const key = identity.purchaseOrderNumber!;
      duplicates[key] = [...(duplicates[key] ?? []), identity.sourcePath];
      return duplicates;
    }, {});
  return {
    files: identities,
    duplicatePurchaseOrderNumbers: Object.entries(duplicatePurchaseOrderNumbers)
      .filter(([, paths]) => paths.length > 1)
      .map(([purchaseOrderNumber, sourcePaths]) => ({ purchaseOrderNumber, sourcePaths })),
  };
}

export async function persistCircleRFixture() {
  const supabase = await createClient();
  const organizationId = await getActiveOrganizationId(supabase);
  const candidate = mapSpsPurchaseOrderToCircleR(circleRVerifiedPurchaseOrderFixture);
  const tradingPartnerId = candidate.order.tradingPartnerId;
  const poNumber = candidate.order.poNumber;
  if (!tradingPartnerId || !poNumber) {
    throw new Error('The Circle R fixture is missing its required PO identity.');
  }

  const customerMapping = await ensureCustomerMapping(supabase, organizationId);
  const shipToMapping = await ensureShipToMapping(supabase, organizationId);
  const itemMappings = await Promise.all(
    circleRMockMappings.items.map((mapping) =>
      ensureItemMapping(supabase, organizationId, tradingPartnerId, mapping),
    ),
  );

  const mappingStatus = candidate.status === 'ready' ? 'mapped' : 'needs_review';
  const reviewStatus = candidate.status === 'ready' ? 'ready' : 'needs_review';
  const stagedOrderPayload = {
    organization_id: organizationId,
    source_system: 'sps',
    source_file: circleRVerifiedPurchaseOrderFixture.sourceFile,
    source_path: null,
    external_po: poNumber,
    trading_partner_id: tradingPartnerId,
    po_date: candidate.order.poDate,
    requested_ship_date: candidate.order.requestedDate,
    requested_delivery_date: null,
    source_customer_name: candidate.order.customer.spsName,
    source_ship_to_name: candidate.order.shipTo.spsName,
    source_ship_to_code: candidate.order.shipTo.spsLocationCode,
    customer_mapping_id: customerMapping.id,
    ship_to_mapping_id: shipToMapping.id,
    mapping_status: mappingStatus,
    review_status: reviewStatus,
    raw_xml: null,
    normalized_payload: circleRVerifiedPurchaseOrderFixture,
  };

  const { data: existingOrder, error: existingOrderError } = await supabase
    .from('sps_staged_orders')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('source_system', 'sps')
    .eq('trading_partner_id', tradingPartnerId)
    .eq('external_po', poNumber)
    .maybeSingle();
  if (existingOrderError) throw existingOrderError;

  const stagedOrder = existingOrder
    ? await updateStagedOrder(supabase, existingOrder.id, stagedOrderPayload)
    : await insertStagedOrder(supabase, stagedOrderPayload);

  // This fixture owns its derived rows; recreate them so repeat runs are idempotent.
  const { error: deleteExceptionsError } = await supabase
    .from('sps_order_exceptions')
    .delete()
    .eq('staged_order_id', stagedOrder.id);
  if (deleteExceptionsError) throw deleteExceptionsError;
  const { error: deleteLinesError } = await supabase
    .from('sps_staged_order_lines')
    .delete()
    .eq('staged_order_id', stagedOrder.id);
  if (deleteLinesError) throw deleteLinesError;

  const persistedLines = [] as Array<{ id: string; lineNumber: string | null }>;
  for (const line of candidate.order.lines) {
    const itemMapping = itemMappings.find(
      (mapping) => mapping.buyer_part_number === line.buyerPartNumber,
    );
    const { data, error } = await supabase
      .from('sps_staged_order_lines')
      .insert({
        organization_id: organizationId,
        staged_order_id: stagedOrder.id,
        line_number: line.lineNumber,
        buyer_part_number: line.buyerPartNumber,
        vendor_item: line.vendorPartNumber,
        gtin: line.gtin,
        description: null,
        quantity: line.quantity,
        sps_uom: line.spsUom,
        sps_purchase_price: line.spsPurchasePrice,
        item_mapping_id: itemMapping?.id ?? null,
        mapped_food_connex_item_id: line.mappedFoodConnexItemId,
        mapped_food_connex_item_number: line.mappedFoodConnexItemNumber,
        food_connex_uom: line.foodConnexUom,
        approved_circle_r_price: line.approvedCircleRPrice,
        item_mapping_status: line.itemMappingStatus,
        price_status: line.priceStatus,
        uom_status: line.uomStatus,
        raw_payload: circleRVerifiedPurchaseOrderFixture.lines.find(
          (fixtureLine) => fixtureLine.lineNumber === line.lineNumber,
        ),
      })
      .select('id, line_number')
      .single();
    if (error) throw error;
    persistedLines.push({ id: data.id, lineNumber: data.line_number });
  }

  const exceptions = candidate.exceptions.filter(
    (exception) =>
      exception.code === 'REQUESTED_DATE_UNMAPPED' ||
      exception.code === 'PRICE_MISMATCH',
  );
  for (const exception of exceptions) {
    const stagedLine = persistedLines.find(
      (line) => line.lineNumber === exception.lineNumber,
    );
    const { error } = await supabase.from('sps_order_exceptions').insert({
      organization_id: organizationId,
      staged_order_id: stagedOrder.id,
      staged_order_line_id: stagedLine?.id ?? null,
      exception_code: exception.code,
      severity: exception.severity,
      field_name: exception.field,
      message: exception.message,
      suggested_actions: exception.suggestedActions,
      details: { source: 'circle_r_verified_fixture' },
      status: 'open',
    });
    if (error) throw error;
  }

  return {
    stagedOrderId: stagedOrder.id,
    poNumber,
    lineCount: persistedLines.length,
    exceptionCount: exceptions.length,
    mappingStatus,
    reviewStatus,
  };
}

async function getActiveOrganizationId(supabase: Supabase): Promise<string> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) {
    throw new StagingAuthError('An authenticated Lucid Core session is required.');
  }
  const { data: profile, error: profileError } = await supabase
    .from('profiles').select('organization_id, active').eq('id', user.id).maybeSingle();
  if (profileError || !profile?.active) {
    throw new StagingAuthError('An active Lucid Core profile is required.', 'profile');
  }
  return profile.organization_id;
}

async function atStage<T>(stage: ImportStage, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof StagingPipelineError) throw error;
    throw new StagingPipelineError(stage, error);
  }
}

async function upsertStagedOrder(
  supabase: Supabase, organizationId: string, tradingPartnerId: string,
  poNumber: string, payload: Record<string, unknown>,
) {
  const { data: existing, error } = await supabase.from('sps_staged_orders')
    .select('id').eq('organization_id', organizationId).eq('source_system', 'sps')
    .eq('trading_partner_id', tradingPartnerId).eq('external_po', poNumber).maybeSingle();
  if (error) throw error;
  return existing
    ? updateStagedOrder(supabase, existing.id, payload)
    : insertStagedOrder(supabase, payload);
}

async function ensureCustomerMapping(supabase: Supabase, organizationId: string) {
  const source = circleRMockMappings.customers[0];
  const { data: existing, error } = await supabase
    .from('integration_customer_mappings')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('source_system', 'sps')
    .eq('source_trading_partner_id', source.spsTradingPartnerId)
    .maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const result = await supabase.from('integration_customer_mappings').insert({
    organization_id: organizationId, source_system: 'sps',
    source_trading_partner_id: source.spsTradingPartnerId,
    source_customer_name: source.foodConnexCustomerName,
    food_connex_customer_id: source.foodConnexCustomerId,
    food_connex_customer_name: source.foodConnexCustomerName,
  }).select('id').single();
  if (result.error) throw result.error;
  return result.data;
}

async function ensureShipToMapping(supabase: Supabase, organizationId: string) {
  const source = circleRMockMappings.shipTos[0];
  const { data: existing, error } = await supabase
    .from('integration_ship_to_mappings').select('id')
    .eq('organization_id', organizationId).eq('source_system', 'sps')
    .eq('source_trading_partner_id', 'CHENEY_BROTHERS_INC')
    .eq('source_location_code', source.spsLocationCode).maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const result = await supabase.from('integration_ship_to_mappings').insert({
    organization_id: organizationId, source_system: 'sps',
    source_trading_partner_id: 'CHENEY_BROTHERS_INC',
    source_location_code: source.spsLocationCode,
    source_ship_to_name: source.foodConnexShipToName,
    food_connex_ship_to_id: source.foodConnexShipToId,
    food_connex_ship_to_name: source.foodConnexShipToName,
  }).select('id').single();
  if (result.error) throw result.error;
  return result.data;
}

async function ensureItemMapping(
  supabase: Supabase, organizationId: string, tradingPartnerId: string,
  source: (typeof circleRMockMappings.items)[number],
) {
  const { data: existing, error } = await supabase
    .from('integration_item_mappings').select('id, buyer_part_number')
    .eq('organization_id', organizationId).eq('source_system', 'sps')
    .eq('source_trading_partner_id', tradingPartnerId)
    .eq('buyer_part_number', source.buyerPartNumber ?? '').maybeSingle();
  if (error) throw error;
  if (existing) return existing;
  const result = await supabase.from('integration_item_mappings').insert({
    organization_id: organizationId, source_system: 'sps',
    source_trading_partner_id: tradingPartnerId,
    buyer_part_number: source.buyerPartNumber ?? null,
    vendor_item: source.vendorPartNumber ?? null, gtin: source.gtin ?? null,
    food_connex_item_id: source.foodConnexItemId,
    food_connex_item_number: source.foodConnexItemNumber,
    sps_uom: 'Case', food_connex_uom: source.foodConnexUom ?? null,
    approved_price: source.approvedCircleRPrice ?? null,
  }).select('id, buyer_part_number').single();
  if (result.error) throw result.error;
  return result.data;
}

async function insertStagedOrder(supabase: Supabase, payload: Record<string, unknown>) {
  const result = await supabase.from('sps_staged_orders').insert(payload).select('id').single();
  if (result.error) throw result.error;
  return result.data;
}

async function updateStagedOrder(supabase: Supabase, id: string, payload: Record<string, unknown>) {
  const result = await supabase.from('sps_staged_orders').update(payload).eq('id', id).select('id').single();
  if (result.error) throw result.error;
  return result.data;
}
