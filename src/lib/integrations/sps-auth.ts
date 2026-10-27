import 'server-only';

const SPS_TOKEN_ENDPOINT = 'https://auth.spscommerce.com/oauth/token';
const CACHE_SAFETY_WINDOW_MS = 60_000;

type CachedSpsToken = {
  accessToken: string;
  expiresIn: number;
  expiresAt: Date;
  responseStatus: number;
};

export type SpsTokenMetadata = Omit<CachedSpsToken, 'accessToken'>;

let cachedToken: CachedSpsToken | null = null;

function getSpsConfiguration() {
  const clientId = process.env.SPS_SANDBOX_CLIENT_ID;
  const clientSecret = process.env.SPS_SANDBOX_CLIENT_SECRET;
  const audience = process.env.SPS_AUDIENCE;

  if (!clientId || !clientSecret || !audience) {
    throw new Error('SPS sandbox configuration is incomplete.');
  }

  return { clientId, clientSecret, audience };
}

function hasUsableCachedToken() {
  return (
    cachedToken !== null &&
    cachedToken.expiresAt.getTime() - Date.now() > CACHE_SAFETY_WINDOW_MS
  );
}

/**
 * Retrieves a sandbox M2M access token for server-side SPS requests only.
 * The token is intentionally never exposed to client code or route responses.
 */
export async function getSpsSandboxAccessToken(): Promise<CachedSpsToken> {
  if (hasUsableCachedToken()) {
    return cachedToken!;
  }

  const { clientId, clientSecret, audience } = getSpsConfiguration();
  let response: Response;

  try {
    response = await fetch(SPS_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        audience,
      }),
      cache: 'no-store',
    });
  } catch {
    throw new Error('Unable to reach the SPS sandbox authentication service.');
  }

  if (!response.ok) {
    throw new Error(`SPS authentication request failed (HTTP ${response.status}).`);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!isTokenResponse(body)) {
    throw new Error('SPS authentication service returned an invalid token response.');
  }

  const expiresAt = new Date(Date.now() + body.expires_in * 1000);
  cachedToken = {
    accessToken: body.access_token,
    expiresIn: body.expires_in,
    expiresAt,
    responseStatus: response.status,
  };

  return cachedToken;
}

function isTokenResponse(
  value: unknown,
): value is { access_token: string; expires_in: number } {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const response = value as Record<string, unknown>;
  return (
    typeof response.access_token === 'string' &&
    response.access_token.length > 0 &&
    typeof response.expires_in === 'number' &&
    Number.isFinite(response.expires_in) &&
    response.expires_in > 0
  );
}

export function getSpsTokenMetadata(token: CachedSpsToken): SpsTokenMetadata {
  return {
    expiresIn: token.expiresIn,
    expiresAt: token.expiresAt,
    responseStatus: token.responseStatus,
  };
}
