# Lucid Core shared database setup (Supabase/Postgres)

This revision includes the production database schema, but it intentionally does **not** contain Circle R credentials.

## Why Supabase for this project
- PostgreSQL for durable operational records and audit history.
- Auth for real user accounts.
- Realtime for messages, read receipts, dashboards and live pallet updates.
- Row Level Security so Circle R data and role permissions are enforced at the database layer.
- Storage can later hold generated reports before SharePoint sync.

## Setup
1. Create a Supabase project owned by the Circle R/Lucid deployment account.
2. Open SQL Editor and run `supabase/migrations/001_lucid_core.sql`.
3. In Authentication, create/invite the four initial users using real work email addresses.
4. Create one organization row for Circle R Beef and create matching `profiles` rows for each auth user.
5. Copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
6. Never put a Supabase secret/service key in browser code.
7. Start with the database in staging. Import test/historical records before live SPS/Food Connex writes are enabled.

## Next implementation step
Replace the prototype PIN login and localStorage persistence with Supabase Auth + table reads/writes. The schema is intentionally normalized around orders, lines, pallets, cases, exceptions, documents, messages/read receipts, and audit events so the app can migrate module by module without a rewrite.
