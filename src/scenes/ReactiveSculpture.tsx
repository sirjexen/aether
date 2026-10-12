import { useLayoutEffect, useRef } from 'react';
import type { JSX, PointerEvent as ReactPointerEvent } from 'react';
import { useCanvas2d } from '../hooks/useCanvas2d';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { SceneHint } from '../components/SceneHint';
import { clamp, damp, dprCap, lerp } from '../lib/perf';
import { PALETTE, hexA, mixHex } from '../styles/palette';

/**
 * "Glass Organ" — a reactive sculpture in seven petal rings.
 *
 * Canvas 2D, additive ('lighter') strokes, zero per-frame allocations in the
 * hot path (7 rings x 161 vertices is the whole frame cost). Idle motion is a
 * slow spin + breathing petal amplitudes; the pointer bends the glass with a
 * radial falloff field, drags spin the sculpture with inertia, and vertical
 * drag distance drives a "bloom" multiplier that springs back on release.
 */

const RINGS = 7;
const VERTS = 160;
const TAU = Math.PI * 2;
const FIELD_R = 180; // px — pointer displacement field radius
const FIELD_R2 = FIELD_R * FIELD_R;
const PUSH_MAX = 46; // px — max radial push at the field center
const IDLE_SPEED = 0.055; // rad/s — slow idle spin
const TAP_SLOP = 10; // px — movement below this is a tap, not a drag

const BASE_COLORS = [
  PALETTE.ink,
  PALETTE.amber,
  PALETTE.glacier,
  PALETTE.ink,
  PALETTE.amber,
  PALETTE.glacier,
  PALETTE.ink,
];

// Pleasing frozen pose for the reduced-motion static frame.
const STATIC_T = 2.35;
const STATIC_ROT = 0.55;
const STATIC_BLOOM = 1.18;

interface SculptState {
  rot: number;
  spinVel: number;
  bloom: number;
  bloomTarget: number;
  px: number;
  py: number;
  hasPointer: boolean;
  lightFade: number;
  speed: number;
  dragging: boolean;
  dragMoved: boolean;
  downX: number;
  downY: number;
  offX: number;
  offY: number;
  lastAngle: number;
  lastMoveT: number;
  colorBucket: number;
  ringColors: string[];
}

function freshState(): SculptState {
  return {
    rot: 0,
    spinVel: IDLE_SPEED,
    bloom: 1,
    bloomTarget: 1,
    px: 0,
    py: 0,
    hasPointer: false,
    lightFade: 0,
    speed: 0,
    dragging: false,
    dragMoved: false,
    downX: 0,
    downY: 0,
    offX: 0,
    offY: 0,
    lastAngle: 0,
    lastMoveT: 0,
    colorBucket: -1,
    ringColors: ['', '', '', '', '', '', ''],
  };
}

/** Size the canvas backing store (idempotent with useCanvas2d's own resize). */
function fitCanvas(canvas: HTMLCanvasElement): { w: number; h: number } {
  const dpr = Math.min(window.devicePixelRatio || 1, dprCap());
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (w > 0 && h > 0) {
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
      canvas.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }
  return { w, h };
}

