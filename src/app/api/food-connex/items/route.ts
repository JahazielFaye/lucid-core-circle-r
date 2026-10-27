import { NextResponse } from 'next/server';

import { listFoodConnexItems } from '@/lib/integrations/food-connex-read';
import { FoodConnexRouteAuthError, requireActiveFoodConnexUser } from '@/lib/integrations/food-connex-route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  try {
    await requireActiveFoodConnexUser();
    const q = new URL(request.url).searchParams.get('q')?.trim() || undefined;
    const result = await listFoodConnexItems(q);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authError = error instanceof FoodConnexRouteAuthError;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to retrieve Food Connex items.' }, { status: authError ? 401 : 502 });
  }
}
