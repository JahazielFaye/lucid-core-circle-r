import 'server-only';

import { createClient } from '@/utils/supabase/server';

export class LucidProductionAuthError extends Error {}

type ProductionProfile = { id: string; organizationId: string; role: string };

async function getProductionProfile(): Promise<{ supabase: Awaited<ReturnType<typeof createClient>>; profile: ProductionProfile }> {
  const supabase = await createClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) throw new LucidProductionAuthError('An authenticated Lucid Core session is required.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, active, role')
    .eq('id', user.id)
    .maybeSingle();
  if (profileError || !profile?.active) throw new LucidProductionAuthError('An active Lucid Core profile is required.');
  if (!['production', 'office', 'leadership', 'lucid_admin'].includes(profile.role)) {
    throw new Error('Your role cannot manage production orders.');
  }
  return { supabase, profile: { id: user.id, organizationId: profile.organization_id, role: profile.role } };
}

async function callProductionRpc(name: string, args: Record<string, unknown>) {
  const { supabase } = await getProductionProfile();
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data[0] : data;
}

export async function startLucidProduction(orderId: string) {
  return callProductionRpc('start_lucid_production', { p_order_id: orderId });
}

export async function addLucidProductionCase(
  orderId: string,
  orderLineId: string,
  caseIdentifier: string,
  quantity: number,
  netWeight: number | null,
  productionLotId: string,
) {
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Case quantity must be greater than zero.');
  if (netWeight == null || !Number.isFinite(netWeight) || netWeight <= 0) throw new Error('A net weight greater than zero is required.');
  if (Math.round(netWeight * 100) / 100 !== netWeight) throw new Error('Net weight can have no more than two decimal places.');
  if (!productionLotId.trim()) throw new Error('A production lot or Prod Code is required.');
  return callProductionRpc('add_lucid_production_case', {
    p_order_id: orderId,
    p_order_line_id: orderLineId,
    p_case_identifier: caseIdentifier.trim(),
    p_quantity: quantity,
    p_net_weight: netWeight,
    p_production_lot_id: productionLotId,
  });
}

export async function createOrGetLucidProductionLot(orderId: string, orderLineId: string, lotCode: string) {
  if (!lotCode.trim()) throw new Error('A production lot or Prod Code is required.');
  return callProductionRpc('create_or_get_lucid_production_lot', {
    p_order_id: orderId,
    p_order_line_id: orderLineId,
    p_lot_code: lotCode.trim(),
  });
}

export async function voidLucidProductionCase(caseId: string, reason: string) {
  if (!reason.trim()) throw new Error('A reason is required to void a production case.');
  return callProductionRpc('void_lucid_production_case', {
    p_production_case_id: caseId,
    p_void_reason: reason.trim(),
  });
}

export async function completeLucidProduction(orderId: string) {
  return callProductionRpc('complete_lucid_production', { p_order_id: orderId });
}

export async function recordLucidCaseLabelPrint(caseId: string) {
  return callProductionRpc('record_lucid_case_label_print', { p_production_case_id: caseId });
}

export async function createLucidPallet(orderId: string) {
  return callProductionRpc('create_lucid_pallet', { p_order_id: orderId });
}

export async function addLucidCaseToPallet(palletId: string, caseIdentifier: string) {
  if (!caseIdentifier.trim()) throw new Error('Enter a case ID.');
  return callProductionRpc('add_lucid_case_to_pallet', {
    p_pallet_id: palletId,
    p_case_identifier: caseIdentifier.trim(),
  });
}

export async function removeLucidCaseFromPallet(palletId: string, productionCaseId: string) {
  return callProductionRpc('remove_lucid_case_from_pallet', {
    p_pallet_id: palletId,
    p_production_case_id: productionCaseId,
  });
}

export async function completeLucidPallet(palletId: string) {
  return callProductionRpc('complete_lucid_pallet', { p_pallet_id: palletId });
}

export async function reopenLucidPallet(palletId: string, reason: string) {
  if (!reason.trim()) throw new Error('A correction reason is required to reopen this pallet.');
  return callProductionRpc('reopen_lucid_pallet', {
    p_pallet_id: palletId,
    p_reason: reason.trim(),
  });
}
