import { NextResponse } from 'next/server';

import { diagnoseFoodConnexAuthentication } from '@/lib/integrations/food-connex-auth-diagnostic';
import { FoodConnexRouteAuthError, requireActiveFoodConnexUser } from '@/lib/integrations/food-connex-route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  try {
    await requireActiveFoodConnexUser();
    return NextResponse.json(await diagnoseFoodConnexAuthentication());
  } catch (error) {
    const isAuthError = error instanceof FoodConnexRouteAuthError;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to run Food Connex authentication diagnostic.' }, { status: isAuthError ? 401 : 502 });
  }
}
