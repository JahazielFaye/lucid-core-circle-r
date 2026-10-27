import { NextResponse } from 'next/server';

import { listFoodConnexCustomers } from '@/lib/integrations/food-connex-read';
import { FoodConnexRouteAuthError, requireActiveFoodConnexUser } from '@/lib/integrations/food-connex-route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireActiveFoodConnexUser();
    const q = new URL(request.url).searchParams.get('q')?.trim() || undefined;
    const result = await listFoodConnexCustomers(q);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authError = error instanceof FoodConnexRouteAuthError;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to retrieve Food Connex customers.' }, { status: authError ? 401 : 502 });
  }
}
