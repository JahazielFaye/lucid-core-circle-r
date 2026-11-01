import { NextResponse } from 'next/server';
import { CustomerManifestRegistryAuthError, recordCustomerReviewManifestDecision } from '@/lib/integrations/customer-manifest-registry';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body = await request.json() as { manifestId?: string; manifestVersion?: number; sourceHash?: string; planHash?: string; decision?: 'APPROVE'|'REJECT'|'NEEDS_REVIEW'; comment?: string };
    const manifestVersion = body.manifestVersion;
    if (!body.manifestId || !body.sourceHash || !body.planHash || !Number.isInteger(manifestVersion) || !body.decision) throw new Error('Exact manifest identity, hashes, version, and decision are required.');
    return NextResponse.json({ success: true, data: await recordCustomerReviewManifestDecision({ registryId: id, manifestId: body.manifestId, manifestVersion: manifestVersion as number, sourceHash: body.sourceHash, planHash: body.planHash, decision: body.decision, comment: body.comment }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to record the formal review decision.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof CustomerManifestRegistryAuthError ? 403 : 400 });
  }
}
