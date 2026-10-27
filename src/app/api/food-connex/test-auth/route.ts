import { NextResponse } from 'next/server';

import { FoodConnexAuthError, getFoodConnexAccessToken } from '@/lib/integrations/food-connex-auth';
import { FoodConnexRouteAuthError, requireActiveFoodConnexUser } from '@/lib/integrations/food-connex-route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireActiveFoodConnexUser();
    const token = await getFoodConnexAccessToken();
    return NextResponse.json({ success: true, authenticated: true, expiresAt: new Date(token.expiresAt).toISOString() });
  } catch (error) {
    const authError = error instanceof FoodConnexRouteAuthError;
    const message = error instanceof Error ? error.message : 'Unable to authenticate with Food Connex.';
    return NextResponse.json({ success: false, error: message }, { status: authError ? 401 : 502 });
  }
}
