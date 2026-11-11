'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Keyboard, X } from 'lucide-react';
import { createClient } from '@/utils/supabase/client';
import { resolveIdentifier, type ResolvableIdentifier } from '@/lib/scanning/resolver';
import type { NormalizedScanResult, ScanSource } from '@/lib/scanning/types';
import { cameraDecodeHints, selectCode128Detector, type CameraDetectorConstructor } from '@/lib/scanning/camera-decoder';
import { parseGs1 } from '@/lib/scanning/gs1';
import { prepareCameraVideo } from '@/lib/scanning/camera-video';
import { isDuplicateScan, shouldQueueNoSuffixScan } from '@/lib/scanning/capture-guard';

type Props = { organizationId: string; onResolved?: (result: NormalizedScanResult) => void; onRawCapture?: (rawValue: string, source: ScanSource) => boolean; label?: string; allowCamera?: boolean; className?: string };
/** A single capture surface for keyboard-wedge scanners, camera reads, and manual entry. */
export function ScanCapture({ organizationId, onResolved, onRawCapture, label = 'Scan or enter barcode', allowCamera = true, className = '' }: Props) {
  const supabase = useMemo(() => createClient(), []); const input = useRef<HTMLInputElement>(null); const video = useRef<HTMLVideoElement>(null); const stream = useRef<MediaStream | null>(null); const timer = useRef<number | null>(null); const detector = useRef<{ stop: () => void } | null>(null); const lastKeyAt = useRef(0); const rapidCharacters = useRef(0); const recentScan = useRef<{ value:string; at:number } | null>(null);
  const cameraRun = useRef(0); const capture = useRef<(raw: string) => void>(() => {});
  const [decoderInfo, setDecoderInfo] = useState('Decoder inactive');
  const [cameraResult, setCameraResult] = useState('');
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null); const [cameraError, setCameraError] = useState(false); const [cameraMessage, setCameraMessage] = useState('Starting camera…');
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
  const complete = (raw: string, source: ScanSource) => {
    cancelQueuedCompletion();
    // Source serials are not Lucid case identities. Do not send the full GS1
    // payload to a case mutation callback, including during duplicate cooldown.
    if (onRawCapture && parseGs1(raw.trim())) {
      const rejected = { ...resolveIdentifier(raw, source, identifiers), validationStatus: 'blocked' as const, blockingErrors: ['GS1 source label decoded. This workflow requires a configured case-ID mapping; use the Lucid case identifier.'] };
      setMessage(rejected.blockingErrors[0]); return rejected;
    }
    const now = Date.now();
    if (isDuplicateScan(recentScan.current, raw, now)) return resolveIdentifier(raw, source, identifiers);
    recentScan.current = { value: raw, at: now };
    if (onRawCapture?.(raw.trim(), source)) { setValue(''); setMessage('✓ Scan captured'); return { validationStatus: 'accepted' } as NormalizedScanResult; }
    const result = resolveIdentifier(raw, source, identifiers);
    setMessage(result.blockingErrors[0] || result.warnings[0] || (result.validationStatus === 'accepted' ? '✓ Item accepted' : ''));
    onResolved?.(result); return result;
  };
  const queueCompletion = (nextValue: string) => { if (!shouldQueueNoSuffixScan(rapidCharacters.current)) return; if (timer.current) window.clearTimeout(timer.current); timer.current = window.setTimeout(() => { if (nextValue.trim()) complete(nextValue, 'physical_scanner'); }, 180); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === 'Enter' || event.key === 'Tab') { event.preventDefault(); if (timer.current) window.clearTimeout(timer.current); complete(value, 'physical_scanner'); return; } if (event.key.length === 1) { const now = performance.now(); rapidCharacters.current = now - lastKeyAt.current < 90 ? rapidCharacters.current + 1 : 1; lastKeyAt.current = now; } };
  const closeCamera = () => { cameraRun.current++; setCameraStream(null); if (video.current) video.current.srcObject = null; detector.current?.stop(); detector.current = null; stream.current?.getTracks().forEach(track => track.stop()); stream.current = null; setTorchSupported(false); setTorchEnabled(false); setCameraOpen(false); window.setTimeout(() => input.current?.focus(), 0); };
  const toggleTorch = async () => { const track = stream.current?.getVideoTracks()[0] as (MediaStreamTrack & { applyConstraints?:(constraints:MediaTrackConstraints)=>Promise<void> }) | undefined; const capabilities = (track?.getCapabilities?.() as { torch?:boolean } | undefined); if (!capabilities?.torch || !track?.applyConstraints) return; try { await track.applyConstraints({ advanced: [{ torch: !torchEnabled } as MediaTrackConstraintSet] }); setTorchEnabled(current => !current); } catch { setMessage('Torch control is unavailable for this camera.'); } };
  useEffect(() => () => { cameraRun.current++; cancelQueuedCompletion(); detector.current?.stop(); stream.current?.getTracks().forEach(track => track.stop()); }, []);
  capture.current = raw => { const result = complete(raw, 'phone_camera'); if (result.validationStatus === 'blocked') setCameraResult(`Barcode decoded but rejected: ${result.blockingErrors[0] || 'No matching identifier.'}`); if (navigator.vibrate) navigator.vibrate(40); if (result.validationStatus !== 'blocked') closeCamera(); };
  useEffect(() => {
    if (!cameraStream || !video.current) return;
    const element = video.current; const abort = new AbortController(); let controls: { stop: () => void } | null = null; let poll: ReturnType<typeof setTimeout> | undefined;
    const run = cameraRun.current;
    const active = () => !abort.signal.aborted && cameraRun.current === run;
    const fallback = async (reason = 'Native Code 128 unavailable or unsupported') => {
      const [{ BrowserMultiFormatReader }, { NotFoundException, ChecksumException, FormatException }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
      if (!active()) return;
      let attempts = 0; let failed = false;
      setDecoderInfo(`Compatible scanner · Code 128 / GS1-128 · ${reason}`);
      setCameraMessage('Compatible decoder active · Code 128 / GS1-128. Looking for a barcode…');
      // Decode the existing stream; never request a second camera.
      const next = await new BrowserMultiFormatReader(cameraDecodeHints(), { delayBetweenScanAttempts: 150, delayBetweenScanSuccess: 700 }).decodeFromStream(cameraStream, element, (result, error) => {
        if (!active()) return;
        attempts++;
        if (result) { capture.current(result.getText()); return; }
        if (error && !(error instanceof NotFoundException || error instanceof ChecksumException || error instanceof FormatException)) {
          failed = true; setCameraError(true); setCameraMessage('Decoder inactive: frame decoding failed. Retry the camera or use manual entry.'); controls?.stop(); return;
        }
        if (attempts === 1 || attempts % 20 === 0) setCameraMessage(`Compatible decoder active · Code 128 / GS1-128 · ${attempts} frames checked · no barcode detected. Keep the entire barcode in focus.`);
      });
      if (!active() || failed) next.stop(); else controls = next;
    };
    const start = async () => {
      let previewReady = false;
      try {
        await prepareCameraVideo(element, cameraStream, abort.signal);
        previewReady = true;
        if (!active()) return;
        const Native = (window as unknown as { BarcodeDetector?: CameraDetectorConstructor }).BarcodeDetector;
        const scanner = await selectCode128Detector(Native);
        if (!active()) return;
        if (!scanner) { await fallback(); return; }
        setDecoderInfo('Native scanner · Code 128 support verified');
        setCameraMessage('Native decoder active · Code 128 supported. Looking for a barcode…');
        let attempts = 0;
        let failures = 0;
        const read = async () => {
          if (!active()) return;
          try { const found = await scanner.detect(element); failures = 0; attempts++; if (active() && found[0]?.rawValue) capture.current(found[0].rawValue); else if (active() && attempts >= 20) { await fallback('Native scanner returned no result'); return; } else if (active() && attempts === 1) setCameraMessage('Native decoder active · no barcode detected. Compatible fallback starts if needed.'); }
          catch { if (++failures >= 3) { try { await fallback('Native frame decoding failed'); } catch { if (active()) { setCameraError(true); setCameraMessage('Barcode decoding failed. Retry the camera or use manual entry.'); } } return; } }
          if (active()) poll = setTimeout(read, 220);
        };
        void read();
      } catch { if (active()) { setCameraError(true); setCameraMessage(previewReady ? 'Barcode decoding failed. Retry the camera or use manual entry.' : 'Camera preview could not start. Retry the camera or use manual entry.'); } }
    };
    void start();
    return () => { abort.abort(); clearTimeout(poll); controls?.stop(); };
  }, [cameraStream]);
  const openCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) { setMessage('Camera scanning is unavailable. Use manual entry or a physical scanner.'); return; }
    const run = ++cameraRun.current; setCameraOpen(true); setCameraError(false); setCameraResult(''); setDecoderInfo('Decoder inactive · waiting for playable video'); setCameraMessage('Starting camera…');
    try {
      const next = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
      if (cameraRun.current !== run) { next.getTracks().forEach(track => track.stop()); return; }
      stream.current = next; setCameraStream(next);
      setTorchSupported(Boolean((next.getVideoTracks()[0]?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch));
    } catch (error) { if (cameraRun.current === run) { setCameraError(true); setCameraMessage(error instanceof DOMException && error.name === 'NotAllowedError' ? 'Camera access was denied. Use manual entry or allow camera access.' : 'Camera could not open. Retry the camera or use manual entry.'); } }
  };
  return <div className={`scan-capture ${className}`}><label><span>{label}</span><input ref={input} value={value} onChange={event => { setValue(event.target.value); queueCompletion(event.target.value); }} onKeyDown={onKeyDown} placeholder="Scan or enter identifier" autoComplete="off" /></label><button type="button" className="secondary" onClick={() => { cancelQueuedCompletion(); complete(value, 'manual'); }}><Keyboard size={16}/> Use entry</button>{allowCamera && <button type="button" className="secondary" onClick={() => void openCamera()}><Camera size={16}/> Scan</button>}{message && <p role="status" className={message.startsWith('✓') ? 'scan-feedback success' : 'scan-feedback'}>{message}</p>}{cameraOpen && <div className="scan-camera-backdrop" role="presentation"><section className="scan-camera" role="dialog" aria-modal="true" aria-label="Camera barcode scanner"><header><strong>Scan barcode</strong><button type="button" className="icon-button" onClick={closeCamera} aria-label="Close camera scanner"><X size={18}/></button></header><video ref={video} muted playsInline autoPlay /><p>{decoderInfo}</p><p role="status">{cameraMessage}</p>{cameraResult && <p role="alert">{cameraResult}</p>}{cameraError && <button type="button" className="secondary" onClick={() => { closeCamera(); void openCamera(); }}>Retry camera</button>}<p>Point the rear camera at the barcode. Nothing is saved or uploaded.</p>{torchSupported&&<button type="button" className="secondary" onClick={()=>void toggleTorch()}>{torchEnabled?'Turn torch off':'Turn torch on'}</button>}<button type="button" className="secondary" onClick={closeCamera}>Use manual entry instead</button></section></div>}</div>;
}
