import 'server-only';

import { createClient } from '@/utils/supabase/server';

export class FoodConnexRouteAuthError extends Error {}

export async function requireActiveFoodConnexUser() {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new FoodConnexRouteAuthError('An authenticated Lucid Core session is required.');
  const { data: profile, error } = await supabase.from('profiles')
    .select('organization_id, active').eq('id', user.id).maybeSingle();
  if (error || !profile?.active) throw new FoodConnexRouteAuthError('An active Lucid Core profile is required.');
  return { userId: user.id, organizationId: profile.organization_id };
}
