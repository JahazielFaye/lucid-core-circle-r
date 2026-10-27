# Lucid Core — Circle R Beef · Revision 11 / Working Beta

This revision turns the prototype into a more usable working beta while preserving **Safe Mode** for live SPS/Food Connex writes.

## Run
```bash
rm -rf node_modules .next package-lock.json
npm install
npm run dev
```
Open http://localhost:3000

## Prototype logins
- Crystal — 1111
- CJ / Production — 2222
- Mark — 3333
- Lucid Admin — 9999

## Revision 11 changes
- Wider one-line navigation grouped into Operations, Records & Growth, and Management.
- Cleaner reference-style top bar with search, message/notification/share affordances, avatar/account menu, and Admin workspace preview.
- Operational color psychology: **blue = orders/information**, **amber = needs review**, **green = ready/complete**, while Circle R red stays the primary brand/action color.
- Familiar printable records redesigned around the forms Circle R already uses:
  - Order / PO
  - Pallet Breakdown
  - Advance Ship Notice
  - Weight Report
  - Straight Bill of Lading
  - Customer Order Packet
- Documents area includes a familiar forms library with Print / Save PDF and downloadable print-ready HTML.
- Existing CRUD/edit/delete behavior remains for pallets, cases, exceptions, inventory and the 90-day-plan trackers.

## What is real now
The app is a functioning local beta: staff logins, role views, SPS CSV import, editable records, pallet building, report generation, audit history, and local persistence work now.

## What is intentionally NOT live yet
- SPS API transactions
- Food Connex API writes
- QuickBooks writes
- SharePoint uploads

Those require the client's authorized API/tenant credentials and should be connected only after sandbox/test validation. The integration adapters remain separated in `src/lib/integrations/` so those connections can be added without changing the staff UI.

## Revision 12 header tools
- Team Messages now works in the beta: private messages or an Everyone group chat.
- Notifications opens a live attention panel for unread messages and unresolved order reviews.
- Removed decorative Share / More buttons from the header to reduce clutter.
- Home status cards now use one semantic color each: blue Orders, amber Needs Review, green Ready to Ship.
- In the local beta, messages persist in this browser. Company-wide live messaging requires the shared production database/auth deployment described in the connection checklist.

## Revision 12 header tools
- Team Messages works in the beta: private messages or an Everyone group chat.
- Notifications opens a live attention panel for unread messages and unresolved order reviews.
- Decorative Share / More controls were removed to reduce clutter.
- Home status cards now use one semantic color each: blue Orders, amber Needs Review, green Ready to Ship.
- Local beta messages persist in this browser. Company-wide live messaging requires the shared production database/auth deployment described in the connection checklist.

## Going live
See `docs/connection-checklist.md` before enabling any external write connection. The next technical milestone is replacing browser-local storage with a shared database/auth layer, then connecting SPS read-only and Food Connex preview/read access before any production POST.

## Revision 13 additions
- Threaded private + Circle R team messaging
- Read receipts / delivered state
- Forward messages between threads
- Conversation inbox with unread counts
- Trace / Recall search module
- Supabase/Postgres production schema and RLS starter policies
- Database setup guide under `docs/database-setup.md`
- Market/quality review under `docs/market-quality-review.md`

The UI still falls back to local browser persistence until a Supabase project is connected. This is intentional so the beta remains runnable without production credentials.
