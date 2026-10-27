import 'server-only';

import { getFoodConnexAccessToken, getFoodConnexApiBaseUrl } from './food-connex-auth';

export class FoodConnexReadError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export type FoodConnexCustomer = { id: string; code?: string; name?: string; status?: string };
export type FoodConnexShipTo = { id: string; customerId?: string; locationCode?: string; name?: string; addressSummary?: string };
export type FoodConnexItem = { id: string; itemNumber?: string; description?: string; uom?: string; gtinOrUpc?: string; status?: string };
export type FoodConnexReadResult<T> = { records: T[]; structuralDiagnostic?: { rootType: string; rootKeys?: string[]; collectionKey?: string; recordKeys?: string[] } };

async function getFoodConnexJson(path: string, params?: Record<string, string | undefined>) {
  const token = await getFoodConnexAccessToken();
  const url = new URL(`${getFoodConnexApiBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(params || {})) if (value) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json', Authorization: `Bearer ${token.token}` }, cache: 'no-store' });
  } catch {
    throw new FoodConnexReadError('Unable to reach Food Connex.', 0);
  }
  if (!response.ok) {
    const hint = response.status === 401 || response.status === 403 ? ' Food Connex API entitlement may need to be enabled for Circle R.' : '';
    throw new FoodConnexReadError(`Food Connex read request was not accepted (${response.status}).${hint}`, response.status);
  }
  return response.json().catch(() => { throw new FoodConnexReadError('Food Connex returned a non-JSON response.'); });
}

export async function listFoodConnexCustomers(query?: string): Promise<FoodConnexReadResult<FoodConnexCustomer>> {
  return normalizeCustomers(await getFoodConnexJson('/customers/', { pattern: query, maxResults: '50' }));
}

export async function listFoodConnexShipTos(customerId: string): Promise<FoodConnexReadResult<FoodConnexShipTo>> {
  return normalizeShipTos(await getFoodConnexJson(`/customers/${encodeURIComponent(customerId)}/ship-tos`));
}

export async function listFoodConnexItems(query?: string): Promise<FoodConnexReadResult<FoodConnexItem>> {
  return normalizeItems(await getFoodConnexJson('/items/', { pattern: query, maxResults: '50' }));
}

export async function listFoodConnexItemUoms(itemId: string) {
  return getFoodConnexJson(`/items/${encodeURIComponent(itemId)}/uoms`);
}

export async function listFoodConnexItemUpcs(itemId: string) {
  return getFoodConnexJson(`/items/${encodeURIComponent(itemId)}/upcs`);
}

function collection(payload: unknown) {
  if (Array.isArray(payload)) return { rows: payload, collectionKey: undefined, rootKeys: undefined };
  if (!payload || typeof payload !== 'object') return { rows: [], collectionKey: undefined, rootKeys: undefined };
  const root = payload as Record<string, unknown>;
  const collectionKey = Object.keys(root).find(key => Array.isArray(root[key]));
  return { rows: collectionKey && Array.isArray(root[collectionKey]) ? root[collectionKey] : [], collectionKey, rootKeys: Object.keys(root) };
}

function diagnostic(payload: unknown) {
  const { rows, collectionKey, rootKeys } = collection(payload);
  const first = rows[0];
  return { rootType: Array.isArray(payload) ? 'array' : payload === null ? 'null' : typeof payload, rootKeys, collectionKey, recordKeys: first && typeof first === 'object' && !Array.isArray(first) ? Object.keys(first as Record<string, unknown>) : undefined };
}

function stringField(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof row[key] === 'string' || typeof row[key] === 'number') return String(row[key]);
  return undefined;
}

function normalizeCustomers(payload: unknown): FoodConnexReadResult<FoodConnexCustomer> {
  const { rows } = collection(payload);
  const records = rows.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const id = stringField(row, ['id', 'Id', 'customerId', 'CustomerId']);
    return id ? [{ id, code: stringField(row, ['code', 'Code', 'customerCode', 'CustomerCode']), name: stringField(row, ['name', 'Name', 'customerName', 'CustomerName']), status: stringField(row, ['status', 'Status', 'active', 'Active']) }] : [];
  });
  return records.length || rows.length === 0 ? { records } : { records, structuralDiagnostic: diagnostic(payload) };
}

function normalizeShipTos(payload: unknown): FoodConnexReadResult<FoodConnexShipTo> {
  const { rows } = collection(payload);
  const records = rows.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const id = stringField(row, ['id', 'Id', 'shipToId', 'ShipToId']);
    return id ? [{ id, customerId: stringField(row, ['customerId', 'CustomerId']), locationCode: stringField(row, ['locationCode', 'LocationCode', 'code', 'Code']), name: stringField(row, ['name', 'Name']), addressSummary: stringField(row, ['addressSummary', 'AddressSummary', 'address', 'Address']) }] : [];
  });
  return records.length || rows.length === 0 ? { records } : { records, structuralDiagnostic: diagnostic(payload) };
}

function normalizeItems(payload: unknown): FoodConnexReadResult<FoodConnexItem> {
  const { rows } = collection(payload);
  const records = rows.flatMap(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const id = stringField(row, ['id', 'Id', 'itemId', 'ItemId']);
    return id ? [{ id, itemNumber: stringField(row, ['itemNumber', 'ItemNumber', 'code', 'Code']), description: stringField(row, ['description', 'Description', 'name', 'Name']), uom: stringField(row, ['uom', 'UOM']), gtinOrUpc: stringField(row, ['gtin', 'GTIN', 'upc', 'UPC']), status: stringField(row, ['status', 'Status', 'active', 'Active']) }] : [];
  });
  return records.length || rows.length === 0 ? { records } : { records, structuralDiagnostic: diagnostic(payload) };
}
