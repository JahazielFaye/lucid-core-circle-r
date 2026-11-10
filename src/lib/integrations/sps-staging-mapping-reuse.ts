import 'server-only';

import type { CircleRMappingConfiguration } from './circle-r-sps-mappings';
import type { NormalizedSpsPurchaseOrder } from './sps-po-normalizer';

type MappingClient = {
  from: (table: string) => any;
};

type CustomerMapping = { id: string; source_trading_partner_id: string | null; food_connex_customer_id: string | null; food_connex_customer_name: string | null; customer_id: string | null; status: string };
type ShipToMapping = { id: string; source_trading_partner_id: string | null; source_location_code: string; food_connex_ship_to_id: string | null; food_connex_ship_to_name: string | null; ship_to_id: string | null; status: string };
type ItemMapping = { id: string; source_trading_partner_id: string | null; buyer_part_number: string | null; vendor_item: string | null; gtin: string | null; food_connex_item_id: string | null; food_connex_item_number: string; food_connex_uom: string | null; item_id: string | null; customer_item_id: string | null; approved_price: number | string | null; status: string };

export type ReusableSpsMappings = {
  configuration: CircleRMappingConfiguration;
  customerMapping: CustomerMapping | null;
  shipToMapping: ShipToMapping | null;
  itemMappingsByLineNumber: Map<string, ItemMapping>;
  ambiguousLineNumbers: Set<string>;
  inactiveCustomerMapping: boolean;
  inactiveShipToMapping: boolean;
  inactiveItemLineNumbers: Set<string>;
};

/**
 * Resolves only explicit, active mappings. Partner-specific mappings always
 * win over global mappings; no name matching or partial identifier matching is used.
 */
