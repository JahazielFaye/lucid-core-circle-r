# Production security verification

## Confirmed controlled Supabase validation — 2026-11-04

- Migrations `022_scanning_weighing_foundation.sql` and `023_scanning_weighing_rpc_security_patch.sql` are applied.
- All three scanning/weighing RPCs are SECURITY DEFINER, use an explicit safe search path, deny `anon` and `PUBLIC` execution, and permit `authenticated` execution subject to internal role checks.
- Rollback-only behavioral validation passed: reading capture, atomic case capture, idempotency, consumed-reading rejection, correction history, effective weight, and audit records all passed; test records rolled back.

All remaining entries below are **PENDING LIVE VERIFICATION**.

## Supabase Auth

- MFA policy and enrollment expectations — PENDING LIVE VERIFICATION
- Password policy and breach protection — PENDING LIVE VERIFICATION
- Sign-in/reset rate limits — PENDING LIVE VERIFICATION
- Session duration and refresh behavior — PENDING LIVE VERIFICATION
- Disabled-user session rejection — PENDING LIVE VERIFICATION

## Supabase database

- RLS and RPC grant behavior using each production role — PENDING LIVE VERIFICATION
- SSL/TLS connection enforcement — PENDING LIVE VERIFICATION
- PITR/backups and restore ownership — PENDING LIVE VERIFICATION
- Network restrictions — PENDING LIVE VERIFICATION
- Audit and database log retention/alerting — PENDING LIVE VERIFICATION

## Vercel

- HTTPS and redirect behavior — PENDING LIVE VERIFICATION
- Preview/production environment separation — PENDING LIVE VERIFICATION
- Server secrets scoped to production only — PENDING LIVE VERIFICATION
- Live response headers (CSP, HSTS, Permissions Policy) — PENDING LIVE VERIFICATION
- Deployment protection and access ownership — PENDING LIVE VERIFICATION

## Browser

- Live CSP permits only required Supabase, SPS, and Food Connex origins — PENDING LIVE VERIFICATION
- Camera permission is requested only by user action and only for Lucid’s origin — PENDING LIVE VERIFICATION
- Session expiration, refresh, sign-out, and browser-tab restoration — PENDING LIVE VERIFICATION
