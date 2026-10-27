import { NextResponse } from 'next/server';

import { LucidProductionAuthError, reopenLucidPallet } from '@/lib/integrations/lucid-production';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (!id) return NextResponse.json({ success: false, error: 'A pallet is required.' }, { status: 400 });
    return NextResponse.json({ success: true, ...(await reopenLucidPallet(id, reason)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to reopen the pallet.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof LucidProductionAuthError ? 401 : 400 });
  }
}
