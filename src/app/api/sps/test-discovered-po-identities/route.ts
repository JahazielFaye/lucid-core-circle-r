import { NextResponse } from 'next/server';

import { inspectDiscoveredSandboxPurchaseOrderIdentities, StagingAuthError } from '@/lib/integrations/circle-r-sps-staging';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    return NextResponse.json({ success: true, ...(await inspectDiscoveredSandboxPurchaseOrderIdentities()) });
  } catch (error) {
    const authError = error instanceof StagingAuthError;
    return NextResponse.json({ success: false, error: authError ? error.message : 'Unable to inspect SPS Sandbox PO identities.' }, { status: authError ? 401 : 500 });
  }
}
