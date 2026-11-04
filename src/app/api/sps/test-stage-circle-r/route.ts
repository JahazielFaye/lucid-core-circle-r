import { NextResponse } from 'next/server';

import { persistCircleRFixture, StagingAuthError } from '@/lib/integrations/circle-r-sps-staging';
import { requireActiveLucidRouteUser, RouteAuthorizationError } from '@/lib/security/route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireActiveLucidRouteUser(['lucid_admin']);
    const result = await persistCircleRFixture();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const isAuthError = error instanceof StagingAuthError;
    return NextResponse.json(
      { success: false, error: isAuthError ? error.message : 'Unable to stage the Circle R fixture.' },
      { status: error instanceof RouteAuthorizationError ? error.status : isAuthError ? 401 : 500 },
    );
  }
}
