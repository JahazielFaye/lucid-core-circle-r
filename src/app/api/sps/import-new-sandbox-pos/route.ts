import { NextResponse } from 'next/server';

import { importNewSandboxPurchaseOrders, StagingPipelineError } from '@/lib/integrations/circle-r-sps-staging';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json({ success: true, ...(await importNewSandboxPurchaseOrders()) });
  } catch (error) {
    const failure = error instanceof StagingPipelineError ? error : null;
    return NextResponse.json(
      { success: false, ...(failure ? { stage: failure.stage } : {}), error: 'Unable to discover SPS Sandbox POs.' },
      { status: failure?.stage === 'auth' || failure?.stage === 'profile' ? 401 : 500 },
    );
  }
}
