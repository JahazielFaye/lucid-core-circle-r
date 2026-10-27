import { NextResponse } from 'next/server';

import { mapSpsPurchaseOrderToCircleR } from '@/lib/integrations/circle-r-po-mapper';
import { circleRVerifiedPurchaseOrderFixture } from '@/lib/integrations/circle-r-sps-fixture';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Runs manually verified Circle R fixture data; it makes no external calls. */
export async function GET() {
  const candidate = mapSpsPurchaseOrderToCircleR(
    circleRVerifiedPurchaseOrderFixture,
  );

  return NextResponse.json({
    success: true,
    fixture: 'manually_verified_circle_r_business_test_data',
    candidate,
  });
}
