import { NextResponse } from 'next/server';

import { mapSpsPurchaseOrderToCircleR } from '@/lib/integrations/circle-r-po-mapper';
import { circleRVerifiedPurchaseOrderFixture } from '@/lib/integrations/circle-r-sps-fixture';
import { requireActiveLucidRouteUser, RouteAuthorizationError } from '@/lib/security/route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Runs manually verified Circle R fixture data; it makes no external calls. */
export async function GET() {
  try {
    await requireActiveLucidRouteUser(['lucid_admin']);
    const candidate = mapSpsPurchaseOrderToCircleR(circleRVerifiedPurchaseOrderFixture);
    return NextResponse.json({ success: true, fixture: 'manually_verified_circle_r_business_test_data', candidate });
  } catch (error) {
    const status = error instanceof RouteAuthorizationError ? error.status : 500;
    return NextResponse.json({ success: false, error: status === 500 ? 'Unable to run the SPS mapping diagnostic.' : (error instanceof Error ? error.message : 'Authorization failed.') }, { status });
  }
}
