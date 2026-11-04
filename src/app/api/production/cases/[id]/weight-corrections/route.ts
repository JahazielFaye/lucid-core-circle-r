import { NextResponse } from 'next/server';

import { correctLucidProductionCaseWeight, LucidProductionAuthError } from '@/lib/integrations/lucid-production';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** The RPC derives organization and role from the authenticated profile. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { netWeight?: unknown; reason?: unknown };
    const netWeight = typeof body.netWeight === 'number' ? body.netWeight : Number(body.netWeight);
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (!id) return NextResponse.json({ success: false, error: 'A production case is required.' }, { status: 400 });
    return NextResponse.json({ success: true, ...(await correctLucidProductionCaseWeight(id, netWeight, reason)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to record the weight correction.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof LucidProductionAuthError ? 401 : 400 });
  }
}
