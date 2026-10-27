import { NextResponse } from 'next/server';

import { sendStagedSpsOrderToProduction, SpsOrderPromotionAuthError } from '@/lib/integrations/sps-order-promotion';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) return NextResponse.json({ success: false, error: 'An incoming order ID is required.' }, { status: 400 });
    const result = await sendStagedSpsOrderToProduction(id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authenticationError = error instanceof SpsOrderPromotionAuthError;
    const message = error instanceof Error ? error.message : 'Unable to send the incoming order to production.';
    console.error('[sps-promotion] request failed', {
      stagedOrderId: (await context.params).id || 'missing',
      kind: authenticationError ? 'authentication' : 'promotion',
      message: message.replace(/Bearer\s+\S+|token=[^\s&]+/gi, '[redacted]').slice(0, 500),
    });
    return NextResponse.json({
      success: false,
      error: message,
    }, { status: authenticationError ? 401 : 400 });
  }
}
