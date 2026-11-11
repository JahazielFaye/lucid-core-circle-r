/** Attach only after React mounts the video, and wait for playable frames before decoding. */
export function prepareCameraVideo(video: HTMLVideoElement, stream: MediaStream, signal: AbortSignal, timeoutMs = 8000): Promise<void> {
  return new Promise((resolve, reject) => {
    let playing = false;
    const events = ['loadedmetadata', 'loadeddata', 'canplay', 'playing', 'resize'];
    const finish = (error?: Error) => { clearTimeout(timeout); events.forEach(event => video.removeEventListener(event, check)); signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(); };
    const check = () => { if (playing && video.readyState >= 2 && video.videoWidth > 0 && video.videoHeight > 0) finish(); };
    const cancel = () => finish(new Error('Camera closed'));
    const timeout = setTimeout(() => finish(new Error('Camera preview timed out')), timeoutMs);
    if (signal.aborted) { cancel(); return; }
    events.forEach(event => video.addEventListener(event, check)); signal.addEventListener('abort', cancel, { once: true });
    video.muted = true; video.defaultMuted = true; video.playsInline = true; video.autoplay = true;
    video.setAttribute('playsinline', ''); video.setAttribute('muted', '');
    video.srcObject = stream;
    try { Promise.resolve(video.play()).then(() => { playing = true; check(); }, error => finish(error)); } catch (error) { finish(error instanceof Error ? error : new Error('Camera playback failed')); }
  });
}
