import { NextResponse } from 'next/server';

import { persistCircleRFixture, StagingAuthError } from '@/lib/integrations/circle-r-sps-staging';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    const result = await persistCircleRFixture();
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const isAuthError = error instanceof StagingAuthError;
    return NextResponse.json(
      { success: false, error: isAuthError ? error.message : 'Unable to stage the Circle R fixture.' },
      { status: isAuthError ? 401 : 500 },
    );
  }
}
