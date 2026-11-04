import 'server-only';

import { createClient } from '@/utils/supabase/server';

export type LucidRole = 'production' | 'office' | 'leadership' | 'lucid_admin';

export class RouteAuthorizationError extends Error {
  readonly status: 401 | 403;

  constructor(message: string, status: 401 | 403 = 401) {
    super(message);
    this.status = status;
  }
}

/** Resolves identity and organization from the session; callers never trust request-provided identity fields. */
export async function requireActiveLucidRouteUser(roles?: readonly LucidRole[]) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new RouteAuthorizationError('An authenticated Lucid Core session is required.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, organization_id, active, role')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile?.active) throw new RouteAuthorizationError('An active Lucid Core profile is required.');
  if (roles && !roles.includes(profile.role as LucidRole)) {
    throw new RouteAuthorizationError('Your role is not authorized for this action.', 403);
  }
  return { supabase, userId: user.id, organizationId: profile.organization_id, role: profile.role as LucidRole };
}
