import { NextResponse } from 'next/server';

import { createLucidProductionCaseFromWeightReading, createOrGetLucidProductionLot, LucidProductionAuthError } from '@/lib/integrations/lucid-production';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { orderLineId?: unknown; caseIdentifier?: unknown; quantity?: unknown; netWeight?: unknown; lotCode?: unknown; operationKey?: unknown };
    const orderLineId = typeof body.orderLineId === 'string' ? body.orderLineId : '';
    const caseIdentifier = typeof body.caseIdentifier === 'string' ? body.caseIdentifier : '';
    const quantity = typeof body.quantity === 'number' ? body.quantity : Number(body.quantity);
    const netWeight = body.netWeight === '' || body.netWeight == null ? null : Number(body.netWeight);
    const lotCode = typeof body.lotCode === 'string' ? body.lotCode.trim() : '';
    const operationKey = typeof body.operationKey === 'string' ? body.operationKey.trim() : '';
    if (!id || !orderLineId) return NextResponse.json({ success: false, error: 'A production item is required.' }, { status: 400 });
    if (!lotCode) return NextResponse.json({ success: false, error: 'A production lot or Prod Code is required.' }, { status: 400 });
    if (!operationKey) return NextResponse.json({ success: false, error: 'Capture a fresh weight before creating a case.' }, { status: 400 });
    const lot = await createOrGetLucidProductionLot(id, orderLineId, lotCode);
    if (!lot?.production_lot_id) throw new Error('The production lot could not be saved.');
    if (netWeight == null) return NextResponse.json({ success: false, error: 'A net weight greater than zero is required.' }, { status: 400 });
    const productionCase = await createLucidProductionCaseFromWeightReading(id, orderLineId, caseIdentifier, quantity, netWeight, lot.production_lot_id, operationKey);
    const response = {
      success: true,
      ...productionCase,
      production_lot_id: lot.production_lot_id,
      lot_code: lot.lot_code,
    };
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to record the production case.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof LucidProductionAuthError ? 401 : 400 });
  }
}
