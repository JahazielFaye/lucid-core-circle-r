# Familiar printable records

Revision 11 intentionally keeps Circle R's existing document language and approximate field order rather than inventing new form names.

Reference packet used for the design:
- Advance Ship Notice: customer/vendor header, shipment metadata, location/container/item/quantity rows.
- PO Acknowledgement / Order: dense SPS-style line table with SKU, vendor item, description, quantity/UOM and price.
- Pallet Breakdown: PO number, order number, pallet rows, item / quantity (cases), loaded-by line.
- Weight Report: detailed case/item/weight list.
- Straight Bill of Lading: ship-from, ship-to, PO/BOL, handling units, commodity summary and signatures.

The app generates cleaner digital versions while preserving familiar names and information hierarchy.
