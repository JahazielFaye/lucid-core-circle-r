import 'server-only';

const TOKEN_LIFETIME_MS = 55 * 60 * 1000;

type CachedToken = { token: string; expiresAt: number };
let cachedToken: CachedToken | null = null;

export class FoodConnexAuthError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
  }
}

export function getFoodConnexConfig() {
  const baseUrl = process.env.FOOD_CONNEX_BASE_URL?.replace(/\/+$/, '');
  const clientId = process.env.FOOD_CONNEX_CLIENT_ID;
  const username = process.env.FOOD_CONNEX_USERNAME;
  const password = process.env.FOOD_CONNEX_PASSWORD;
  if (!baseUrl || !clientId || !username || !password) {
    throw new FoodConnexAuthError('Food Connex server credentials are not fully configured.');
  }
  return { baseUrl, clientId, username, password };
}

export function getFoodConnexApiBaseUrl() {
  const { baseUrl, clientId } = getFoodConnexConfig();
  return `${baseUrl}/vn/${encodeURIComponent(clientId)}/api/v1`;
}

export async function getFoodConnexAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken;
  const { username, password } = getFoodConnexConfig();
  const url = new URL(`${getFoodConnexApiBaseUrl()}/authenticate`);
  url.searchParams.set('u', username);
  url.searchParams.set('p', password);

  let response: Response;
  try {
    response = await fetch(url, { method: 'POST', headers: { Accept: 'application/json' }, cache: 'no-store' });
  } catch {
    throw new FoodConnexAuthError('Unable to reach Food Connex authentication.');
  }
  if (!response.ok) {
    const entitlementHint = response.status === 401 || response.status === 403
      ? ' Food Connex API entitlement or credentials may need to be enabled for Circle R.'
      : '';
    throw new FoodConnexAuthError(`Food Connex authentication was not accepted (${response.status}).${entitlementHint}`, response.status);
  }
  const payload: unknown = await response.json().catch(() => null);
  const token = payload && typeof payload === 'object' && typeof (payload as { token?: unknown }).token === 'string'
    ? (payload as { token: string }).token
    : null;
  const error = payload && typeof payload === 'object' && typeof (payload as { error?: unknown }).error === 'string'
    ? (payload as { error: string }).error
    : null;
  if (!token || error) throw new FoodConnexAuthError('Food Connex did not return an access token. API entitlement may need to be enabled.');
  cachedToken = { token, expiresAt: Date.now() + TOKEN_LIFETIME_MS };
  return cachedToken;
}
