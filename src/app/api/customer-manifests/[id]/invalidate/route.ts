import { NextResponse } from 'next/server';
import { CustomerManifestRegistryAuthError, invalidateCustomerReviewManifest } from '@/lib/integrations/customer-manifest-registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { reason?: unknown };
    if (typeof body.reason !== 'string' || !body.reason.trim()) throw new Error('An invalidation reason is required.');
    return NextResponse.json({ success: true, data: await invalidateCustomerReviewManifest({ registryId: id, reason: body.reason }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to invalidate the review manifest.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof CustomerManifestRegistryAuthError ? 403 : 400 });
  }
}