export async function loadReusableSpsMappings(
  supabase: MappingClient,
  organizationId: string,
  purchaseOrder: NormalizedSpsPurchaseOrder,
): Promise<ReusableSpsMappings> {
  const [customersResult, shipTosResult, itemsResult] = await Promise.all([
    supabase.from('integration_customer_mappings').select('id, source_trading_partner_id, food_connex_customer_id, food_connex_customer_name, customer_id, status').eq('organization_id', organizationId).eq('source_system', 'sps').eq('status', 'active'),
    supabase.from('integration_ship_to_mappings').select('id, source_trading_partner_id, source_location_code, food_connex_ship_to_id, food_connex_ship_to_name, ship_to_id, status').eq('organization_id', organizationId).eq('source_system', 'sps').eq('status', 'active'),
    supabase.from('integration_item_mappings').select('id, source_trading_partner_id, buyer_part_number, vendor_item, gtin, food_connex_item_id, food_connex_item_number, food_connex_uom, item_id, customer_item_id, approved_price, status').eq('organization_id', organizationId).eq('source_system', 'sps').eq('status', 'active'),
  ]);
  if (customersResult.error) throw customersResult.error;
  if (shipTosResult.error) throw shipTosResult.error;
  if (itemsResult.error) throw itemsResult.error;

  const partnerId = purchaseOrder.tradingPartnerId;
  const selectScope = <T extends { source_trading_partner_id: string | null }>(rows: T[]) => [
    ...rows.filter(row => row.source_trading_partner_id === partnerId),
    ...rows.filter(row => row.source_trading_partner_id === null),
  ];
  const customerMapping = selectScope((customersResult.data || []) as CustomerMapping[])[0] || null;
  const shipToMapping = selectScope(((shipTosResult.data || []) as ShipToMapping[])
    .filter(row => row.source_location_code === purchaseOrder.shipTo?.locationNumber))[0] || null;
  const itemMappings = (itemsResult.data || []) as ItemMapping[];
  const itemMappingsByLineNumber = new Map<string, ItemMapping>();
  const ambiguousLineNumbers = new Set<string>();

  for (const line of purchaseOrder.lines) {
    if (!line.lineNumber) continue;
    const partnerRows = itemMappings.filter(row => row.source_trading_partner_id === partnerId);
    const globalRows = itemMappings.filter(row => row.source_trading_partner_id === null);
    const matches = (rows: ItemMapping[]) => rows.filter(row =>
      (line.buyerPartNumber && row.buyer_part_number === line.buyerPartNumber) ||
      (line.vendorPartNumber && row.vendor_item === line.vendorPartNumber) ||
      (line.gtin && row.gtin === line.gtin),
    );
    const candidates = matches(partnerRows);
    const authoritativeCandidates = candidates.length ? candidates : matches(globalRows);
    const targetKeys = new Set(authoritativeCandidates.map(row => row.item_id || row.food_connex_item_number));
    if (targetKeys.size > 1) { ambiguousLineNumbers.add(line.lineNumber); continue; }
    if (authoritativeCandidates[0]) itemMappingsByLineNumber.set(line.lineNumber, authoritativeCandidates[0]);
  }

  const customerIds = [customerMapping?.customer_id].filter((id): id is string => Boolean(id));
  const shipToIds = [shipToMapping?.ship_to_id].filter((id): id is string => Boolean(id));
  const itemIds = Array.from(itemMappingsByLineNumber.values()).map(mapping => mapping.item_id).filter((id): id is string => Boolean(id));
  const [customerStates, shipToStates, itemStates] = await Promise.all([
    customerIds.length ? supabase.from('customers').select('id, status').in('id', customerIds) : Promise.resolve({ data: [], error: null }),
    shipToIds.length ? supabase.from('customer_ship_tos').select('id, status').in('id', shipToIds) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? supabase.from('items').select('id, status').in('id', itemIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (customerStates.error || shipToStates.error || itemStates.error) throw customerStates.error || shipToStates.error || itemStates.error;
  const activeCustomerIds = new Set((customerStates.data || []).filter((row: { status: string }) => row.status === 'active').map((row: { id: string }) => row.id));
  const activeShipToIds = new Set((shipToStates.data || []).filter((row: { status: string }) => row.status === 'active').map((row: { id: string }) => row.id));
  const activeItemIds = new Set((itemStates.data || []).filter((row: { status: string }) => row.status === 'active').map((row: { id: string }) => row.id));
  const inactiveItemLineNumbers = new Set(Array.from(itemMappingsByLineNumber.entries()).filter(([, mapping]) => Boolean(mapping.item_id) && !activeItemIds.has(mapping.item_id!)).map(([lineNumber]) => lineNumber));

  return {
    customerMapping,
    shipToMapping,
    itemMappingsByLineNumber,
    ambiguousLineNumbers,
    inactiveCustomerMapping: Boolean(customerMapping?.customer_id) && !activeCustomerIds.has(customerMapping.customer_id!),
    inactiveShipToMapping: Boolean(shipToMapping?.ship_to_id) && !activeShipToIds.has(shipToMapping.ship_to_id!),
    inactiveItemLineNumbers,
    configuration: {
      customers: customerMapping && partnerId ? [{ spsTradingPartnerId: partnerId, foodConnexCustomerId: customerMapping.food_connex_customer_id || '', foodConnexCustomerName: customerMapping.food_connex_customer_name || '' }] : [],
      shipTos: shipToMapping && purchaseOrder.shipTo?.locationNumber ? [{ spsLocationCode: purchaseOrder.shipTo.locationNumber, foodConnexShipToId: shipToMapping.food_connex_ship_to_id || '', foodConnexShipToName: shipToMapping.food_connex_ship_to_name || '' }] : [],
      items: purchaseOrder.lines.flatMap(line => {
        const mapping = line.lineNumber ? itemMappingsByLineNumber.get(line.lineNumber) : undefined;
        return mapping ? [{ buyerPartNumber: mapping.buyer_part_number || undefined, vendorPartNumber: mapping.vendor_item || undefined, gtin: mapping.gtin || undefined, foodConnexItemId: mapping.food_connex_item_id || undefined, foodConnexItemNumber: mapping.food_connex_item_number, foodConnexUom: mapping.food_connex_uom || undefined, approvedCircleRPrice: mapping.approved_price == null ? undefined : Number(mapping.approved_price) }] : [];
      }),
    },
  };
}
