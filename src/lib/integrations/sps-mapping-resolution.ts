import 'server-only';

import { createClient } from '@/utils/supabase/server';
import { recalculateStagedOrderStatus, SpsResolutionAuthError } from './sps-exception-resolution';

type Supabase = Awaited<ReturnType<typeof createClient>>;
type Profile = { id: string; organizationId: string; role: string };
const mappingRoles = new Set(['lucid_admin', 'leadership', 'office']);

// TODO(lucid-master-data): These legacy food_connex_* columns and request keys
// are a temporary persistence adapter. Order Review intentionally presents them
// as Lucid customer, ship-to, and item records until the schema is renamed.
export async function mapCustomerException(id: string, input: { customerId?: string; foodConnexCustomerId?: string; foodConnexCustomerName?: string }) {
  const { supabase, profile, exception, order } = await contextFor(id, 'CUSTOMER_UNMAPPED');
  const nativeCustomer = await nativeCustomerFor(supabase, profile.organizationId, input.customerId);
  if (!nativeCustomer) { required(input.foodConnexCustomerId, 'Legacy customer ID'); required(input.foodConnexCustomerName, 'Legacy customer name'); }
  let { data: mapping, error } = await supabase.from('integration_customer_mappings').select('id')
    .eq('organization_id', profile.organizationId).eq('source_system', 'sps').eq('source_trading_partner_id', order.trading_partner_id).maybeSingle();
  if (error) throw error;
  if (!mapping) {
    const result = await supabase.from('integration_customer_mappings').insert({ organization_id: profile.organizationId, source_system: 'sps', source_trading_partner_id: order.trading_partner_id, source_customer_name: order.source_customer_name, customer_id: nativeCustomer?.id ?? null, food_connex_customer_id: input.foodConnexCustomerId?.trim() || nativeCustomer?.customer_code || null, food_connex_customer_name: input.foodConnexCustomerName?.trim() || nativeCustomer?.name || null }).select('id').single();
    if (result.error) throw result.error; mapping = result.data;
  } else if (nativeCustomer) {
    const { error: nativeLinkError } = await supabase.from('integration_customer_mappings').update({ customer_id: nativeCustomer.id }).eq('id', mapping.id).eq('organization_id', profile.organizationId);
    if (nativeLinkError) throw nativeLinkError;
  }
  const { error: updateError } = await supabase.from('sps_staged_orders').update({ customer_mapping_id: mapping.id }).eq('id', order.id).eq('organization_id', profile.organizationId);
  if (updateError) throw updateError;
  return resolveAndRecalculate(supabase, profile, exception, 'map_customer');
}

export async function mapShipToException(id: string, input: { shipToId?: string; foodConnexShipToId?: string; foodConnexShipToName?: string }) {
  const { supabase, profile, exception, order } = await contextFor(id, 'SHIP_TO_UNMAPPED');
  const nativeShipTo = await nativeShipToFor(supabase, profile.organizationId, input.shipToId);
  if (!nativeShipTo) { required(input.foodConnexShipToId, 'Legacy ship-to ID'); required(input.foodConnexShipToName, 'Legacy ship-to name'); }
  if (!order.source_ship_to_code) throw new Error('The staged order has no source ship-to location code.');
  if (nativeShipTo && order.customer_mapping_id) {
    const { data: customerMapping, error: customerMappingError } = await supabase.from('integration_customer_mappings').select('customer_id').eq('id', order.customer_mapping_id).eq('organization_id', profile.organizationId).maybeSingle();
    if (customerMappingError) throw customerMappingError;
    if (customerMapping?.customer_id) {
      const { data: shipToCustomer, error: shipToCustomerError } = await supabase.from('customer_ship_tos').select('customer_id').eq('id', nativeShipTo.id).eq('organization_id', profile.organizationId).maybeSingle();
      if (shipToCustomerError) throw shipToCustomerError;
      if (!shipToCustomer || shipToCustomer.customer_id !== customerMapping.customer_id) throw new Error('The selected Lucid Ship-To does not belong to the confirmed Lucid Customer.');
    }
  }
  let { data: mapping, error } = await supabase.from('integration_ship_to_mappings').select('id')
    .eq('organization_id', profile.organizationId).eq('source_system', 'sps').eq('source_trading_partner_id', order.trading_partner_id).eq('source_location_code', order.source_ship_to_code).maybeSingle();
  if (error) throw error;
  if (!mapping) {
    const result = await supabase.from('integration_ship_to_mappings').insert({ organization_id: profile.organizationId, source_system: 'sps', source_trading_partner_id: order.trading_partner_id, source_location_code: order.source_ship_to_code, source_ship_to_name: order.source_ship_to_name, ship_to_id: nativeShipTo?.id ?? null, food_connex_ship_to_id: input.foodConnexShipToId?.trim() || nativeShipTo?.location_code || null, food_connex_ship_to_name: input.foodConnexShipToName?.trim() || nativeShipTo?.name || null }).select('id').single();
    if (result.error) throw result.error; mapping = result.data;
  } else if (nativeShipTo) {
    const { error: nativeLinkError } = await supabase.from('integration_ship_to_mappings').update({ ship_to_id: nativeShipTo.id }).eq('id', mapping.id).eq('organization_id', profile.organizationId);
    if (nativeLinkError) throw nativeLinkError;
  }
  const { error: updateError } = await supabase.from('sps_staged_orders').update({ ship_to_mapping_id: mapping.id }).eq('id', order.id).eq('organization_id', profile.organizationId);
  if (updateError) throw updateError;
  return resolveAndRecalculate(supabase, profile, exception, 'map_ship_to');
}

