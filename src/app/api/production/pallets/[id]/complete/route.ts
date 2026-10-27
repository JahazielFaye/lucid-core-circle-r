import { NextResponse } from 'next/server';

import { completeLucidPallet, LucidProductionAuthError } from '@/lib/integrations/lucid-production';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    if (!id) return NextResponse.json({ success: false, error: 'A pallet is required.' }, { status: 400 });
    return NextResponse.json({ success: true, ...(await completeLucidPallet(id)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to complete the pallet.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof LucidProductionAuthError ? 401 : 400 });
  }
}
