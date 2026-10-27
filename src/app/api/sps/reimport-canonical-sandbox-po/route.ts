import { NextResponse } from 'next/server';

import { importSandboxPurchaseOrder, StagingPipelineError } from '@/lib/integrations/circle-r-sps-staging';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Re-stages only the canonical BulkImport Sandbox sample; no SPS writes occur. */
export async function GET() {
  try {
    const result = await importSandboxPurchaseOrder();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const failure = error instanceof StagingPipelineError ? error : null;
    return NextResponse.json(
      { success: false, ...(failure ? { stage: failure.stage } : {}), error: 'Unable to reimport the canonical SPS Sandbox PO.' },
      { status: failure?.stage === 'auth' || failure?.stage === 'profile' ? 401 : 500 },
    );
  }
}
