import { NextResponse } from 'next/server';

import { inspectDiscoveredSandboxPurchaseOrderIdentities, StagingAuthError } from '@/lib/integrations/circle-r-sps-staging';
import { requireActiveLucidRouteUser, RouteAuthorizationError } from '@/lib/security/route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireActiveLucidRouteUser(['lucid_admin']);
    return NextResponse.json({ success: true, ...(await inspectDiscoveredSandboxPurchaseOrderIdentities()) });
  } catch (error) {
    const authError = error instanceof StagingAuthError;
    return NextResponse.json({ success: false, error: authError || error instanceof RouteAuthorizationError ? error.message : 'Unable to inspect SPS Sandbox PO identities.' }, { status: error instanceof RouteAuthorizationError ? error.status : authError ? 401 : 500 });
  }
}
