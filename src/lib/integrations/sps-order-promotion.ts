import 'server-only';

import { createClient } from '@/utils/supabase/server';

export class SpsOrderPromotionAuthError extends Error {}

export async function sendStagedSpsOrderToProduction(stagedOrderId: string) {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new SpsOrderPromotionAuthError('An authenticated Lucid Core session is required.');
  const { data: profile, error: profileError } = await supabase.from('profiles')
    .select('organization_id, active, role').eq('id', user.id).maybeSingle();
  if (profileError || !profile?.active) throw new SpsOrderPromotionAuthError('An active Lucid Core profile is required.');
  if (!['office', 'leadership', 'lucid_admin'].includes(profile.role)) {
    throw new Error('Your role cannot send incoming orders to production.');
  }
  const { data, error } = await supabase.rpc('promote_sps_staged_order', { p_staged_order_id: stagedOrderId });
  if (error) throw error;
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.operational_order_id) throw new Error('The operational order was not returned after promotion.');
  return {
    operationalOrderId: result.operational_order_id as string,
    alreadyPromoted: Boolean(result.already_promoted),
    operationalStatus: result.operational_status as string,
  };
}
