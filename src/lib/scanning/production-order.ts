import type { NormalizedScanResult } from './types';

export type ProductionScanLine = {
  id: string;
  nativeItemId?: string | null;
  itemCode?: string | null;
  externalSku?: string | null;
  uom?: string | null;
};

export type ProductionScanResolution =
  | { line: ProductionScanLine; error?: never }
  | { line?: never; error: string };

/**
 * Confirms an already-resolved scan belongs to exactly one production line.
 * This is deliberately exact-only: it never selects a similarly named item or
 * guesses a UOM from an ambiguous order.
 */
export function resolveProductionOrderLine(scan: NormalizedScanResult, lines: ProductionScanLine[]): ProductionScanResolution {
  if (scan.validationStatus === 'blocked' || !scan.itemCode) {
    return { error: scan.blockingErrors[0] || 'That item could not be recognized.' };
  }

  let matches = lines.filter(line =>
    (scan.itemId && line.nativeItemId === scan.itemId) ||
    line.itemCode === scan.itemCode ||
    line.externalSku === scan.itemCode,
  );

  if (scan.uom) matches = matches.filter(line => line.uom === scan.uom);
  if (matches.length === 0) return { error: `${scan.itemDescription || scan.itemCode} is not on this production order.` };
  if (matches.length > 1) {
    return { error: 'This item appears on more than one order line. Scan a UOM-specific identifier or select the line directly.' };
  }
  return { line: matches[0] };
}
