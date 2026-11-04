'use client';

import { useState } from 'react';
import { ScanCapture } from '@/components/scan-capture';
import { manualWeightReading, ZM303_STATION } from '@/lib/scanning/weight';
import type { NormalizedScanResult } from '@/lib/scanning/types';

export function HardwareDiagnostics({ organizationId, role }: { organizationId: string; role: string }) {
  const [scan, setScan] = useState<NormalizedScanResult | null>(null); const [manualWeight, setManualWeight] = useState('');
  if (role !== 'lucid_admin') return null;
  const reading = manualWeight ? manualWeightReading(Number(manualWeight)) : null;
  return <section className="surface hardware-diagnostics"><div><span className="kicker">Admin / QA hardware diagnostics</span><h2>Observe inputs without posting records</h2><p>No scanner, scale, or printer command is sent. Raw scans and manual diagnostic readings are not stored.</p></div><ScanCapture organizationId={organizationId} label="Capture a raw scanner payload" onResolved={setScan}/>{scan&&<dl><div><dt>Raw payload</dt><dd>{scan.rawValue}</dd></div><div><dt>Length</dt><dd>{scan.rawValue.length}</dd></div><div><dt>Controls</dt><dd>{[...scan.rawValue].filter(char=>char.charCodeAt(0)<32).map(char=>char.charCodeAt(0)===29?'FNC1/GS':'control').join(', ')||'None observed'}</dd></div><div><dt>Parser / resolver</dt><dd>{scan.blockingErrors[0]||scan.warnings[0]||scan.itemDescription||'No structured interpretation'}</dd></div></dl>}<div className="hardware-weight"><strong>Weight adapter</strong><span>{ZM303_STATION.indicatorFamily} · {ZM303_STATION.capacityLb} LB · {ZM303_STATION.intervalLb.toFixed(2)} LB interval · connection {ZM303_STATION.connection}</span><label>Manual diagnostic weight (LB)<input inputMode="decimal" value={manualWeight} onChange={event=>setManualWeight(event.target.value)} /></label>{reading&&<small>Normalized: {reading.netWeight} LB · {reading.source} · packaging adjusted only when physical zero is confirmed.</small>}</div><p className="muted-copy">Printer adapter: preview-only. No physical label print is available from diagnostics.</p></section>;
}
