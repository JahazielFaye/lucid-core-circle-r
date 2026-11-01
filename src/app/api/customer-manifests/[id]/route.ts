import { NextResponse } from 'next/server';
import { CustomerManifestRegistryAuthError, readCustomerReviewManifestRegistry } from '@/lib/integrations/customer-manifest-registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ success: true, data: await readCustomerReviewManifestRegistry(id) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load the review manifest history.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof CustomerManifestRegistryAuthError ? 403 : 400 });
  }
}
