import { NextResponse } from 'next/server';

import { LucidProductionAuthError, moveLucidCaseBetweenPallets } from '@/lib/integrations/lucid-production';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string; caseId: string }> }) {
  try {
    const { id, caseId } = await context.params;
    const body = await request.json() as { targetPalletId?: unknown; reason?: unknown };
    const targetPalletId = typeof body.targetPalletId === 'string' ? body.targetPalletId : '';
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (!id || !caseId || !targetPalletId) return NextResponse.json({ success: false, error: 'A source pallet, case, and destination pallet are required.' }, { status: 400 });
    return NextResponse.json({ success: true, ...(await moveLucidCaseBetweenPallets(caseId, targetPalletId, reason)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to move the case between pallets.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof LucidProductionAuthError ? 401 : 400 });
  }
}
