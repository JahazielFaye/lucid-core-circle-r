# Lucid Core Architecture

## Principle
Lucid Core is the orchestration hub. Vendor systems sit at the edges.

### Systems of record initially
- SPS Commerce: EDI/trading-partner network.
- Food Connex: production, inventory, catch-weight, scanning/label workflows.
- QuickBooks: accounting.
- Microsoft/SharePoint: future centralized document archive and collaboration layer.

### Lucid Core owns
- Unified order model.
- Mapping tables.
- Duplicate protection.
- Exception management.
- Palletization.
- Shipment readiness.
- Integration audit logs.
- Cross-system status.

## Common data model
Do not hard-wire SPS fields directly to Food Connex everywhere. Normalize into Lucid Core first.

SPS -> Lucid Order -> Food Connex
Food Connex case data -> Lucid Pallet/Shipment -> SPS ASN
Lucid completed packet -> SharePoint
Lucid invoice status -> QuickBooks/SPS as approved

## Safety
- No production POST/PUT calls until sandbox or approved test transaction.
- Store secrets only in environment/secret manager.
- Every automated write must be idempotent and logged.
- Exceptions stop automation and require an authorized human decision.
