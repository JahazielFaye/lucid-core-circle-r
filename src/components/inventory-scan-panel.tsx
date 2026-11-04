'use client';

import { useState } from 'react';
import { ScanCapture } from '@/components/scan-capture';
import type { NormalizedScanResult } from '@/lib/scanning/types';

export function InventoryScanPanel({ organizationId, onItemResolved }: { organizationId: string; onItemResolved?: (itemCode:string, uom?:string)=>void }) {
  const [result, setResult] = useState<NormalizedScanResult | null>(null);
  const handleResolved = (next: NormalizedScanResult) => { setResult(next); if (next.validationStatus !== 'blocked' && next.itemCode) onItemResolved?.(next.itemCode, next.uom); };
  return <section className="surface inventory-scan-panel"><div><span className="kicker">Inventory lookup</span><h2>Scan to find an item, lot, or case</h2><p>Matched items can populate the current draft receipt. Scanning never posts or adjusts inventory.</p></div><ScanCapture organizationId={organizationId} label="Scan an item identifier, lot, or case" onResolved={handleResolved}/>{result && <p className={result.validationStatus === 'blocked' ? 'master-data-error' : 'master-data-message'}>{result.blockingErrors[0] || result.warnings[0] || `✓ ${result.itemCode || result.matchedIdentifier || 'Identifier'} resolved`}{result.uom ? ` · ${result.uom}` : ''}{result.lot ? ` · Lot ${result.lot}` : ''}</p>}</section>;
}
