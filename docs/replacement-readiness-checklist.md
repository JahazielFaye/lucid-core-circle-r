# Lucid Core replacement-readiness checklist

## Cutover prerequisites

- Apply migrations `013` through `016` in numeric order and run each migration's verification query.
- Confirm one authorized account for each operational role: production, office, leadership, and Lucid admin.
- Import Food Connex history through `integration_import_batches` using `source_system = 'food_connex'`, source record IDs, and `is_historical = true`; do not overwrite Lucid-native records.
- Reconcile imported customers, ship-tos, items, open orders, lots, cases, pallets, shipments, and invoice references against Food Connex totals before declaring cutover.
- Confirm the trace screen can follow a legacy record by text/provenance and a Lucid-native record by its durable relationships.
- Confirm all active operational work uses Lucid workflows; retain Food Connex read access until reconciliation is signed off.

## Operational acceptance

- Receipt: create draft receipt, verify lot and line, then post. Posted history must reject edits/deletes.
- Production: create a run, record source-lot consumption and output, then link an existing production case.
- Fulfillment: complete a pallet, create shipment, add exactly cases or pallets, then complete shipment with optional invoice-reference fields.
- Corrections: use removal/reopen/reversal status history; do not hard-delete operational records.
- Labels: verify no GTIN, GS1, SSCC, or serial data is created unless an authoritative source has been configured.

## Intentionally external

- Physical scale, scanner, and printer hardware.
- GS1, SSCC, and ASN transmission rules.
- QuickBooks invoice/AR synchronization; Lucid stores reference boundaries only.
- Food Connex historical extraction and file mapping, pending a validated export contract.
