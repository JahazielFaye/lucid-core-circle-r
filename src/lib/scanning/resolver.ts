import { isValidGtin, parseGs1 } from './gs1';
import type { NormalizedScanResult, ScanSource } from './types';

export type ResolvableIdentifier = { item_id: string; identifier_type: string; identifier_value: string; uom: string | null; verified: boolean; status: string; source_system?: string | null; item?: { item_code: string; description: string; status: string } | null };

export function resolveIdentifier(rawValue: string, scanSource: ScanSource, identifiers: ResolvableIdentifier[]): NormalizedScanResult {
  if (rawValue.length > 512) return { rawValue: rawValue.slice(0, 512), scanSource, warnings: [], blockingErrors: ['Barcode payload is too long.'], validationStatus: 'blocked' };
  const raw = rawValue.trim(); const parsed = parseGs1(raw);
  const candidateValues = [raw, parsed?.itemIdentifier].filter((value): value is string => Boolean(value));
  const matches = identifiers.filter(identifier => identifier.status === 'active' && identifier.item?.status !== 'inactive' && candidateValues.includes(identifier.identifier_value));
  const base: NormalizedScanResult = { rawValue, scanSource, lot: parsed?.lot, serial: parsed?.serial, weight: parsed?.netWeight, weightUom: parsed?.weightUom, packDate: parsed?.packDate, sscc: parsed?.sscc, warnings: [...(parsed?.warnings || [])], blockingErrors: [], validationStatus: 'unknown' };
  if (!raw) return { ...base, blockingErrors: ['Barcode not recognized.'], validationStatus: 'blocked' };
  if (matches.length === 0) return { ...base, blockingErrors: ['Barcode not recognized.'], validationStatus: 'blocked' };
  const uniqueItems = new Set(matches.map(match => `${match.item_id}:${match.uom || ''}`));
  if (uniqueItems.size > 1) return { ...base, blockingErrors: ['Barcode matches more than one active item or UOM. Choose the correct item.'], validationStatus: 'blocked' };
  const match = matches[0]; const sourceAlias = (match.identifier_type === 'gtin' || match.identifier_type === 'upc') && !isValidGtin(match.identifier_value);
  const warnings = sourceAlias ? [...base.warnings, 'Source alias matched — not standards-validated GTIN.'] : base.warnings;
  return { ...base, matchedIdentifier: match.identifier_value, identifierType: match.identifier_type, identifierProvenance: sourceAlias ? 'legacy_source_alias' : 'native', itemId: match.item_id, itemCode: match.item?.item_code, itemDescription: match.item?.description, uom: match.uom || undefined, warnings, validationStatus: warnings.length ? 'warning' : 'accepted' };
}
