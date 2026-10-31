import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

const QA = {
  customerCode: 'QA-CUSTOMER-WORK-001',
  customerName: 'QA Test Customer',
  shipToCode: 'QA-SHIP-TO-WORK-001',
  shipToName: 'QA Test Ship-To',
  itemCode: 'QA-ITEM-WORK-001',
  itemDescription: 'QA Validation Item',
  customerSku: 'QA-SKU-WORK-001',
  uom: 'CS',
} as const;

function requiredQaReference(value: unknown) {
  if (typeof value !== 'string' || !value.trim().toUpperCase().startsWith('QA-')) {
    throw new Error('QA Order / PO must begin with QA-.');
  }
  return value.trim();
}

function requiredQuantity(value: unknown) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantity must be greater than zero.');
  return quantity;
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('An authenticated Lucid Core session is required.');

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('id, organization_id, active, role')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError || !profile?.active || profile.role !== 'lucid_admin') {
      return NextResponse.json({ success: false, error: 'Only Lucid Admin can create controlled QA orders.' }, { status: 403 });
    }

    const [customerResult, shipToResult, itemResult] = await Promise.all([
      supabase.from('customers').select('id').eq('organization_id', profile.organization_id).eq('customer_code', QA.customerCode).eq('name', QA.customerName).eq('status', 'active').eq('source_system', 'lucid_qa').eq('source_record_id', QA.customerCode).eq('is_historical', false).maybeSingle(),
      supabase.from('customer_ship_tos').select('id, customer_id').eq('organization_id', profile.organization_id).eq('location_code', QA.shipToCode).eq('name', QA.shipToName).eq('status', 'active').eq('source_system', 'lucid_qa').eq('source_record_id', QA.shipToCode).eq('is_historical', false).maybeSingle(),
      supabase.from('items').select('id').eq('organization_id', profile.organization_id).eq('item_code', QA.itemCode).eq('description', QA.itemDescription).eq('status', 'active').eq('source_system', 'lucid_qa').eq('source_record_id', QA.itemCode).eq('is_historical', false).maybeSingle(),
    ]);

    if (customerResult.error || shipToResult.error || itemResult.error || !customerResult.data || !shipToResult.data || !itemResult.data || shipToResult.data.customer_id !== customerResult.data.id) {
      throw new Error('Prepare QA Test Data first.');
    }

    const { data: customerItem, error: customerItemError } = await supabase
      .from('customer_items')
      .select('id')
      .eq('organization_id', profile.organization_id)
      .eq('customer_id', customerResult.data.id)
      .eq('ship_to_id', shipToResult.data.id)
      .eq('item_id', itemResult.data.id)
      .eq('customer_sku', QA.customerSku)
      .eq('status', 'active')
      .eq('source_system', 'lucid_qa')
      .eq('source_record_id', 'QA-CUSTOMER-ITEM-WORK-001')
      .eq('is_historical', false)
      .maybeSingle();

    if (customerItemError || !customerItem) throw new Error('Prepare QA Test Data first.');

    const qaReference = requiredQaReference(body.qaReference);
    const quantity = requiredQuantity(body.quantity);
    const requestedUom = typeof body.uom === 'string' ? body.uom.trim().toUpperCase() : QA.uom;
    if (requestedUom !== QA.uom) throw new Error('Controlled QA orders use the prepared QA item UOM: CS.');

    const { data, error } = await supabase.rpc('create_lucid_qa_order', {
      p_qa_reference: qaReference,
      p_customer: QA.customerName,
      p_ship_to: QA.shipToName,
      p_item_code: QA.itemCode,
      p_description: QA.itemDescription,
      p_quantity_cases: quantity,
      p_uom: QA.uom,
    });
    if (error) throw new Error(error.message);

    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to create controlled QA order.' }, { status: 400 });
  }
}
