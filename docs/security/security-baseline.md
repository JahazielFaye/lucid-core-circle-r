# Lucid Core security baseline

## Release rule

Security failures are release blockers. A release is not **READY** until functional, TypeScript, build, tenant-isolation, role, mutation, audit-integrity, secret-scan, upload-security, header, and dependency-review checks pass. Exceptions require a documented owner, expiration, compensating controls, and leadership approval.

## Threat model and classification

All organization data is confidential by default. Operational-confidential data includes prices, orders, production, inventory, traceability, shipments, and vendor/customer relationships. Contact data includes names, email, phone, and address. Security-sensitive data includes roles, sessions, credentials, tokens, and audit history.

Primary threats are cross-tenant access, compromised user sessions, excessive role privileges, unsafe import files, untrusted scanner input, integration-secret exposure, and destructive changes to operational history.

## Tenant, roles, and audit

Every organization-owned row must have an organization boundary enforced by RLS plus RPC/trigger validation. Browser-provided organization, actor, role, QA state, and provenance are never authoritative. Roles are least-privilege: production operates production only; office handles assigned operations; leadership approves/corrects; Lucid Admin configures and administers. Critical records are voided, reversed, inactivated, or superseded—not deleted. Audit entries must include organization, actor, action, entity, timestamp, and meaningful safe metadata.

## Secrets, integrations, and uploads

Secrets are server-only environment values, excluded from Git and logs. `NEXT_PUBLIC_*` values may contain only public configuration. Integrations use least-privilege credentials, sandbox/production separation, timeouts, validation, and auditable actions. Uploaded CSV/XLSX data is hostile: authenticated/admin-only, size/type/sheet/row/cell limited, parsed as data only, never executed, and never trusted for authorization or provenance.

## Platform controls

Production must use HTTPS, Supabase managed encryption, secure session cookies, restrictive CORS, reviewed security headers, and Supabase Auth protections. MFA is required for Lucid Admin before broad rollout. Backups/PITR and restoration authority remain a production-operations responsibility and must be documented with Supabase.

## Scanner/weighing scope

022 permits identifier lookup, receipt draft population, server-created manual reading tokens, authorized Weigh Mode capture, preview-only labels, and zero-write diagnostics. Picking, pallet, and shipping scan mutations are not enabled. Raw scanner payloads are length-limited and never used as SQL, HTML, commands, paths, or URLs.
