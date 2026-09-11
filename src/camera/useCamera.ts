import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Camera acquisition, and the single source of frames for the detector.
 *
 * CAPTURE vs DISPLAY — the important structural point.
 *
 * There is exactly ONE getUserMedia call and ONE MediaStream for the whole app.
 * That stream is consumed in two different ways:
 *
 *  - CAPTURE: one hidden <video> owned by this hook, mounted once at app level
 *    and never unmounted. `grabFrame` always reads from this element, so frame
 *    capture is completely independent of which screen is showing. That removes
 *    a whole class of "which video is currently live" bugs.
 *
 *  - DISPLAY: each screen attaches its own <video> to the SAME stream via
 *    useStreamVideo. Multiple video elements can share one MediaStream; this
 *    costs a little compositing but no extra camera access and no second
 *    detection pipeline.
 *
 * The capture element is deliberately visually hidden rather than
 * `display: none`. A display-none video is not guaranteed to keep decoding
 * frames, which would silently starve the detector. Kept at 1px and fully
 * transparent, it is still laid out and still produces frames.
 */

export type CameraStatus =
  | 'idle'
  | 'requesting'
  | 'live'
  | 'denied'
  | 'no-device'
  | 'insecure-context'
  | 'unsupported'
  | 'error';

export interface CameraState {
  status: CameraStatus;
  message: string;
  frameWidth: number;
  frameHeight: number;
}

export function useCamera() {
  /** The hidden capture element. Mount this once, at app level. */
  const captureVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [stream, setStream] = useState<MediaStream | null>(null);
  const [state, setState] = useState<CameraState>({
    status: 'idle',
    message: 'Camera not started.',
    frameWidth: 0,
    frameHeight: 0,
  });

  const start = useCallback(async () => {
    // Already live — starting again would acquire a second stream for nothing.
    if (streamRef.current) return;

    if (!window.isSecureContext) {
      setState({
        status: 'insecure-context',
        message:
          'Camera needs a secure context. Use http://localhost rather than a LAN IP, or serve over HTTPS.',
        frameWidth: 0,
        frameHeight: 0,
      });
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setState({
        status: 'unsupported',
        message: 'This browser does not expose getUserMedia.',
        frameWidth: 0,
        frameHeight: 0,
      });
      return;
    }

    setState((s) => ({ ...s, status: 'requesting', message: 'Awaiting camera permission…' }));

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'environment' },
        audio: false,
      });
      streamRef.current = media;

      const video = captureVideoRef.current;
      if (!video) throw new Error('Capture video element not mounted.');
      video.srcObject = media;
      await video.play();
      await waitForDimensions(video);

      setStream(media);
      setState({
        status: 'live',
        message: 'Camera live.',
        frameWidth: video.videoWidth,
        frameHeight: video.videoHeight,
      });
    } catch (err) {
      setState({ ...classifyError(err), frameWidth: 0, frameHeight: 0 });
    }
  }, []);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (captureVideoRef.current) captureVideoRef.current.srcObject = null;
    setStream(null);
    setState({ status: 'idle', message: 'Camera stopped.', frameWidth: 0, frameHeight: 0 });
  }, []);

  /** Current frame from the CAPTURE element, into a reused offscreen canvas. */
  const grabFrame = useCallback((): HTMLCanvasElement | null => {
    const video = captureVideoRef.current;
    if (!video || video.videoWidth === 0) return null;

    let canvas = canvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvasRef.current = canvas;
    }
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas;
  }, []);

  // Release the camera if the app unmounts while live.
  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { captureVideoRef, stream, state, start, stop, grabFrame };
}

/**
 * Attach a shared MediaStream to a display-only <video>.
 *
 * Each screen calls this for its own element. No getUserMedia here — the stream
 * is already owned by useCamera.
 */
export function useStreamVideo(stream: MediaStream | null) {
  const ref = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;

    if (video.srcObject !== stream) video.srcObject = stream;
    if (stream) {
      // Autoplay of a muted, user-initiated stream is permitted, but the promise
      // can still reject on rapid mount/unmount. Not worth surfacing.
      video.play().catch(() => {});
    }
  }, [stream]);

  return ref;
}

function waitForDimensions(video: HTMLVideoElement): Promise<void> {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const onReady = () => {
      video.removeEventListener('loadedmetadata', onReady);
      resolve();
    };
    video.addEventListener('loadedmetadata', onReady);
  });
}

function classifyError(err: unknown): { status: CameraStatus; message: string } {
  const name = (err as DOMException)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        status: 'denied',
        message: 'Camera permission denied. Grant it in the address bar, then retry.',
      };
    case 'NotFoundError':
    case 'OverconstrainedError':
      return { status: 'no-device', message: 'No camera found.' };
    case 'NotReadableError':
      return {
        status: 'error',
        message: 'Camera is in use by another app (Zoom, Teams, OBS). Close it and retry.',
      };
    default:
      return {
        status: 'error',
        message: `Camera failed: ${(err as Error)?.message ?? String(err)}`,
      };
  }
}