/** Slow pseudo-noise in [-1, 1] built from detuned sines. */
function noise(t: number, i: number, seed: number): number {
  return (
    Math.sin(t * 0.29 + i * 1.71 + seed) * 0.62 +
    Math.sin(t * 0.163 + i * 0.83 + seed * 1.7) * 0.38
  );
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  s: SculptState,
  t: number,
  reduced: boolean,
): void {
  const cx = w / 2;
  const cy = h * 0.48;
  const minDim = Math.min(w, h);
  const rot = s.rot;
  const bloom = s.bloom;

  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, w, h);

  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';

  // Speed-reactive tint: glacier when the pointer flies, amber when it rests.
  // Colors are re-mixed only when the quantized speed bucket changes.
  const speedT = clamp(s.speed / 1400, 0, 1);
  const bucket = Math.round(speedT * 20);
  if (bucket !== s.colorBucket) {
    s.colorBucket = bucket;
    const tint = mixHex(PALETTE.amber, PALETTE.glacier, bucket / 20);
    for (let i = 0; i < RINGS; i++) {
      s.ringColors[i] = mixHex(BASE_COLORS[i], tint, 0.42);
    }
  }

  // Soft dynamic light centered on the pointer.
  const fade = reduced ? (s.hasPointer ? 1 : 0) : s.lightFade;
  if (fade > 0.01) {
    const lr = 260;
    const lightTint = mixHex(PALETTE.amber, PALETTE.glacier, speedT);
    const g = ctx.createRadialGradient(s.px, s.py, 0, s.px, s.py, lr);
    g.addColorStop(0, hexA(lightTint, 0.1 * fade));
    g.addColorStop(1, hexA(lightTint, 0));
    ctx.fillStyle = g;
    ctx.fillRect(s.px - lr, s.py - lr, lr * 2, lr * 2);
  }

  const hasP = s.hasPointer && fade > 0.01;
  const px = s.px;
  const py = s.py;

  // Seven concentric petal rings.
  for (let i = 0; i < RINGS; i++) {
    const f = i / (RINGS - 1);
    const baseR = minDim * lerp(0.12, 0.38, f);
    const a1 = (0.15 + 0.014 * i) * bloom * (1 + 0.32 * noise(t, i, 1.3));
    const a2 = (0.09 + 0.01 * i) * bloom * (1 + 0.38 * noise(t, i, 4.1));
    const phi1 = i * 0.86 + t * 0.055;
    const phi2 = i * 2.14 - t * 0.041;

    ctx.strokeStyle = hexA(s.ringColors[i], lerp(0.3, 0.16, f));
    ctx.lineWidth = i < 3 ? 1.8 : 1.2;
    ctx.beginPath();
    for (let k = 0; k <= VERTS; k++) {
      const th = (k * TAU) / VERTS;
      const r =
        baseR *
        (1 + a1 * Math.sin(3 * th + phi1) + a2 * Math.sin(5 * th + phi2));
      const ca = Math.cos(th + rot);
      const sa = Math.sin(th + rot);
      let x = cx + ca * r;
      let y = cy + sa * r;
      if (hasP) {
        const dx = x - px;
        const dy = y - py;
        const d2 = dx * dx + dy * dy;
        if (d2 < FIELD_R2 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const q = 1 - d / FIELD_R;
          const push = q * q * PUSH_MAX;
          x += (dx / d) * push;
          y += (dy / d) * push;
        }
      }
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // Luminous core, gently pulsing.
  const pulse = 1 + 0.14 * Math.sin(t * 1.6) + 0.06 * Math.sin(t * 2.7 + 1.2);
  const coreR = 30 * pulse;
  const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreR);
  cg.addColorStop(0, hexA(PALETTE.ink, 0.55));
  cg.addColorStop(0.35, hexA(PALETTE.amber, 0.22));
  cg.addColorStop(1, hexA(PALETTE.amber, 0));
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.arc(cx, cy, coreR, 0, TAU);
  ctx.fill();
  ctx.fillStyle = hexA(PALETTE.ink, 0.9);
  ctx.beginPath();
  ctx.arc(cx, cy, 3.2, 0, TAU);
  ctx.fill();

  ctx.globalCompositeOperation = 'source-over';
}

