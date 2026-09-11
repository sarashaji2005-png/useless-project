import { useCallback, useEffect, useRef, useState } from 'react';
import { useStreamVideo } from '../camera/useCamera';
import type { Point } from '../models/types';

/**
 * The shared video-plus-canvas stage.
 *
 * All the fiddly parts live here exactly once: device-pixel-ratio scaling,
 * frame→display coordinate conversion, resize handling, and click mapping back
 * into frame space. Both screens' overlays are then just draw functions.
 *
 * Redraw strategy differs by screen, hence `animate`:
 *   - Screen 1 redraws when data changes (~1.5Hz). Running a 60fps loop to
 *     redraw identical content would waste CPU the detector needs.
 *   - Screen 2 needs a real animation loop for the roaming eye, so it opts in.
 */

export interface StageDims {
  /** Canvas size in CSS pixels. */
  cssW: number;
  cssH: number;
  /** Source frame size in frame pixels. */
  frameW: number;
  frameH: number;
  /** frame → display scale factor. */
  k: number;
  /** frame → display converters. Use these for everything drawn. */
  X: (v: number) => number;
  Y: (v: number) => number;
  /** Milliseconds since the stage mounted. For time-based effects like pulses. */
  nowMs: number;
}

export type StageDraw = (ctx: CanvasRenderingContext2D, dims: StageDims) => void;

interface Props {
  stream: MediaStream | null;
  frameWidth: number;
  frameHeight: number;
  /** When set, this still is drawn instead of the live video. */
  frozenFrame?: HTMLCanvasElement | null;
  draw: StageDraw;
  /** True to run a requestAnimationFrame loop. */
  animate?: boolean;
  onPick?: (framePoint: Point) => void;
  cursor?: string;
  title?: string;
}

export function LiveStage({
  stream,
  frameWidth,
  frameHeight,
  frozenFrame = null,
  draw,
  animate = false,
  onPick,
  cursor,
  title,
}: Props) {
  const videoRef = useStreamVideo(stream);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const mountedAt = useRef(performance.now());

  // Held in a ref so the animation loop always calls the latest draw without
  // being torn down and restarted on every data change.
  const drawRef = useRef(draw);
  drawRef.current = draw;

  /**
   * Redraw trigger for size changes, which happen outside React's knowledge.
   * Two cases need it: window resize, and this stage being hidden and shown
   * again by the router — `hidden` collapses the container to zero width, and
   * without a resize signal nothing would restore the canvas on return.
   */
  const [sizeTick, setSizeTick] = useState(0);

  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const cssW = wrap.clientWidth;
    // Hidden, or not yet laid out. Bail rather than size the canvas to zero.
    if (cssW <= 0) return;

    const aspect = frameWidth > 0 ? frameHeight / frameWidth : 9 / 16;
    const cssH = cssW * aspect;
    const dpr = window.devicePixelRatio || 1;

    const wantW = Math.round(cssW * dpr);
    const wantH = Math.round(cssH * dpr);
    // Only resize when it actually changed — assigning width/height resets the
    // whole context, which is wasteful to do every frame.
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (frozenFrame) {
      ctx.drawImage(frozenFrame, 0, 0, cssW, cssH);
      ctx.fillStyle = 'rgba(11,15,25,0.35)';
      ctx.fillRect(0, 0, cssW, cssH);
    }

    const k = frameWidth > 0 ? cssW / frameWidth : 1;
    drawRef.current(ctx, {
      cssW,
      cssH,
      frameW: frameWidth,
      frameH: frameHeight,
      k,
      X: (v) => v * k,
      Y: (v) => v * k,
      nowMs: performance.now() - mountedAt.current,
    });
  }, [frameHeight, frameWidth, frozenFrame]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setSizeTick((n) => n + 1));
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!animate) {
      render();
      return;
    }
    let raf = 0;
    const loop = () => {
      render();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
    // `draw` is in the deps so the non-animated path redraws when data changes.
  }, [animate, render, draw, sizeTick]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onPick) return;
    const canvas = canvasRef.current;
    if (!canvas || frameWidth === 0) return;
    const rect = canvas.getBoundingClientRect();
    // display → frame, so the stored point survives any later resize.
    const k = frameWidth / rect.width;
    onPick({ x: (e.clientX - rect.left) * k, y: (e.clientY - rect.top) * k });
  };

  return (
    <div className="stage" ref={wrapRef}>
      <video
        ref={videoRef}
        playsInline
        muted
        style={{ display: frozenFrame ? 'none' : 'block' }}
      />
      <canvas
        ref={canvasRef}
        className="overlay"
        onClick={handleClick}
        style={{
          position: frozenFrame ? 'relative' : 'absolute',
          cursor: cursor ?? (onPick ? 'crosshair' : 'default'),
        }}
        title={title}
      />
    </div>
  );
}
