import 'server-only';

import { createClient } from '@/utils/supabase/server';

export class SpsResolutionAuthError extends Error {}

type Supabase = Awaited<ReturnType<typeof createClient>>;

export async function resolveSpsException(exceptionId: string, resolutionAction: string) {
  if (!resolutionAction.trim() || resolutionAction.length > 500) {
    throw new Error('A valid resolution action is required.');
  }

  const supabase = await createClient();
  const profile = await getActiveProfile(supabase);
  const organizationId = profile.organizationId;
  const { data: exception, error: exceptionError } = await supabase
    .from('sps_order_exceptions')
    .select('id, staged_order_id, staged_order_line_id, organization_id, status, exception_code, details')
    .eq('id', exceptionId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (exceptionError) throw exceptionError;
  if (!exception) throw new Error('Staged SPS exception was not found.');
  const priceActions = ['use_sps_price', 'use_approved_circle_r_price', 'needs_leadership_review'];
  if (priceActions.includes(resolutionAction) && exception.exception_code !== 'PRICE_MISMATCH') {
    throw new Error('This action is only valid for a PRICE_MISMATCH exception.');
  }
  if (exception.exception_code === 'PRICE_MISMATCH') {
    return resolvePriceMismatch(supabase, exception, resolutionAction, profile);
  }
  if (exception.status !== 'open') throw new Error('This staged SPS exception is already resolved.');

  const { error: updateError } = await supabase
    .from('sps_order_exceptions')
    .update({
      status: 'resolved',
      resolution_action: resolutionAction.trim(),
      resolved_by: profile.id,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', exception.id)
    .eq('organization_id', organizationId);
  if (updateError) throw updateError;

  const status = await recalculateStagedOrderStatus(supabase, exception.staged_order_id, organizationId);
  return { stagedOrderId: exception.staged_order_id, exceptionStatus: 'resolved', resolutionAction, ...status };
}

async function resolvePriceMismatch(
  supabase: Supabase,
  exception: { id: string; staged_order_id: string; organization_id: string; status: string; details: unknown },
  action: string,
  profile: { id: string; organizationId: string; role: string },
) {
  if (!['use_sps_price', 'use_approved_circle_r_price', 'needs_leadership_review'].includes(action)) {
    throw new Error('Invalid PRICE_MISMATCH resolution action.');
  }
  if (action === 'needs_leadership_review') {
    if (!['office', 'leadership', 'lucid_admin'].includes(profile.role)) throw new Error('Your role cannot request leadership review.');
    const details = exception.details && typeof exception.details === 'object' ? exception.details as Record<string, unknown> : {};
    const { error } = await supabase.from('sps_order_exceptions').update({
      details: { ...details, leadership_review_requested_by: profile.id, leadership_review_requested_at: new Date().toISOString() },
    }).eq('id', exception.id).eq('organization_id', profile.organizationId).eq('status', 'open');
    if (error) throw error;
    const status = await recalculateStagedOrderStatus(supabase, exception.staged_order_id, profile.organizationId);
    return { stagedOrderId: exception.staged_order_id, exceptionStatus: 'open', resolutionAction: action, ...status };
  }
  if (!['leadership', 'lucid_admin'].includes(profile.role)) {
    throw new Error('Only leadership or Lucid Admin can finalize a price resolution.');
  }
  if (exception.status !== 'open') throw new Error('This staged SPS exception is already resolved.');
  const { error } = await supabase.from('sps_order_exceptions').update({
    status: 'resolved', resolution_action: action, resolved_by: profile.id, resolved_at: new Date().toISOString(),
  }).eq('id', exception.id).eq('organization_id', profile.organizationId);
  if (error) throw error;
  // sps_purchase_price and approved_circle_r_price deliberately remain unchanged.
  const status = await recalculateStagedOrderStatus(supabase, exception.staged_order_id, profile.organizationId);
  return { stagedOrderId: exception.staged_order_id, exceptionStatus: 'resolved', resolutionAction: action, ...status };
}

/** Recalculates review and mapping state without changing source SPS values. */
export async function recalculateStagedOrderStatus(
  supabase: Supabase,
  stagedOrderId: string,
  organizationId: string,
) {
  const { data: order, error: orderError } = await supabase
    .from('sps_staged_orders')
    .select('id, customer_mapping_id, ship_to_mapping_id')
    .eq('id', stagedOrderId).eq('organization_id', organizationId).maybeSingle();
  if (orderError) throw orderError;
  if (!order) throw new Error('Staged SPS order was not found.');

  const [{ data: lines, error: linesError }, { data: openExceptions, error: exceptionsError }] = await Promise.all([
    supabase.from('sps_staged_order_lines').select('item_mapping_status').eq('staged_order_id', stagedOrderId).eq('organization_id', organizationId),
    supabase.from('sps_order_exceptions').select('severity').eq('staged_order_id', stagedOrderId).eq('organization_id', organizationId).eq('status', 'open'),
  ]);
  if (linesError) throw linesError;
  if (exceptionsError) throw exceptionsError;

  const mappedLineCount = (lines ?? []).filter((line) => line.item_mapping_status === 'mapped').length;
  const mappingsComplete = Boolean(order.customer_mapping_id && order.ship_to_mapping_id) &&
    (lines ?? []).length > 0 && mappedLineCount === (lines ?? []).length;
  const mappingStatus = mappingsComplete ? 'mapped' : mappedLineCount > 0 || order.customer_mapping_id || order.ship_to_mapping_id ? 'partially_mapped' : 'unmapped';
  const hasReviewException = (openExceptions ?? []).some(
    (exception) => exception.severity === 'warning' || exception.severity === 'blocking',
  );
  const reviewStatus = hasReviewException || !mappingsComplete ? 'needs_review' : 'ready';
  const { error: updateError } = await supabase.from('sps_staged_orders')
    .update({ mapping_status: mappingStatus, review_status: reviewStatus })
    .eq('id', stagedOrderId).eq('organization_id', organizationId);
  if (updateError) throw updateError;
  return { mappingStatus, reviewStatus };
}

async function getActiveOrganizationId(supabase: Supabase): Promise<string> {
  return (await getActiveProfile(supabase)).organizationId;
}

async function getActiveProfile(supabase: Supabase): Promise<{ id: string; organizationId: string; role: string }> {
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new SpsResolutionAuthError('An authenticated Lucid Core session is required.');
  const { data: profile, error } = await supabase.from('profiles')
    .select('organization_id, active, role').eq('id', user.id).maybeSingle();
  if (error || !profile?.active) throw new SpsResolutionAuthError('An active Lucid Core profile is required.');
  return { id: user.id, organizationId: profile.organization_id, role: profile.role };
}