export function ReactiveSculpture({ active }: { active: boolean }): JSX.Element {
  const { canvasRef, viewport } = useCanvas2d();
  const reduced = usePrefersReducedMotion();
  const stateRef = useRef<SculptState>(freshState());
  const geomRef = useRef({ cx: 0, cy: 0 });
  const tRef = useRef(0);
  const modeRef = useRef<'none' | 'loop' | 'static'>('none');
  const staticDrawRef = useRef<(() => void) | null>(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !active) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h } = fitCanvas(canvas);
    if (w === 0 || h === 0) return;

    const s = stateRef.current;
    const geom = geomRef.current;
    geom.cx = w / 2;
    geom.cy = h * 0.48;

    const paint = (t: number): void => draw(ctx, w, h, s, t, reduced);

    // Reduced motion: one beautiful static frame, no loop.
    if (reduced) {
      s.rot = STATIC_ROT;
      s.bloom = STATIC_BLOOM;
      s.speed = 0;
      s.spinVel = 0;
      paint(STATIC_T);
      modeRef.current = 'static';
      staticDrawRef.current = () => {
        s.speed = 0;
        const g2 = fitCanvas(canvas);
        if (g2.w > 0 && g2.h > 0) {
          geom.cx = g2.w / 2;
          geom.cy = g2.h * 0.48;
          draw(ctx, g2.w, g2.h, s, STATIC_T, true);
        }
      };
      return () => {
        modeRef.current = 'none';
        staticDrawRef.current = null;
      };
    }

    modeRef.current = 'loop';
    paint(tRef.current); // first frame synchronously — no blank flash

    let raf = 0;
    let running = true;
    let last = performance.now();

    const frame = (now: number): void => {
      if (!running) return;
      const dt = clamp((now - last) / 1000, 0.0001, 0.05);
      last = now;
      tRef.current += dt;
      if (!s.dragging) {
        // Release: inertia damps back toward the slow idle spin; bloom springs to 1.
        s.spinVel = damp(s.spinVel, IDLE_SPEED, 2.2, dt);
        s.bloom = damp(s.bloom, 1, 2.4, dt);
      } else {
        s.bloom = damp(s.bloom, s.bloomTarget, 7, dt);
      }
      s.rot += s.spinVel * dt;
      s.speed = damp(s.speed, 0, 3.5, dt);
      s.lightFade = damp(s.lightFade, s.hasPointer ? 1 : 0, 6, dt);
      paint(tRef.current);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    const onVis = (): void => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (modeRef.current === 'loop') {
        running = true;
        last = performance.now();
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(frame);
      }
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
      modeRef.current = 'none';
    };
  }, [active, reduced, viewport, canvasRef]);

  /** Track pointer position + smoothed speed (px/s) for the light and color shift. */
  const updatePointer = (
    e: ReactPointerEvent<HTMLCanvasElement>,
  ): { x: number; y: number; dt: number } => {
    const s = stateRef.current;
    const x = e.clientX - s.offX;
    const y = e.clientY - s.offY;
    const now = e.timeStamp;
    const dt = Math.max((now - s.lastMoveT) / 1000, 1 / 240);
    const dx = x - s.px;
    const dy = y - s.py;
    const inst = Math.sqrt(dx * dx + dy * dy) / dt;
    s.speed += (inst - s.speed) * 0.4;
    s.lastMoveT = now;
    s.px = x;
    s.py = y;
    s.hasPointer = true;
    return { x, y, dt };
  };

  const redrawStatic = (): void => {
    if (modeRef.current === 'static') staticDrawRef.current?.();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const s = stateRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    s.offX = rect.left;
    s.offY = rect.top;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    s.px = x;
    s.py = y;
    s.hasPointer = true;
    s.lastMoveT = e.timeStamp;
    s.dragging = true;
    s.dragMoved = false;
    s.downX = x;
    s.downY = y;
    s.lastAngle = Math.atan2(y - geomRef.current.cy, x - geomRef.current.cx);
    s.bloomTarget = s.bloom;
    e.currentTarget.setPointerCapture(e.pointerId);
    redrawStatic();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const s = stateRef.current;
    const { x, y, dt } = updatePointer(e);
    if (s.dragging) {
      if (Math.hypot(x - s.downX, y - s.downY) > TAP_SLOP) s.dragMoved = true;
      const a = Math.atan2(y - geomRef.current.cy, x - geomRef.current.cx);
      let d = a - s.lastAngle;
      if (d > Math.PI) d -= TAU;
      else if (d < -Math.PI) d += TAU;
      s.lastAngle = a;
      if (s.dragMoved) {
        // Real drag: rotate the sculpture directly and harvest angular velocity.
        s.rot += d;
        const inst = clamp(d / dt, -14, 14);
        s.spinVel += (inst - s.spinVel) * 0.35;
      }
      // Vertical drag distance drives bloom (up = open, down = compress).
      s.bloomTarget = clamp(1 + (s.downY - y) / 260, 0.4, 2.0);
      if (modeRef.current === 'static') s.bloom = s.bloomTarget;
    }
    redrawStatic();
  };

  const endPointer = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const s = stateRef.current;
    if (s.dragging) {
      s.dragging = false;
      s.bloomTarget = 1;
      if (modeRef.current === 'static') s.bloom = 1;
      // Taps never touched rot/spinVel (dragMoved stayed false), so no fling.
      redrawStatic();
    }
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const onPointerLeave = (): void => {
    stateRef.current.hasPointer = false;
    redrawStatic();
  };

  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      <canvas
        ref={canvasRef}
        className="canvas-fill"
        role="img"
        aria-label="Glass Organ — a reactive sculpture in seven rings"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={onPointerLeave}
      />
      <div
        style={{
          position: 'absolute',
          top: 96,
          left: 32,
          zIndex: 5,
          pointerEvents: 'none',
        }}
      >
        <h2
          className="scene-title"
          style={{ fontSize: 'clamp(44px, 6vw, 88px)' }}
        >
          Glass Organ
        </h2>
        <p
          style={{
            margin: '12px 0 0',
            fontSize: 13,
            letterSpacing: '0.18em',
            color: 'rgba(242, 239, 230, 0.5)',
          }}
        >
          a reactive sculpture in seven rings
        </p>
      </div>
      <SceneHint
        style={{ position: 'absolute', left: 32, bottom: 110, zIndex: 5 }}
      >
        DRAG TO SCULPT — MOVE FOR LIGHT
      </SceneHint>
    </div>
  );
}