export async function mapItemException(id: string, input: { itemId?: string; customerItemId?: string; foodConnexItemId?: string; foodConnexItemNumber?: string; foodConnexUom?: string; approvedCircleRPrice?: number }) {
  const { supabase, profile, exception } = await contextFor(id, 'ITEM_UNMAPPED');
  if (!exception.staged_order_line_id) throw new Error('ITEM_UNMAPPED must reference a staged line.');
  const nativeItem = await nativeItemFor(supabase, profile.organizationId, input.itemId);
  const nativeCustomerItem = await nativeCustomerItemFor(supabase, profile.organizationId, input.customerItemId, nativeItem?.id);
  if (!nativeItem) required(input.foodConnexItemNumber, 'Legacy item number');
  const { data: line, error: lineError } = await supabase.from('sps_staged_order_lines').select('*').eq('id', exception.staged_order_line_id).eq('organization_id', profile.organizationId).maybeSingle();
  if (lineError) throw lineError; if (!line) throw new Error('Staged line was not found.');
  if (!line.buyer_part_number && !line.vendor_item && !line.gtin) throw new Error('A source buyer part number, vendor item, or GTIN is required.');
  const { data: order, error: orderError } = await supabase.from('sps_staged_orders').select('trading_partner_id, customer_mapping_id').eq('id', line.staged_order_id).eq('organization_id', profile.organizationId).maybeSingle();
  if (orderError) throw orderError; if (!order?.trading_partner_id) throw new Error('Staged order trading partner is required.');
  if (nativeCustomerItem && order.customer_mapping_id) {
    const { data: customerMapping, error: customerMappingError } = await supabase
      .from('integration_customer_mappings')
      .select('customer_id')
      .eq('id', order.customer_mapping_id)
      .eq('organization_id', profile.organizationId)
      .maybeSingle();
    if (customerMappingError) throw customerMappingError;
    if (customerMapping?.customer_id && nativeCustomerItem.customer_id !== customerMapping.customer_id) {
      throw new Error('The selected Customer Item does not belong to the confirmed Lucid Customer.');
    }
  }
  const { data: mapping, error: mappingError } = await supabase.from('integration_item_mappings').insert({ organization_id: profile.organizationId, source_system: 'sps', source_trading_partner_id: order.trading_partner_id, buyer_part_number: line.buyer_part_number, vendor_item: line.vendor_item, gtin: line.gtin, item_id: nativeItem?.id ?? null, customer_item_id: nativeCustomerItem?.id ?? null, food_connex_item_id: input.foodConnexItemId?.trim() || nativeItem?.id || null, food_connex_item_number: input.foodConnexItemNumber?.trim() || nativeItem?.item_code || '', sps_uom: line.sps_uom, food_connex_uom: input.foodConnexUom?.trim() || nativeItem?.stock_uom || nativeItem?.sell_uom || null, approved_price: input.approvedCircleRPrice ?? null }).select('id').single();
  if (mappingError) throw mappingError;
  const priceStatus = input.approvedCircleRPrice == null ? 'unknown' : input.approvedCircleRPrice === line.sps_purchase_price ? 'match' : 'mismatch';
  const resolvedUom = input.foodConnexUom?.trim() || nativeItem?.stock_uom || nativeItem?.sell_uom || null;
  const uomStatus = !resolvedUom ? 'unknown' : resolvedUom === line.sps_uom ? 'match' : 'mismatch';
  const { error: updateError } = await supabase.from('sps_staged_order_lines').update({ item_mapping_id: mapping.id, mapped_food_connex_item_id: input.foodConnexItemId?.trim() || nativeItem?.id || null, mapped_food_connex_item_number: input.foodConnexItemNumber?.trim() || nativeItem?.item_code || '', food_connex_uom: resolvedUom, approved_circle_r_price: input.approvedCircleRPrice ?? null, item_mapping_status: 'mapped', price_status: priceStatus, uom_status: uomStatus }).eq('id', line.id).eq('organization_id', profile.organizationId);
  if (updateError) throw updateError;
  if (priceStatus === 'mismatch') {
    const { error } = await supabase.from('sps_order_exceptions').insert({ organization_id: profile.organizationId, staged_order_id: line.staged_order_id, staged_order_line_id: line.id, exception_code: 'PRICE_MISMATCH', severity: 'warning', field_name: 'price', message: 'SPS purchase price differs from the approved Circle R price.', suggested_actions: ['Use SPS price', 'Use Approved Circle R Price', 'Needs leadership review'], status: 'open' });
    if (error) throw error;
  }
  return resolveAndRecalculate(supabase, profile, exception, 'map_item');
}

