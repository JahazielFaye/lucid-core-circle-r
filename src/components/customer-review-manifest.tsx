'use client';

import { useState } from 'react';
import { allManifestRecords, reviewDraft, reviewSummaryDraft, type CustomerReviewManifest, type ReviewChoice } from '../lib/integrations/customer-review-manifest-contract';

type ManifestRole = 'lucid_admin' | 'leadership' | 'office' | 'production';
type ManifestStatus = 'DRAFT' | 'READY_FOR_REVIEW' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED' | 'INVALIDATED' | string;

export type CustomerManifestRegistryState = {
  manifest: { id: string; manifest_id: string; manifest_version: number; source_hash: string; plan_hash: string; status: ManifestStatus; generated_at: string };
  approvals: Array<{ id: string; reviewer_id: string; reviewer_role: string; decision: string; comment: string | null; decided_at: string }>;
  viewerRole: ManifestRole;
  invalidation?: { reason: string | null; invalidatedAt: string; invalidatedBy: string | null } | null;
};

const closedStatuses = new Set<ManifestStatus>(['SUPERSEDED', 'INVALIDATED']);

export function customerManifestDecisionOptions(role: ManifestRole, status: ManifestStatus): ReviewChoice[] {
  if (closedStatuses.has(status) || role === 'production') return [];
  if (role === 'lucid_admin') return ['NEEDS_REVIEW', 'APPROVE', 'REJECT'];
  if (role === 'leadership' || role === 'office') return ['NEEDS_REVIEW'];
  return [];
}

export function canInvalidateCustomerManifest(role: ManifestRole, status: ManifestStatus) {
  return role === 'lucid_admin' && !closedStatuses.has(status);
}

