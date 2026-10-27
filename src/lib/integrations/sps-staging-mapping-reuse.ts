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

  for (const line of purchaseOrder.lines) {
    if (!line.lineNumber) continue;
    const scoped = selectScope(itemMappings);
    // Identifier precedence is deterministic within each scope.
    const matched = [
      line.buyerPartNumber ? scoped.find(row => row.buyer_part_number === line.buyerPartNumber) : undefined,
      line.vendorPartNumber ? scoped.find(row => row.vendor_item === line.vendorPartNumber) : undefined,
      line.gtin ? scoped.find(row => row.gtin === line.gtin) : undefined,
    ].find((row): row is ItemMapping => Boolean(row));
    if (matched) itemMappingsByLineNumber.set(line.lineNumber, matched);
  }

  return {
    customerMapping,
    shipToMapping,
    itemMappingsByLineNumber,
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
