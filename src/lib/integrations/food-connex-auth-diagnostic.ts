import 'server-only';

import { getFoodConnexConfig } from './food-connex-auth';

type Variant = 'query_params' | 'json_body' | 'form_body';
type DiagnosticResult = { variant: Variant; status: number | null; contentType: string | null; safeError?: string; tokenReceived?: boolean };

export async function diagnoseFoodConnexAuthentication() {
  const { baseUrl, clientId, username, password } = getFoodConnexConfig();
  const base = new URL(baseUrl);
  if (base.hostname !== 'www.foodconnex.cloud') throw new Error('Food Connex base URL must use www.foodconnex.cloud.');
  if (!/^\d+$/.test(clientId)) throw new Error('FOOD_CONNEX_CLIENT_ID must be numeric.');
  if (base.pathname !== '/' && base.pathname !== '') throw new Error('FOOD_CONNEX_BASE_URL must not include a path.');
  const apiPath = `/vn/${clientId}/api/v1`;
  const authUrl = new URL(`${apiPath}/authenticate`, base.origin);
  if (authUrl.pathname !== `${apiPath}/authenticate` || authUrl.pathname.includes('/vn/vn/')) {
    throw new Error('Food Connex API path is not in the expected /vn/{clientId}/api/v1 format.');
  }

  const tests: DiagnosticResult[] = [];
  for (const variant of ['query_params', 'json_body', 'form_body'] as const) {
    const requestUrl = new URL(authUrl);
    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: string | undefined;
    if (variant === 'query_params') {
      requestUrl.searchParams.set('u', username);
      requestUrl.searchParams.set('p', password);
    } else if (variant === 'json_body') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ u: username, p: password });
    } else {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ u: username, p: password }).toString();
    }
    tests.push(await testVariant(variant, requestUrl, headers, body));
  }
  return { success: tests.some(test => test.status !== null && test.status >= 200 && test.status < 300 && test.tokenReceived), tests };
}

async function testVariant(variant: Variant, url: URL, headers: Record<string, string>, body?: string): Promise<DiagnosticResult> {
  try {
    const response = await fetch(url, { method: 'POST', headers, body, cache: 'no-store' });
    const contentType = response.headers.get('content-type');
    const payload: unknown = await response.json().catch(() => null);
    const tokenReceived = Boolean(payload && typeof payload === 'object' && typeof (payload as { token?: unknown }).token === 'string');
    return {
      variant,
      status: response.status,
      contentType,
      ...(response.ok && tokenReceived ? { tokenReceived: true } : { safeError: response.status === 401 || response.status === 403 ? 'Authentication was not accepted. Food Connex API access may require entitlement.' : `Authentication request was not accepted (${response.status}).` }),
    };
  } catch {
    return { variant, status: null, contentType: null, safeError: 'Unable to reach Food Connex authentication.' };
  }
}