async function contextFor(id: string, expectedCode: string) {
  const supabase = await createClient(); const profile = await activeProfile(supabase);
  if (!mappingRoles.has(profile.role)) throw new Error('Your role cannot create master mappings.');
  const { data: exception, error } = await supabase.from('sps_order_exceptions').select('id, staged_order_id, staged_order_line_id, exception_code, status').eq('id', id).eq('organization_id', profile.organizationId).maybeSingle();
  if (error) throw error; if (!exception || exception.exception_code !== expectedCode || exception.status !== 'open') throw new Error('Matching open staged SPS exception was not found.');
  const { data: order, error: orderError } = await supabase.from('sps_staged_orders').select('*').eq('id', exception.staged_order_id).eq('organization_id', profile.organizationId).maybeSingle();
  if (orderError) throw orderError; if (!order) throw new Error('Staged order was not found.');
  return { supabase, profile, exception, order };
}
async function resolveAndRecalculate(supabase: Supabase, profile: Profile, exception: any, action: string) {
  const { error } = await supabase.from('sps_order_exceptions').update({ status: 'resolved', resolution_action: action, resolved_by: profile.id, resolved_at: new Date().toISOString() }).eq('id', exception.id).eq('organization_id', profile.organizationId);
  if (error) throw error;
  return { exceptionStatus: 'resolved', resolutionAction: action, ...(await recalculateStagedOrderStatus(supabase, exception.staged_order_id, profile.organizationId)) };
}
async function activeProfile(supabase: Supabase): Promise<Profile> {
  const { data: { user } } = await supabase.auth.getUser(); if (!user) throw new SpsResolutionAuthError('An authenticated Lucid Core session is required.');
  const { data, error } = await supabase.from('profiles').select('organization_id, active, role').eq('id', user.id).maybeSingle();
  if (error || !data?.active) throw new SpsResolutionAuthError('An active Lucid Core profile is required.');
  return { id: user.id, organizationId: data.organization_id, role: data.role };
}
function required(value: string | undefined, label: string) { if (!value?.trim()) throw new Error(`${label} is required.`); }

async function nativeCustomerFor(supabase: Supabase, organizationId: string, id?: string) {
  if (!id?.trim()) return null;
  const { data, error } = await supabase.from('customers').select('id, customer_code, name').eq('id', id).eq('organization_id', organizationId).eq('status', 'active').maybeSingle();
  if (error) throw error; if (!data) throw new Error('The selected Lucid Customer is not active in your organization.');
  return data;
}
async function nativeShipToFor(supabase: Supabase, organizationId: string, id?: string) {
  if (!id?.trim()) return null;
  const { data, error } = await supabase.from('customer_ship_tos').select('id, location_code, name').eq('id', id).eq('organization_id', organizationId).eq('status', 'active').maybeSingle();
  if (error) throw error; if (!data) throw new Error('The selected Lucid Ship-To is not active in your organization.');
  return data;
}
async function nativeItemFor(supabase: Supabase, organizationId: string, id?: string) {
  if (!id?.trim()) return null;
  const { data, error } = await supabase.from('items').select('id, item_code, stock_uom, sell_uom').eq('id', id).eq('organization_id', organizationId).eq('status', 'active').maybeSingle();
  if (error) throw error; if (!data) throw new Error('The selected Lucid Item is not active in your organization.');
  return data;
}
async function nativeCustomerItemFor(supabase: Supabase, organizationId: string, id?: string, itemId?: string) {
  if (!id?.trim()) return null;
  const { data, error } = await supabase.from('customer_items').select('id, customer_id, item_id').eq('id', id).eq('organization_id', organizationId).eq('status', 'active').maybeSingle();
  if (error) throw error; if (!data || (itemId && data.item_id !== itemId)) throw new Error('The selected Customer Item does not match the Lucid Item.');
  return data;
}
