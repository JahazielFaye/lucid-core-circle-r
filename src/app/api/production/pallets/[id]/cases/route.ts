import { NextResponse } from 'next/server';

import { addLucidCaseToPallet, LucidProductionAuthError } from '@/lib/integrations/lucid-production';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { caseIdentifier?: unknown };
    const caseIdentifier = typeof body.caseIdentifier === 'string' ? body.caseIdentifier : '';
    if (!id) return NextResponse.json({ success: false, error: 'A pallet is required.' }, { status: 400 });
    return NextResponse.json({ success: true, ...(await addLucidCaseToPallet(id, caseIdentifier)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to add the case to this pallet.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof LucidProductionAuthError ? 401 : 400 });
  }
}
