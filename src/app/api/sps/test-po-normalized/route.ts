import { NextResponse } from 'next/server';

import { normalizeSpsPurchaseOrder } from '@/lib/integrations/sps-po-normalizer';
import {
  getSpsSandboxPurchaseOrderSample,
  SpsTransactionApiError,
} from '@/lib/integrations/sps-transactions';

const SAMPLE_SOURCE_FILE = 'out/PO/PO584615-1-v7.7-BulkImport.xml';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Temporary server-only, read-only Sandbox PO normalization diagnostic. */
export async function GET() {
  try {
    const transaction = await getSpsSandboxPurchaseOrderSample();
    const purchaseOrder = normalizeSpsPurchaseOrder(
      transaction.payload,
      SAMPLE_SOURCE_FILE,
    );

    return NextResponse.json({
      success: true,
      status: transaction.status,
      purchaseOrder,
    });
  } catch (error) {
    const transactionError =
      error instanceof SpsTransactionApiError ? error : undefined;
    const message =
      transactionError?.message ??
      (error instanceof Error
        ? error.message
        : 'SPS PO normalization diagnostic could not be completed.');

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