function statusLabel(status: ManifestStatus) {
  return status.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function download(name: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function CustomerManifestReview({ manifest, summary, registrationInput, initialRegistry, viewerRole }: {
  manifest: CustomerReviewManifest;
  summary: string;
  registrationInput?: { sourceReference: string; rows: unknown[]; relatedRecords?: unknown };
  /** Test-only initial state; server routes remain the source of authority. */
  initialRegistry?: CustomerManifestRegistryState;
  viewerRole?: ManifestRole;
}) {
  const [choices, setChoices] = useState<Record<string, ReviewChoice>>({});
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState('');
  const [registry, setRegistry] = useState<CustomerManifestRegistryState | null>(initialRegistry ?? null);
  const [formalDecision, setFormalDecision] = useState<ReviewChoice>('NEEDS_REVIEW');
  const [formalComment, setFormalComment] = useState('');
  const [invalidationReason, setInvalidationReason] = useState('');
  const [confirmInvalidation, setConfirmInvalidation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formalError, setFormalError] = useState('');

  const records = allManifestRecords(manifest);
  const visible = records.filter((record) => [record.customer_code, record.source_record_id, record.entity, record.action].some((value) => value?.toLowerCase().includes(query.trim().toLowerCase())));
  const pages = Math.max(1, Math.ceil(visible.length / 25));
  const current = Math.min(page, pages);
  const name = `customer-review-v${manifest.manifest_version}-${manifest.integrity.content_hash.slice(0, 12)}`;
  const globalBlocked = manifest.validation_findings.some((finding) => finding.severity === 'error');
  const effectiveRole = registry?.viewerRole ?? viewerRole;
  const formalOptions = registry && effectiveRole ? customerManifestDecisionOptions(effectiveRole, registry.manifest.status) : [];
  const isClosed = registry ? closedStatuses.has(registry.manifest.status) : false;
  const canInvalidate = registry && effectiveRole ? canInvalidateCustomerManifest(effectiveRole, registry.manifest.status) : false;

  const loadRegistry = async (id: string) => {
    const response = await fetch(`/api/customer-manifests/${id}`, { credentials: 'same-origin' });
    const body = await response.json() as { success: boolean; data?: CustomerManifestRegistryState; error?: string };
    if (!response.ok || !body.success) throw new Error(body.error || 'The registered manifest could not be loaded.');
    setRegistry(body.data || null);
  };
  const register = async () => {
    if (saving) return;
    if (viewerRole && viewerRole !== 'lucid_admin') return setFormalError('Only Lucid Admin can register a Customer review manifest.');
    if (!registrationInput) return setFormalError('The original server review input is unavailable. Build the review again before registering it.');
    setSaving(true); setFormalError('');
    try {
      const response = await fetch('/api/customer-manifests/register', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifest, ...registrationInput }) });
      const body = await response.json() as { success: boolean; data?: { registry_id: string; registered: boolean }; error?: string };
      if (!response.ok || !body.success || !body.data) throw new Error(body.error || 'The manifest could not be registered.');
      await loadRegistry(body.data.registry_id);
      setNotice(body.data.registered ? 'Immutable manifest registered for formal review.' : 'This immutable manifest was already registered.');
    } catch (error) { setFormalError(error instanceof Error ? error.message : 'The manifest could not be registered.'); } finally { setSaving(false); }
  };
  const decide = async () => {
    if (!registry || saving || !formalOptions.includes(formalDecision)) return;
    setSaving(true); setFormalError('');
    try {
      const response = await fetch(`/api/customer-manifests/${registry.manifest.id}/decisions`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ manifestId: manifest.manifest_id, manifestVersion: manifest.manifest_version, sourceHash: manifest.integrity.source_hash, planHash: manifest.integrity.plan_hash, decision: formalDecision, comment: formalComment }) });
      const body = await response.json() as { success: boolean; data?: { status: string; commit_eligible: boolean }; error?: string };
      if (!response.ok || !body.success) throw new Error(body.error || 'The formal decision could not be saved.');
      await loadRegistry(registry.manifest.id); setFormalComment('');
      setNotice(`${formalDecision.replaceAll('_', ' ')} recorded for this exact manifest version.${body.data?.commit_eligible ? ' It is review-approved; a future commit gate must still revalidate all conditions.' : ' It does not authorize an operational import.'}`);
    } catch (error) { setFormalError(error instanceof Error ? error.message : 'The formal decision could not be saved.'); } finally { setSaving(false); }
  };
  const invalidate = async () => {
    if (!registry || !canInvalidate || saving) return;
    const reason = invalidationReason.trim();
    if (!reason) return setFormalError('An invalidation reason is required. Do not include private source data.');
    if (!confirmInvalidation) return setFormalError('Confirm that this invalidates the registered review while preserving its history.');
    setSaving(true); setFormalError('');
    try {
      const response = await fetch(`/api/customer-manifests/${registry.manifest.id}/invalidate`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason }) });
      const body = await response.json() as { success: boolean; data?: { status: string }; error?: string };
      if (!response.ok || !body.success) throw new Error(body.error || 'The review manifest could not be invalidated.');
      await loadRegistry(registry.manifest.id); setNotice('The review manifest was invalidated. Its canonical content and decision history remain read-only.'); setInvalidationReason(''); setConfirmInvalidation(false);
    } catch (error) { setFormalError(error instanceof Error ? error.message : 'The review manifest could not be invalidated.'); } finally { setSaving(false); }
  };

  return <section className="surface customer-manifest" aria-labelledby="customer-manifest-heading">
    <div className="customer-plan-setup-heading"><div><span className="kicker">02 / Source-owner review</span><h2 id="customer-manifest-heading">Customer Review Manifest · version {manifest.manifest_version}</h2></div><span>Read-only · not an import authorization</span></div>
    <div className="customer-manifest-body">
      <p>This snapshot comes from the same server plan shown above. Private plaintext is withheld in exports; field fingerprints retain the comparison binding.</p><p role="note"><strong>Draft selections are drafts, not saved approvals.</strong> They stay in this browser unless exported. Formal decisions are available only after this exact immutable manifest is registered and tied to the authenticated reviewer.</p>
      <div className="import-summary"><span><strong>{manifest.counts.total}</strong>total records including relationships</span>{Object.entries(manifest.counts.by_action).map(([action, count]) => <span key={action}><strong>{count}</strong>{action.replaceAll('_', ' ')}</span>)}</div>
      <div className="customer-manifest-actions"><button className="secondary" type="button" onClick={() => { download(`${name}.json`, JSON.stringify(manifest, null, 2), 'application/json'); setNotice('Canonical manifest exported. No records were changed.'); }}>Export JSON manifest</button><button className="secondary" type="button" onClick={() => { download(`${name}-summary.txt`, reviewSummaryDraft(summary, manifest, choices, new Date().toISOString()), 'text/plain'); setNotice('Read-only summary exported.'); }}>Export review summary</button><button className="secondary" type="button" onClick={() => { const draft = reviewDraft(manifest, choices, new Date().toISOString()); download(`${name}-review-draft.json`, JSON.stringify({ manifest, review_draft: draft }, null, 2), 'application/json'); setNotice('Unverified review draft exported; no server approval was saved.'); }}>Export review draft</button></div>
      <p role="status" aria-live="polite">{notice || `${Object.keys(choices).length} local review selections · none saved to server`}</p>
      <section className="customer-plan-source" aria-label="Formal approval ledger">
        <div className="customer-plan-setup-heading"><div><strong>Formal review ledger</strong><small>Authenticated, append-only decisions bind to this exact manifest, version, source hash, and plan hash.</small></div>{registry ? <span className={`status-chip ${isClosed ? 'error' : 'progress'}`}>{statusLabel(registry.manifest.status)}</span> : <span className="status-chip">Not registered</span>}</div>
        {!registry ? (viewerRole && viewerRole !== 'lucid_admin' ? <p className="muted-copy">Only Lucid Admin can register a Customer review manifest. No Customer records can be changed here.</p> : <div className="report-actions"><button type="button" className="primary" disabled={saving} onClick={() => void register()}>{saving ? 'Registering…' : 'Register immutable manifest'}</button><span>Registering does not approve or import any Customer record.</span></div>) : <>
          <dl><dt>Registered reviewer artifact</dt><dd>{registry.manifest.id}</dd><dt>Current formal state</dt><dd>{statusLabel(registry.manifest.status)}</dd><dt>Exact hashes</dt><dd>{registry.manifest.source_hash.slice(0, 16)}… / {registry.manifest.plan_hash.slice(0, 16)}…</dd></dl>
          {registry.manifest.status === 'SUPERSEDED' && <p className="muted-copy">A newer manifest version superseded this version. It remains read-only and cannot receive another formal decision.</p>}
          {registry.manifest.status === 'INVALIDATED' && <div className="customer-plan-safety" role="note"><div><strong>This manifest is invalidated and cannot become commit-eligible.</strong><p>{registry.invalidation?.reason ? `Reason: ${registry.invalidation.reason}` : 'The invalidation reason is retained in the audit ledger.'}{registry.invalidation?.invalidatedAt ? ` Recorded ${new Date(registry.invalidation.invalidatedAt).toLocaleString()}.` : ''}</p></div></div>}
          {!isClosed && formalOptions.length > 0 && <div className="master-form"><label><span>Formal decision</span><select value={formalDecision} onChange={(event) => setFormalDecision(event.target.value as ReviewChoice)}>{formalOptions.map((decision) => <option key={decision} value={decision} disabled={decision === 'APPROVE' && globalBlocked}>{decision === 'NEEDS_REVIEW' ? 'Needs review' : decision === 'APPROVE' ? 'Approve exact manifest' : 'Reject exact manifest'}</option>)}</select></label><label><span>Comment (optional)</span><input value={formalComment} onChange={(event) => setFormalComment(event.target.value)} placeholder="Reason or review note" /></label><button type="button" className="primary" disabled={saving} onClick={() => void decide()}>{saving ? 'Saving…' : 'Save formal decision'}</button></div>}
          {!isClosed && effectiveRole === 'production' && <p className="muted-copy">Your production role can view this registered review, but cannot record a formal decision.</p>}
          {!isClosed && (effectiveRole === 'leadership' || effectiveRole === 'office') && <p className="muted-copy">Your role may mark this review as needing attention. Lucid Admin records approvals and rejections.</p>}
          {!isClosed && formalOptions.length > 0 && <p className="muted-copy">Unresolved conflicts remain non-eligible for any future commit even when their review acknowledgement is recorded.</p>}
          {canInvalidate && <details className="customer-plan-mapping"><summary>Invalidate this registered review</summary><p>This keeps the canonical manifest and every decision in history, but prevents future formal decisions and future commit eligibility. Do not paste private source data in the reason.</p><div className="master-form"><label><span>Invalidation reason</span><textarea value={invalidationReason} onChange={(event) => setInvalidationReason(event.target.value)} placeholder="Why this review must no longer be used" required /></label><label className="customer-manifest-confirm"><input type="checkbox" checked={confirmInvalidation} onChange={(event) => setConfirmInvalidation(event.target.checked)} /> <span>I understand this action is permanent for this manifest version.</span></label><button type="button" className="secondary" disabled={saving || !invalidationReason.trim() || !confirmInvalidation} onClick={() => void invalidate()}>{saving ? 'Invalidating…' : 'Invalidate manifest'}</button></div></details>}
          <details><summary>Formal decision history · {registry.approvals.length}</summary>{registry.approvals.length ? registry.approvals.map((approval) => <p key={approval.id}><strong>{approval.decision.replaceAll('_', ' ')}</strong> · {approval.reviewer_role.replaceAll('_', ' ')} · {new Date(approval.decided_at).toLocaleString()}{approval.comment ? ` · ${approval.comment}` : ''}</p>) : <p>No formal decisions yet.</p>}</details>
        </>}
      </section>
      {formalError && <p className="master-data-error" role="alert">{formalError}</p>}
      <details className="customer-plan-source"><summary>Version comparison and integrity</summary><p>{manifest.previous_manifest_id ? 'Recorded comparison with this version’s predecessor.' : 'First version; all records are new to this review lineage.'}</p><dl>{Object.entries(manifest.comparison).map(([kind, keys]) => <div key={kind}><dt>{kind.replaceAll('_', ' ')}</dt><dd>{keys.length}{keys.length > 0 && <ul>{keys.slice(0, 50).map((key) => <li key={key}>{key}</li>)}</ul>}{keys.length > 50 && <span>Additional keys are in the JSON export.</span>}</dd></div>)}</dl><dl><dt>Manifest ID</dt><dd>{manifest.manifest_id}</dd><dt>Generated</dt><dd>{manifest.generated_at}</dd><dt>Generated by (session ID)</dt><dd>{manifest.generated_by.actor_id}</dd><dt>Environment</dt><dd>{manifest.environment}</dd><dt>Source hash</dt><dd>{manifest.integrity.source_hash}</dd><dt>Plan hash</dt><dd>{manifest.integrity.plan_hash}</dd><dt>Content hash</dt><dd>{manifest.integrity.content_hash}</dd><dt>Artifact hash</dt><dd>{manifest.integrity.artifact_hash}</dd></dl><p>SHA-256 detects drift. These fingerprints are not cryptographic signatures, verified reviewer identities or permission to commit.</p></details>
      <details className="customer-plan-source"><summary>Relationship coverage</summary><ul>{Object.entries(manifest.related_coverage).map(([entity, coverage]) => <li key={entity}>{entity.replaceAll('_', ' ')}: {coverage.supplied} supplied · {coverage.state === 'NOT_SUPPLIED' ? 'not supplied; absence not established' : 'manual review; related planner not yet available'}</li>)}</ul><p>Relationships stay linked to their source customer. Unresolved or ambiguous parents are kept separately as conflicts. No relationship joins or actions are inferred.</p></details>
      <label className="customer-manifest-search">Search manifest records<input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1); }} placeholder="Code, source ID, record type or action" /></label><p>Customer records and supplied relationships · {visible.length} shown</p>
      {visible.slice((current - 1) * 25, current * 25).map((record) => <details className="customer-manifest-record" key={record.record_key}><summary>{record.entity.replaceAll('_', ' ')} · {record.customer_code || 'Unresolved customer'} · {record.source_record_id || 'Missing source ID'} <strong>{record.action.replaceAll('_', ' ')}</strong></summary><p>Source status: {record.source_status.visibility === 'PUBLIC' ? String(record.source_status.value) : 'Not available'} · Existing match: {record.existing_lucid_match?.id || 'None linked'}</p><p>Source customer ID: {record.source_parent_customer_id || record.source_record_id || 'Unresolved'}{record.source_ship_to_id ? ` · Source Ship-To: ${record.source_ship_to_id}` : ''}</p><p>Comparison: {record.comparison_scope === 'PLANNER_CHANGED_FIELDS' ? 'exact changed fields from Customer Master planner' : 'unplanned source evidence only; no create/update/unchanged claim'}. Private values remain withheld.</p>{record.validation_findings.map((finding, index) => <p key={index}><strong>{finding.severity === 'error' ? 'Manual review' : finding.severity === 'warning' ? 'Warning' : 'Explanation'}:</strong> {finding.message}</p>)}<label>Reviewer decision (unsaved draft)<select value={choices[record.record_key] || ''} onChange={(event) => { const next = { ...choices }; if (event.target.value) next[record.record_key] = event.target.value as ReviewChoice; else delete next[record.record_key]; setChoices(next); setNotice('Review selection changed locally; export a draft to retain it.'); }}><option value="">Not reviewed</option><option value="APPROVE" disabled={record.action === 'CONFLICT' || globalBlocked}>Approve proposed {record.action.toLowerCase().replaceAll('_', ' ')}</option><option value="REJECT">Reject</option><option value="NEEDS_REVIEW">Needs review</option></select></label></details>)}
      {!visible.length && <p>No matching manifest records.</p>}
      <nav className="customer-plan-pagination" aria-label="Manifest record pages"><button type="button" className="secondary" disabled={current === 1} onClick={() => setPage(current - 1)}>Previous</button><span>Page {current} of {pages}</span><button type="button" className="secondary" disabled={current === pages} onClick={() => setPage(current + 1)}>Next</button></nav>
    </div>
  </section>;
}
