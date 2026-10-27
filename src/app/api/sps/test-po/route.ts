import { NextResponse } from 'next/server';

import {
  getSpsSandboxPurchaseOrderSample,
  SpsTransactionApiError,
} from '@/lib/integrations/sps-transactions';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Temporary read-only Sandbox PO diagnostic. It intentionally excludes SPS
 * credentials, tokens, authorization headers, and raw request metadata.
 */
export async function GET() {
  try {
    const transaction = await getSpsSandboxPurchaseOrderSample();

    return NextResponse.json({
      success: true,
      status: transaction.status,
      contentType: transaction.contentType,
      byteLength: transaction.byteLength,
      characterLength: transaction.characterLength,
      payload: transaction.payload,
    });
  } catch (error) {
    const transactionError =
      error instanceof SpsTransactionApiError ? error : undefined;
    const message =
      transactionError?.message ??
      (error instanceof Error
        ? error.message
        : 'SPS PO diagnostic could not be completed.');

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
