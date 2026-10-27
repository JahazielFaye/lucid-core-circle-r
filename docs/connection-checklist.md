# Lucid Core — Production Connection Checklist

Lucid Core is intentionally in Safe Mode until each connection is validated with test data. Do not place secrets in browser code or commit them to GitHub.

## 1. Shared database + secure login (first)
Before multiple staff members use Lucid Core on separate devices, move browser-local data to a shared server database and production authentication.

Needed:
- Managed PostgreSQL database (Supabase, Neon, RDS, or equivalent)
- Production app host (Vercel or equivalent)
- Secure user authentication and role permissions
- Server-side encrypted secret storage

This is required for live team messages, shared records, audit history, and connector tokens across devices.

## 2. SPS Commerce
Purpose: receive customer transactions and later return approved shipping/invoice transactions.

Ask SPS for:
- Transaction API / Dev Center access for Circle R Beef
- OAuth client credentials / approved application access
- Production + test/sandbox endpoint details if available
- Confirmed transaction/document types enabled for Circle R (850, 855, 860, 856, 810 as applicable)
- Trading-partner mapping requirements for Cheney/PFG and other partners

Start read-only with inbound orders. Do not send acknowledgements, ASNs, invoices, or other outbound documents until SPS approves the test path.

## 3. Food Connex
Purpose: look up reference data, preview/create orders, and later read production/case/weight information if supported.

Ask CAI/Food Connex for:
- Confirmation that Circle R's account is authorized to use the Food Connex API
- Circle R client ID / tenant number
- Dedicated integration user credentials (recommended instead of a person's daily login)
- Sandbox/test client if available
- Exact production base URL and any account-specific restrictions/rate limits
- Confirmation of the endpoints available for order creation, case/weight data, inventory, shipment information, and pallet/container data

Food Connex's public beta API authenticates a user and returns a bearer token, so Lucid Core should request/refresh that token server-side rather than storing it in the browser.

## 4. QuickBooks Online
Purpose: accounting synchronization only after deciding which system is the accounting source of truth.

Needed:
- Intuit Developer account
- QuickBooks app with Accounting scope
- Client ID + Client Secret
- Redirect URI for Lucid Core
- Circle R QuickBooks admin to authorize the company once through OAuth 2.0
- Company/Realm ID returned during authorization

Do not create invoices from both Food Connex and Lucid Core. Decide the source-of-truth flow before enabling writes.

## 5. Microsoft 365 / SharePoint
Purpose: centralized archive and document search. This is optional for the core SPS ↔ Food Connex workflow.

Needed only when Circle R adopts Microsoft 365 Business / a work tenant:
- Microsoft Entra tenant ID
- App registration client ID + secret/certificate
- SharePoint site and document library chosen for Circle R Operations
- Least-privilege Graph permissions approved by the tenant admin
- Target site ID / drive ID / folder structure

The current personal Microsoft 365 Family account is not the target production SharePoint tenant.

## Recommended activation order
1. Shared database + secure auth
2. SPS read-only inbound order connection
3. Food Connex read-only lookups / preview
4. Approved Food Connex order-create test
5. Pallet/case/weight data feed
6. SPS ASN test
7. QuickBooks synchronization if still needed
8. SharePoint archival when Microsoft Business is adopted

Keep Safe Mode ON until each write path has an approved test record and rollback/duplicate protection.
