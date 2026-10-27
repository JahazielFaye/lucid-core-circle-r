import { NextResponse } from 'next/server';

import { importSandboxPurchaseOrder, StagingPipelineError } from '@/lib/integrations/circle-r-sps-staging';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json({ success: true, ...(await importSandboxPurchaseOrder()) });
  } catch (error) {
    const pipelineError = error instanceof StagingPipelineError ? error : null;
    const cause = pipelineError?.cause;
    const databaseError = cause && typeof cause === 'object' ? cause as Record<string, unknown> : null;
    const safeMessage = typeof databaseError?.message === 'string'
      ? databaseError.message
      : pipelineError?.stage === 'auth'
        ? 'An authenticated Lucid Core session is required.'
        : pipelineError?.stage === 'profile'
          ? 'An active Lucid Core profile is required.'
          : 'SPS Sandbox import failed.';
    return NextResponse.json(
      {
        success: false,
        ...(pipelineError ? { stage: pipelineError.stage } : {}),
        error: safeMessage,
        ...(typeof databaseError?.code === 'string' ? { code: databaseError.code } : {}),
        ...(typeof databaseError?.hint === 'string' ? { hint: databaseError.hint } : {}),
      },
      { status: pipelineError?.stage === 'auth' || pipelineError?.stage === 'profile' ? 401 : 500 },
    );
  }
}
