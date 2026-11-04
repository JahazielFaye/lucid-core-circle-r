'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Keyboard, ScanLine, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { resolveIdentifier, type ResolvableIdentifier } from '@/lib/scanning/resolver';
import type { NormalizedScanResult, ScanSource } from '@/lib/scanning/types';
import { isDuplicateScan, shouldQueueNoSuffixScan } from '@/lib/scanning/capture-guard';

type Props = { organizationId: string; onResolved: (result: NormalizedScanResult) => void; label?: string; allowCamera?: boolean; className?: string };
type BarcodeDetectorInstance = { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue: string; format?: string }>> };
type BarcodeDetectorConstructor = new (options?: unknown) => BarcodeDetectorInstance;

/** A single capture surface for keyboard-wedge scanners, camera reads, and manual entry. */
export function ScanCapture({ organizationId, onResolved, label = 'Scan or enter barcode', allowCamera = true, className = '' }: Props) {
  const supabase = useMemo(() => createClient(), []); const input = useRef<HTMLInputElement>(null); const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null); const timer = useRef<number | null>(null); const detector = useRef<{ stop: () => void } | null>(null); const lastKeyAt = useRef(0); const rapidCharacters = useRef(0); const recentScan = useRef<{ value:string; at:number } | null>(null);
  const [value, setValue] = useState(''); const [identifiers, setIdentifiers] = useState<ResolvableIdentifier[]>([]); const [message, setMessage] = useState(''); const [cameraOpen, setCameraOpen] = useState(false); const [torchSupported, setTorchSupported] = useState(false); const [torchEnabled, setTorchEnabled] = useState(false);
  useEffect(() => { let current = true; void (async () => {
    const [identifierResult, itemResult] = await Promise.all([
      supabase.from('item_identifiers').select('item_id,identifier_type,identifier_value,uom,verified,status,source_system,items(item_code,description,status)').eq('organization_id', organizationId),
      supabase.from('items').select('id,item_code,description,status').eq('organization_id', organizationId).eq('status', 'active'),
    ]);
    if (!current || identifierResult.error || itemResult.error) return;
    const configured = (identifierResult.data || []).map(row => ({ ...row, item: Array.isArray(row.items) ? row.items[0] : row.items })) as ResolvableIdentifier[];
    const nativeCodes: ResolvableIdentifier[] = (itemResult.data || []).map(item => ({
      item_id: item.id,
      identifier_type: 'internal_item_code',
      identifier_value: item.item_code,
      uom: null,
      verified: true,
      status: 'active',
      source_system: 'lucid_core',
      item: { item_code: item.item_code, description: item.description, status: item.status },
    }));
    setIdentifiers([...configured, ...nativeCodes]);
  })(); return () => { current = false; }; }, [organizationId, supabase]);
  const cancelQueuedCompletion = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  const complete = (raw: string, source: ScanSource) => { cancelQueuedCompletion(); const now = Date.now(); if (isDuplicateScan(recentScan.current, raw, now)) return resolveIdentifier(raw, source, identifiers); recentScan.current = { value: raw, at: now }; const result = resolveIdentifier(raw, source, identifiers); setMessage(result.blockingErrors[0] || result.warnings[0] || (result.validationStatus === 'accepted' ? '✓ Item accepted' : '')); onResolved(result); return result; };
  const queueCompletion = (nextValue: string) => { if (!shouldQueueNoSuffixScan(rapidCharacters.current)) return; if (timer.current) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (nextValue.trim()) complete(nextValue, 'physical_scanner'); }, 180); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); if (timer.current) window.clearTimeout(timer.current); complete(value, 'physical_scanner'); return; } if (event.key.length === 1) { const now = performance.now(); rapidCharacters.current = now - lastKeyAt.current < 90 ? rapidCharacters.current + 1 : 1; lastKeyAt.current = now; } };
  const closeCamera = () => { detector.current?.stop(); detector.current = null; stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setTorchSupported(false); setTorchEnabled(false); setCameraOpen(false); window.setTimeout(() => input.current?.focus(), 0); };
  const toggleTorch = async () => { const track = stream.current?.getVideoTracks()[0] as (MediaStreamTrack & { applyConstraints?:(constraints:MediaTrackConstraints)=>Promise<void> }) | undefined; const capabilities = (track?.getCapabilities?.() as { torch?:boolean } | undefined); if (!capabilities?.torch || !track?.applyConstraints) return; try { await track.applyConstraints({ advanced: [{ torch: !torchEnabled } as MediaTrackConstraintSet] }); setTorchEnabled(current => !current); } catch { setMessage('Torch control is unavailable for this camera.'); } };
  useEffect(() => () => { cancelQueuedCompletion(); detector.current?.stop(); stream.current?.getTracks().forEach(track => track.stop()); }, []);
  const openCamera = async () => {
    if (!('mediaDevices' in navigator) || !navigator.mediaDevices.getUserMedia) { setMessage('Camera scanning is unavailable. Use the manual field or a physical scanner.'); return; }
    try { const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }); stream.current = next; const track = next.getVideoTracks()[0]; setTorchSupported(Boolean((track?.getCapabilities?.() as { torch?:boolean } | undefined)?.torch)); setCameraOpen(true); window.setTimeout(async () => { if (!video.current) return; video.current.srcObject = next; await video.current.play(); const BarcodeDetectorApi = (window as unknown as { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector; if (!BarcodeDetectorApi) { try { const { BrowserMultiFormatReader } = await import('@zxing/browser'); const reader = new BrowserMultiFormatReader(); const controls = await reader.decodeFromVideoDevice(undefined, video.current, result => { if (!result) return; const resolved = complete(result.getText(), 'phone_camera'); if (navigator.vibrate) navigator.vibrate(40); if (resolved.validationStatus !== 'blocked') closeCamera(); }); detector.current = { stop: () => controls.stop() }; setMessage('Using the compatible camera scanner. Nothing is saved or uploaded.'); } catch { setMessage('Camera decoding is unavailable in this browser. Use the manual field or a physical scanner.'); } return; } const scanner = new BarcodeDetectorApi({ formats: ['code_128', 'code_39', 'ean_13', 'ean_8', 'upc_a', 'upc_e', 'qr_code', 'data_matrix'] }); let stopped = false; detector.current = { stop: () => { stopped = true; } }; const read = async () => { if (stopped || !video.current) return; try { const found = await scanner.detect(video.current); if (found[0]?.rawValue) { const result = complete(found[0].rawValue, 'phone_camera'); if (navigator.vibrate) navigator.vibrate(40); if (result.validationStatus !== 'blocked') { closeCamera(); return; } } } catch { /* Continue until closed; camera APIs can reject while the element warms up. */ } window.setTimeout(read, 220); }; void read(); }, 0); } catch { setMessage('Camera permission was not granted. Use the manual field or a physical scanner.'); }
  };
  return <div className={`scan-capture ${className}`}><label><span>{label}</span><input ref={input} value={value} onChange={event => { setValue(event.target.value); queueCompletion(event.target.value); }} onKeyDown={onKeyDown} placeholder="Scan or enter identifier" autoComplete="off" /></label><button type="button" className="secondary" onClick={() => { cancelQueuedCompletion(); complete(value, 'manual'); }}><Keyboard size={16}/> Use entry</button>{allowCamera && <button type="button" className="secondary" onClick={() => void openCamera()}><Camera size={16}/> Scan</button>}{message && <p role="status" className={message.startsWith('✓') ? 'scan-feedback success' : 'scan-feedback'}>{message}</p>}{cameraOpen && <div className="scan-camera-backdrop" role="presentation"><section className="scan-camera" role="dialog" aria-modal="true" aria-label="Camera barcode scanner"><header><strong>Scan barcode</strong><button type="button" className="icon-button" onClick={closeCamera} aria-label="Close camera scanner"><X size={18}/></button></header><video ref={video} muted playsInline /><p>Point the rear camera at the barcode. Nothing is saved or uploaded.</p>{torchSupported&&<button type="button" className="secondary" onClick={()=>void toggleTorch()}>{torchEnabled?'Turn torch off':'Turn torch on'}</button>}<button type="button" className="secondary" onClick={closeCamera}>Use manual entry instead</button></section></div>}</div>;
}
