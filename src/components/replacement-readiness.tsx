'use client';

type Role = 'lucid_admin'|'leadership'|'office'|'production';
const checks: Array<[string, 'Ready' | 'Needs Validation' | 'Blocked', string]> = [
  ['Receiving','Ready','Draft, post, and immutable ledger workflow is present; validate with a live receipt after migration 016.'],
  ['Inventory','Ready','On-hand, lot, transaction, and movement views use the traceability ledger.'],
  ['Production genealogy','Ready','Run, consumption, output, and case-link controls are locally complete.'],
  ['Pick allocation','Ready','Case allocation and historical removal/reallocation are available.'],
  ['Pallet','Ready','Case assignment, correction, and activity history are preserved.'],
  ['Shipment','Ready','Completed pallets/cases, BOL completion, and immutable contents are available.'],
  ['ASN preparation','Needs Validation','Shipment-backed preparation is ready; SPS transmission and SSCC remain intentionally external.'],
  ['Trace / Recall','Ready','Native relationships and legacy fallback remain visible without invented genealogy.'],
  ['Historical import','Needs Validation','Admin preview/confirmation and provenance are ready; validate actual Food Connex exports before cutover.'],
  ['Role enforcement','Ready','UI visibility mirrors backend gates; Supabase/RPC authorization remains authoritative.'],
] as const;
export function ReplacementReadiness({ role }: { role: Role }) {
  if (!['leadership','lucid_admin'].includes(role)) return null;
  return <section className="surface master-data-surface readiness-panel"><div className="master-data-toolbar"><div><strong>Replacement readiness</strong><small>These are operational readiness states, not database-table checks.</small></div></div><div className="master-table-wrap"><table className="master-table"><thead><tr><th>Capability</th><th>Status</th><th>What remains</th></tr></thead><tbody>{checks.map(([name,status,detail])=><tr key={name}><td>{name}</td><td><span className={`status-chip ${status==='Ready'?'ready':status==='Blocked'?'danger':'progress'}`}>{status}</span></td><td>{detail}</td></tr>)}</tbody></table></div></section>;
}
