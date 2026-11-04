import { NextResponse } from 'next/server';

import {
  getSpsSandboxAccessToken,
  getSpsTokenMetadata,
} from '@/lib/integrations/sps-auth';
import { requireActiveLucidRouteUser, RouteAuthorizationError } from '@/lib/security/route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Temporary sandbox diagnostic endpoint. It deliberately returns no credentials,
 * tokens, authorization headers, or raw SPS response bodies.
 */
export async function GET() {
  try {
    await requireActiveLucidRouteUser(['lucid_admin']);
    const token = await getSpsSandboxAccessToken();
    const metadata = getSpsTokenMetadata(token);

    return NextResponse.json({
      success: true,
      status: metadata.responseStatus,
      tokenReceived: true,
      expires_in: metadata.expiresIn,
      expires_at: metadata.expiresAt.toISOString(),
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'SPS sandbox authentication could not be completed.';

    return NextResponse.json(
      {
        success: false,
        error: message,
      },
      { status: error instanceof RouteAuthorizationError ? error.status : message.includes('configuration') ? 500 : 502 },
    );
  }
}
