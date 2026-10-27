import { NextResponse } from 'next/server';
import { OperationalWorkflowAuthError, runOperationalWorkflow } from '@/lib/integrations/lucid-operational-workflows';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ action: string }> }) {
  try {
    const { action } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    return NextResponse.json({ success: true, data: await runOperationalWorkflow(action, body) });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to complete the operational workflow.';
    return NextResponse.json({ success: false, error: message }, { status: error instanceof OperationalWorkflowAuthError ? 403 : 400 });
  }
}
