import { NextResponse } from 'next/server';

import { LucidProductionAuthError, removeLucidCaseFromPallet } from '@/lib/integrations/lucid-production';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(_request: Request, context: { params: Promise<{ id: string; caseId: string }> }) {
  try {
    const { id, caseId } = await context.params;
    if (!id || !caseId) return NextResponse.json({ success: false, error: 'A pallet and case are required.' }, { status: 400 });
    return NextResponse.json({ success: true, ...(await removeLucidCaseFromPallet(id, caseId)) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to remove the case from this pallet.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof LucidProductionAuthError ? 401 : 400 });
  }
}
