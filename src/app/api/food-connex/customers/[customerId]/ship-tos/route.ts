import { NextResponse } from 'next/server';

import { listFoodConnexShipTos } from '@/lib/integrations/food-connex-read';
import { FoodConnexRouteAuthError, requireActiveFoodConnexUser } from '@/lib/integrations/food-connex-route-auth';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ customerId: string }> }) {
  try {
    await requireActiveFoodConnexUser();
    const { customerId } = await context.params;
    if (!customerId) return NextResponse.json({ success: false, error: 'A customer ID is required.' }, { status: 400 });
    const result = await listFoodConnexShipTos(customerId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authError = error instanceof FoodConnexRouteAuthError;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Unable to retrieve Food Connex ship-to records.' }, { status: authError ? 401 : 502 });
  }
}
