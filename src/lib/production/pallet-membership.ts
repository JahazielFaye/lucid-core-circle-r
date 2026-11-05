export type PalletAssignmentMembership = {
  pallet_id: string;
  production_case_id: string | null;
  status: 'active' | 'removed';
};

/** Current pallet contents deliberately exclude retained correction history. */
export function activePalletCaseIds(assignments: PalletAssignmentMembership[], palletId: string) {
  return new Set(assignments
    .filter(assignment => assignment.pallet_id === palletId && assignment.production_case_id && assignment.status === 'active')
    .map(assignment => assignment.production_case_id as string));
}
