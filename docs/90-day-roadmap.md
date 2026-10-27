# 90-Day Technical Roadmap

## Phase 1 — Order Bridge
- Parse SPS 850 order data.
- Normalize to Lucid order model.
- Map customer, ship-to, item, UOM.
- Detect price/quantity/date exceptions.
- Generate Food Connex preview.
- After approval: create Food Connex orders through supported API.

## Phase 2 — Pallets & Shipping
- Read/receive case-level production data where supported.
- Native Lucid pallet builder.
- Case -> pallet assignment.
- Weight/lot/item rollup.
- Shipment-ready validation.

## Phase 3 — ASN / Invoice / Documents
- Generate SPS ASN payload from Lucid shipment.
- Connect invoice workflow only after shipment is reliable.
- Archive completed order packet to SharePoint when Microsoft Business is adopted.
- Evaluate QuickBooks direct integration versus retaining Food Connex accounting handoff.

## Parallel research
- Exact scale models and connection method.
- Scanner behavior/protocol.
- Label printer/workstation integration.
- Food Connex API entitlement and sandbox.
- SPS Transaction API entitlement.
