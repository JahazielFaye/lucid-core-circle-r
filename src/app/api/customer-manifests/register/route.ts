import { NextResponse } from 'next/server';
import { CustomerManifestRegistryAuthError, registerCustomerReviewManifest } from '@/lib/integrations/customer-manifest-registry';
import { previewHistoricalImport } from '@/lib/integrations/historical-import';
import { validateCustomerManifest } from '@/lib/integrations/customer-review-manifest';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json() as { manifest?: unknown; sourceReference?: string; rows?: unknown; relatedRecords?: unknown };
    if (!Array.isArray(body.rows) || !body.sourceReference?.trim()) throw new Error('The original source rows and reference are required to register a manifest.');
    const expected = await previewHistoricalImport({ entity: 'customers', mode: 'current', sourceReference: body.sourceReference, rows: body.rows as Record<string, string|number|boolean|null>[], relatedRecords: body.relatedRecords });
    const submitted = validateCustomerManifest(body.manifest);
    if (!expected.manifest || expected.manifest.integrity.artifact_hash !== submitted.integrity.artifact_hash || expected.manifest.manifest_id !== submitted.manifest_id) {
      throw new Error('The submitted manifest no longer matches a fresh server-generated review. Build a new review before registering it.');
    }
    return NextResponse.json({ success: true, data: await registerCustomerReviewManifest(submitted) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to register the review manifest.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof CustomerManifestRegistryAuthError ? 403 : 400 });
  }
}
