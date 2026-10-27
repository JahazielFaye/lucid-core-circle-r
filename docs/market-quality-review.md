# Lucid Core market / quality review — October 2026

## Products reviewed
- SPS Commerce Fulfillment: EDI order lifecycle, ASN, auto-send, and Orders at Risk.
- Wherefour: food manufacturing ERP, lot-level inventory, production, traceability, compliance document storage, APIs/webhooks.
- Odoo Inventory/Barcode: lot/serial scanning, GS1 barcode support, traceability and delivery reporting.
- MRPeasy: batch/lot traceability from material through production to customer shipment.
- Microsoft Teams: persistent 1:1/group chat, read receipts, forwarding.

## Features Lucid Core should borrow — without becoming another bloated ERP
1. **Order Readiness / At Risk** — one operational signal combining unresolved review, due date, incomplete pallets, missing shipment document, or missing final weight. This mirrors the useful part of SPS's Orders at Risk concept while using Circle R's actual workflow.
2. **Trace / Recall search** — search PO, Food Connex order, item, lot, case label, pallet or customer and see the chain from order → production → case → pallet → shipment. This is the highest-value new feature for a regulated food operation.
3. **Scan guardrails** — warn on duplicate case scans, wrong order/item, quantity overage, missing lot/weight, or a case already assigned to another pallet.
4. **Trading-partner checklist** — customer-specific shipment/document requirements before an ASN is considered ready.
5. **Persistent team messaging** — direct and team threads, unread counts, read receipts, forwarding and operational notifications.
6. **Audit-first edits** — users can correct records, but every correction is retained as history rather than silently overwriting the operational trail.
7. **Familiar output documents** — keep the physical/SPS document language (PO, Pallet Breakdown, Advance Ship Notice, Weight Report, BOL, Invoice) so adoption does not require relearning terminology.

## Deliberately not copying
- General-purpose task/project management features that do not relate to Circle R's order-to-shipment work.
- Full accounting/GL; QuickBooks should remain accounting system of record.
- Rebuilding the EDI network; SPS remains the trading-partner/compliance network.
- Direct scale/printer control until the current hardware interface is documented and tested.

## Architecture decision
Use Lucid Core as the orchestration/user layer. Use Postgres/Supabase for shared operational state, real-time messaging and authentication. Keep external systems behind adapters so SPS, Food Connex, QuickBooks, Microsoft/SharePoint or a future TMS can be replaced without rewriting the user-facing workflow.
