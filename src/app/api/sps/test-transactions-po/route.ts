import { NextResponse } from 'next/server';

import {
  listSpsSandboxOutboundPoTransactionEntries,
  SpsTransactionApiError,
} from '@/lib/integrations/sps-transactions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Temporary read-only sandbox diagnostic for the outbound PO directory.
 * It deliberately excludes SPS tokens, credentials, and raw upstream bodies.
 */
export async function GET() {
  try {
    const transactionList = await listSpsSandboxOutboundPoTransactionEntries();

    return NextResponse.json({
      success: true,
      status: transactionList.status,
      resultCount: transactionList.results.length,
      results: transactionList.results,
      ...(transactionList.paging ? { paging: transactionList.paging } : {}),
    });
  } catch (error) {
    const transactionError =
      error instanceof SpsTransactionApiError ? error : undefined;
    const message =
      transactionError?.message ??
      (error instanceof Error
        ? error.message
        : 'SPS PO transaction diagnostic could not be completed.');

    return NextResponse.json(
      {
        success: false,
        ...(transactionError?.status
          ? { status: transactionError.status }
          : {}),
        error: message,
      },
      { status: transactionError?.status ? 502 : 500 },
    );
  }
}
