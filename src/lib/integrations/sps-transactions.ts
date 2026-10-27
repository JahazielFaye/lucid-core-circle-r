import 'server-only';

import { getSpsSandboxAccessToken } from './sps-auth';

const SPS_TRANSACTIONS_ENDPOINT =
  'https://api.spscommerce.com/transactions/v5/data/';
const SPS_INBOUND_TRANSACTIONS_ENDPOINT =
  'https://api.spscommerce.com/transactions/v5/data/in/';
const SPS_OUTBOUND_TRANSACTIONS_ENDPOINT =
  'https://api.spscommerce.com/transactions/v5/data/out/';
const SPS_OUTBOUND_PO_TRANSACTIONS_ENDPOINT =
  'https://api.spscommerce.com/transactions/v5/data/out/PO/';
const MAX_DIAGNOSTIC_PAYLOAD_BYTES = 250 * 1024;

export type SpsTransactionEntry = {
  path: string;
  type: string;
  url: string;
};

export type SpsTransactionList = {
  status: number;
  results: SpsTransactionEntry[];
  paging?: Record<string, string | number | boolean | null>;
};

export type SpsTransactionPayload = {
  sourcePath: string;
  status: number;
  contentType: string | null;
  payload: string;
  byteLength: number;
  characterLength: number;
};

/** Normalizes SPS directory paths without decoding or otherwise rewriting them. */
export function normalizeSpsSandboxPoPath(sourcePath: string): string {
  const normalizedPath = sourcePath.replace(/^\/+/, '');
  if (!normalizedPath.startsWith('out/PO/') || normalizedPath.includes('..')) {
    throw new SpsTransactionApiError('Invalid SPS Sandbox PO source path.');
  }

  return normalizedPath;
}

export class SpsTransactionApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

/**
 * Lists SPS Transaction API root entries. This is intentionally read-only and
 * has no request body or transaction mutation behavior.
 */
export async function listSpsSandboxTransactionEntries(): Promise<SpsTransactionList> {
  return listSpsSandboxDirectory(SPS_TRANSACTIONS_ENDPOINT);
}

/**
 * Lists only the inbound SPS Transaction API directory. This is read-only and
 * does not download, acknowledge, move, or modify returned transactions.
 */
export async function listSpsSandboxInboundTransactionEntries(): Promise<SpsTransactionList> {
  return listSpsSandboxDirectory(SPS_INBOUND_TRANSACTIONS_ENDPOINT);
}

/**
 * Lists only the outbound SPS Transaction API directory. This is read-only and
 * does not download, acknowledge, move, or modify returned transactions.
 */
export async function listSpsSandboxOutboundTransactionEntries(): Promise<SpsTransactionList> {
  return listSpsSandboxDirectory(SPS_OUTBOUND_TRANSACTIONS_ENDPOINT);
}

/**
 * Lists only the outbound PO directory. This is read-only and does not
 * download, acknowledge, move, rename, or modify returned transactions.
 */
export async function listSpsSandboxOutboundPoTransactionEntries(): Promise<SpsTransactionList> {
  return listSpsSandboxDirectory(SPS_OUTBOUND_PO_TRANSACTIONS_ENDPOINT);
}

/**
 * Retrieves the known SPS Sandbox PO sample for temporary diagnostics only.
 * The GET is read-only and the body is bounded to prevent an unexpected dump.
 */
export async function getSpsSandboxPurchaseOrderSample(): Promise<SpsTransactionPayload> {
  return getSpsSandboxTransactionText('out/PO/PO584615-1-v7.7-BulkImport.xml');
}

/** Retrieves a discovered Sandbox PO file with a read-only GET request. */
export async function getSpsSandboxTransactionText(
  sourcePath: string,
): Promise<SpsTransactionPayload> {
  const normalizedPath = normalizeSpsSandboxPoPath(sourcePath);
  const { accessToken } = await getSpsSandboxAccessToken();
  let response: Response;

  try {
    response = await fetch(
      `https://api.spscommerce.com/transactions/v5/data/${normalizedPath}`,
      {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
      },
    );
  } catch {
    throw new SpsTransactionApiError(
      'Unable to reach the SPS sandbox Transaction API.',
    );
  }

  if (!response.ok) {
    throw new SpsTransactionApiError(
      `SPS Transaction API request failed (HTTP ${response.status}).`,
      response.status,
    );
  }

  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_DIAGNOSTIC_PAYLOAD_BYTES) {
    throw new SpsTransactionApiError(
      'SPS transaction payload exceeds the diagnostic size limit.',
      response.status,
    );
  }

  const payload = await readTextWithinLimit(response, MAX_DIAGNOSTIC_PAYLOAD_BYTES);
  const byteLength = new TextEncoder().encode(payload).byteLength;

  return {
    sourcePath: normalizedPath,
    status: response.status,
    contentType: response.headers.get('content-type'),
    payload,
    byteLength,
    characterLength: payload.length,
  };
}

async function listSpsSandboxDirectory(
  endpoint: string,
): Promise<SpsTransactionList> {
  const { accessToken } = await getSpsSandboxAccessToken();
  let response: Response;

  try {
    response = await fetch(endpoint, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: 'no-store',
    });
  } catch {
    throw new SpsTransactionApiError(
      'Unable to reach the SPS sandbox Transaction API.',
    );
  }

  if (!response.ok) {
    throw new SpsTransactionApiError(
      `SPS Transaction API request failed (HTTP ${response.status}).`,
      response.status,
    );
  }

  const body: unknown = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw new SpsTransactionApiError(
      'SPS Transaction API returned an invalid response.',
      response.status,
    );
  }

  const payload = body as Record<string, unknown>;
  return {
    status: response.status,
    results: parseEntries(payload.results),
    paging: parsePaging(payload.paging),
  };
}

async function readTextWithinLimit(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    throw new SpsTransactionApiError(
      'SPS Transaction API returned an empty response body.',
      response.status,
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let receivedBytes = 0;
  let text = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      receivedBytes += value.byteLength;
      if (receivedBytes > maxBytes) {
        await reader.cancel();
        throw new SpsTransactionApiError(
          'SPS transaction payload exceeds the diagnostic size limit.',
          response.status,
        );
      }

      text += decoder.decode(value, { stream: true });
    }

    return text + decoder.decode();
  } catch (error) {
    if (error instanceof SpsTransactionApiError) {
      throw error;
    }

    throw new SpsTransactionApiError(
      'Unable to read the SPS transaction payload.',
      response.status,
    );
  } finally {
    reader.releaseLock();
  }
}

function parseEntries(value: unknown): SpsTransactionEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') {
      return [];
    }

    const item = entry as Record<string, unknown>;
    if (
      typeof item.path !== 'string' ||
      typeof item.type !== 'string' ||
      typeof item.url !== 'string'
    ) {
      return [];
    }

    return [{ path: item.path, type: item.type, url: item.url }];
  });
}

function parsePaging(
  value: unknown,
): Record<string, string | number | boolean | null> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  const paging = Object.entries(value as Record<string, unknown>).flatMap(
    ([key, item]) =>
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      item === null
        ? [[key, item] as const]
        : [],
  );

  return Object.fromEntries(paging);
}
