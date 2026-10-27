import { NextResponse } from 'next/server';

import { resolveSpsException, SpsResolutionAuthError } from '@/lib/integrations/sps-exception-resolution';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const body: unknown = await request.json();
    const resolutionAction = typeof (body as { resolutionAction?: unknown })?.resolutionAction === 'string'
      ? (body as { resolutionAction: string }).resolutionAction
      : '';
    const result = await resolveSpsException(id, resolutionAction);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authError = error instanceof SpsResolutionAuthError;
    const message = error instanceof Error ? error.message : 'Unable to resolve the staged SPS exception.';
    return NextResponse.json({ success: false, error: message }, { status: authError ? 401 : 400 });
  }
}
