import { useEffect, useRef, useState } from 'react';
import { dprCap } from '../lib/perf';

export interface Viewport {
  w: number;
  h: number;
  dpr: number;
}

/**
 * DPR-aware canvas sizing. The canvas element must be styled to fill
 * its container (use the .canvas-fill class). Returns a ref and the
 * current CSS-pixel viewport. Re-runs on resize via ResizeObserver.
 */
export function useCanvas2d() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ w: 0, h: 0, dpr: 1 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, dprCap());
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === 0 || h === 0) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      setViewport((prev) =>
        prev.w === w && prev.h === h && prev.dpr === dpr ? prev : { w, h, dpr },
      );
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    window.addEventListener('orientationchange', resize);
    return () => {
      ro.disconnect();
      window.removeEventListener('orientationchange', resize);
    };
  }, []);

  return { canvasRef, viewport };
}
