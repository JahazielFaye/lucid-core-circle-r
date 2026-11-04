/**
 * Converts Supabase Auth invitation failures into a safe client message and a
 * small server-log classification. Raw provider messages and email addresses
 * are deliberately never returned or logged by this helper.
 */
export type InvitationFailureKind =
  | 'duplicate_auth_user'
  | 'rate_limited'
  | 'email_delivery_or_configuration'
  | 'auth_service_failure'
  | 'invalid_auth_response';

type AuthErrorLike = { code?: unknown; status?: unknown };

const duplicateCodes = new Set(['email_exists', 'user_already_exists', 'identity_already_exists']);
const rateLimitCodes = new Set(['over_email_send_rate_limit', 'over_request_rate_limit']);
const emailConfigurationCodes = new Set(['email_address_not_authorized', 'email_provider_disabled']);

function safeCode(error: unknown) {
  const code = typeof error === 'object' && error !== null ? (error as AuthErrorLike).code : undefined;
  return typeof code === 'string' && /^[a-z0-9_]{1,80}$/i.test(code) ? code : null;
}

function safeStatus(error: unknown) {
  const status = typeof error === 'object' && error !== null ? (error as AuthErrorLike).status : undefined;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

export function classifyInvitationFailure(error: unknown, receivedUser: boolean) {
  const code = safeCode(error);
  const status = safeStatus(error);
  let kind: InvitationFailureKind = 'invalid_auth_response';
  let publicMessage = 'The authentication service did not create an invitation. An administrator should review server diagnostics before retrying.';

  if (code && duplicateCodes.has(code)) {
    kind = 'duplicate_auth_user';
    publicMessage = 'An authentication account already exists for this email. An administrator should review it before retrying.';
  } else if (status === 429 || (code && rateLimitCodes.has(code))) {
    kind = 'rate_limited';
    publicMessage = 'Invitation delivery is temporarily limited. Wait before trying again.';
  } else if (code && emailConfigurationCodes.has(code)) {
    kind = 'email_delivery_or_configuration';
    publicMessage = 'Invitation email delivery is not currently available. An administrator should review the Auth email configuration.';
  } else if (status !== null && status >= 500) {
    kind = 'auth_service_failure';
    publicMessage = 'The authentication service is temporarily unavailable. Try again later.';
  }

  return { kind, code, status, receivedUser, publicMessage, responseStatus: kind === 'rate_limited' ? 429 : 400 };
}
