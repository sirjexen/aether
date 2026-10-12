import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCanvas2d } from '../hooks/useCanvas2d';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { scaledCount, damp, clamp, lerp } from '../lib/perf';
import { PALETTE, hexA } from '../styles/palette';
import './ParticleUniverse.css';
import { SceneHint } from '../components/SceneHint';

/* ------------------------------------------------------------------ */
/* types                                                               */
/* ------------------------------------------------------------------ */

type Layer = 0 | 1 | 2;

interface Particle {
  restX: number;
  restY: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  layer: Layer;
  size: number;
  baseAlpha: number;
  twPhase: number;
  twSpeed: number;
  amber: boolean;
  targetX: number;
  targetY: number;
  bright: number;
}

interface Ripple {
  x: number;
  y: number;
  r: number;
  alpha: number;
  maxR: number;
}

interface Target {
  x: number;
  y: number;
}

type Phase = 'idle' | 'converging' | 'holding' | 'releasing';

interface Sim {
  particles: Particle[];
  ripples: Ripple[];
  targets: Target[];
  convergeT: number;
  phase: Phase;
  holdT: number;
  time: number;
  onSettle: () => void;
}

interface Pointer {
  x: number;
  y: number;
  sx: number;
  sy: number;
  inside: boolean;
}

/* ------------------------------------------------------------------ */
/* constants                                                           */
/* ------------------------------------------------------------------ */

const TAU = Math.PI * 2;
const LEVELS = 24;
const REPEL_RADIUS = 140;
const HOLD_SECONDS = 3.5;

/** per depth layer: size range, base alpha, drift speed, parallax depth, spring stiffness, repel strength */
const LAYERS = [
  { sizeMin: 0.7, sizeMax: 1.4, alpha: 0.3, drift: 7, depth: 0.04, stiff: 26, repel: 0.55 },
  { sizeMin: 1.2, sizeMax: 2.2, alpha: 0.55, drift: 11, depth: 0.09, stiff: 34, repel: 0.85 },
  { sizeMin: 1.9, sizeMax: 3.3, alpha: 0.88, drift: 17, depth: 0.16, stiff: 42, repel: 1.25 },
] as const;

const LAYER_SHARES = [0.45, 0.35, 0.2] as const;

/** precomputed fill styles: [layer * 2 + amber][alphaLevel] — zero per-frame string allocs */
const STYLE_CACHE: string[][] = (() => {
  const out: string[][] = [];
  for (let l = 0; l < 3; l++) {
    for (let a = 0; a < 2; a++) {
      const col = a === 1 ? PALETTE.amber : PALETTE.ink;
      const arr: string[] = [];
      for (let k = 0; k < LEVELS; k++) arr.push(hexA(col, (k + 1) / LEVELS));
      out.push(arr);
    }
  }
  return out;
})();

/* ------------------------------------------------------------------ */
/* sim construction                                                    */
/* ------------------------------------------------------------------ */

function createParticles(w: number, h: number): Particle[] {
  const count = scaledCount(1000);
  const ps: Particle[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const r = Math.random();
    let layer: Layer = 0;
    if (r > LAYER_SHARES[0] + LAYER_SHARES[1]) layer = 2;
    else if (r > LAYER_SHARES[0]) layer = 1;
    const L = LAYERS[layer];
    const x = Math.random() * w;
    const y = Math.random() * h;
    ps[i] = {
      restX: x,
      restY: y,
      x,
      y,
      vx: 0,
      vy: 0,
      layer,
      size: L.sizeMin + Math.random() * (L.sizeMax - L.sizeMin),
      baseAlpha: L.alpha * (0.75 + Math.random() * 0.5),
      twPhase: Math.random() * TAU,
      twSpeed: 0.5 + Math.random() * 1.4,
      amber: layer === 2 && Math.random() < 0.14,
      targetX: x,
      targetY: y,
      bright: 0,
    };
  }
  return ps;
}

/**
 * Sample the word "AETHER" from an offscreen canvas (Fraunces serif),
 * mapped into viewport pixels, centered. Returns target points.
 */
function sampleTargets(w: number, h: number): Target[] {
  const pts: Target[] = [];
  const scale = Math.min(1, 480 / Math.max(w, h));
  const sw = Math.max(160, Math.round(w * scale));
  const sh = Math.max(160, Math.round(h * scale));
  const off = document.createElement('canvas');
  off.width = sw;
  off.height = sh;
  const c = off.getContext('2d', { willReadFrequently: true });
  if (!c) return pts;

  c.fillStyle = '#000';
  c.fillRect(0, 0, sw, sh);
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  const setFont = (s: number) => {
    c.font = `600 ${s}px "Fraunces Variable", Georgia, serif`;
  };
  let fs = Math.round(sh * 0.5);
  setFont(fs);
  const targetW = sw * 0.84;
  const measured = c.measureText('AETHER').width;
  if (measured > targetW && measured > 0) {
    fs = Math.max(8, Math.round((fs * targetW) / measured));
    setFont(fs);
  }
  c.fillStyle = '#fff';
  c.fillText('AETHER', sw / 2, sh / 2 + fs * 0.03);

  let data: ImageData;
  try {
    data = c.getImageData(0, 0, sw, sh);
  } catch {
    return pts;
  }
  const d = data.data;
  const toViewport = w / sw; // uniform scale: sw/sh matches w/h aspect
  for (const stride of [4, 3, 2]) {
    pts.length = 0;
    const half = stride >> 1;
    for (let sy = half; sy < sh; sy += stride) {
      for (let sx = half; sx < sw; sx += stride) {
        // NOTE: the offscreen is filled with opaque black, so test the red
        // channel (brightness), not alpha — alpha is 255 everywhere.
        if (d[(sy * sw + sx) * 4] > 128) {
          pts.push({ x: sx * toViewport, y: sy * toViewport });
        }
      }
    }
    if (pts.length >= 240) break;
  }
  return pts;
}

/** round-robin assignment so every target point gets even particle coverage */
function assignTargets(ps: Particle[], targets: Target[]): void {
  if (targets.length === 0) {
    for (const p of ps) {
      p.targetX = p.restX;
      p.targetY = p.restY;
    }
    return;
  }
  for (let i = 0; i < ps.length; i++) {
    const t = targets[i % targets.length];
    ps[i].targetX = t.x;
    ps[i].targetY = t.y;
  }
}

/* ------------------------------------------------------------------ */
/* simulation step                                                     */
/* ------------------------------------------------------------------ */

function stepSim(sim: Sim, ptr: Pointer, w: number, h: number, dt: number): void {
  sim.time += dt;
  ptr.sx = damp(ptr.sx, ptr.x, 7, dt);
  ptr.sy = damp(ptr.sy, ptr.y, 7, dt);

  // converge state machine
  switch (sim.phase) {
    case 'converging':
      sim.convergeT = damp(sim.convergeT, 1, 2.6, dt);
      if (sim.convergeT > 0.985) {
        sim.convergeT = 1;
        sim.phase = 'holding';
        sim.holdT = HOLD_SECONDS;
      }
      break;
    case 'holding':
      sim.holdT -= dt;
      if (sim.holdT <= 0) sim.phase = 'releasing';
      break;
    case 'releasing':
      sim.convergeT = damp(sim.convergeT, 0, 1.8, dt);
      if (sim.convergeT < 0.012) {
        sim.convergeT = 0;
        sim.phase = 'idle';
        sim.onSettle();
      }
      break;
    default:
      break;
  }

  const ct = sim.convergeT;
  const par = 1 - ct * 0.9; // parallax fades as the word forms
  const cx = w / 2;
  const cy = h / 2;
  const px = ptr.sx;
  const py = ptr.sy;
  const usePtr = ptr.inside;
  const t = sim.time;
  const m = 28;
  const r2 = REPEL_RADIUS * REPEL_RADIUS;

  const ps = sim.particles;
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const L = LAYERS[p.layer];

    // slow drift of the rest position along a layered sine flow field
    const fx =
      Math.sin(p.restX * 0.0016 + t * 0.11 + p.layer * 1.7) +
      Math.cos(p.restY * 0.0013 - t * 0.07);
    const fy =
      Math.cos(p.restX * 0.0011 - t * 0.09 + p.layer * 2.1) +
      Math.sin(p.restY * 0.0019 + t * 0.13);
    p.restX += fx * L.drift * 0.5 * dt;
    p.restY += fy * L.drift * 0.35 * dt;
    if (p.restX < -m) p.restX += w + m * 2;
    else if (p.restX > w + m) p.restX -= w + m * 2;
    if (p.restY < -m) p.restY += h + m * 2;
    else if (p.restY > h + m) p.restY -= h + m * 2;

    // spring target: rest + depth parallax, blended toward the converge point
    let tx = lerp(p.restX + (px - cx) * L.depth * par, p.targetX, ct);
    let ty = lerp(p.restY + (py - cy) * L.depth * par, p.targetY, ct);
    let bright = 0;

    // pointer repulsion with smooth quadratic falloff
    if (usePtr) {
      const dx = p.x - px;
      const dy = p.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 < r2 && d2 > 0.001) {
        const d = Math.sqrt(d2);
        const f = 1 - d / REPEL_RADIUS;
        const push = f * f * 120 * L.repel;
        tx += (dx / d) * push;
        ty += (dy / d) * push;
      }
    }

    // click ripples: radial displacement + brightening as the ring passes
    const rps = sim.ripples;
    for (let j = 0; j < rps.length; j++) {
      const rp = rps[j];
      const dx = p.x - rp.x;
      const dy = p.y - rp.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const band = 30;
      const bd = Math.abs(d - rp.r);
      if (bd < band && d > 0.001) {
        const f = 1 - bd / band;
        const push = f * f * 64 * rp.alpha;
        tx += (dx / d) * push;
        ty += (dy / d) * push;
        const b = f * rp.alpha;
        if (b > bright) bright = b;
      }
    }

    // critically damped spring toward the target (c = 2 * sqrt(k))
    const k = lerp(L.stiff, 62, ct);
    const cd = 2 * Math.sqrt(k);
    p.vx += ((tx - p.x) * k - p.vx * cd) * dt;
    p.vy += ((ty - p.y) * k - p.vy * cd) * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.bright = bright;
  }

  // ripples expand and fade out
  for (let i = sim.ripples.length - 1; i >= 0; i--) {
    const rp = sim.ripples[i];
    rp.r += 430 * dt;
    rp.alpha = clamp(1 - rp.r / rp.maxR, 0, 1);
    if (rp.alpha <= 0) sim.ripples.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ */
/* painting                                                            */
/* ------------------------------------------------------------------ */

function paint(ctx: CanvasRenderingContext2D, sim: Sim, w: number, h: number): void {
  ctx.fillStyle = PALETTE.bg;
  ctx.fillRect(0, 0, w, h);

  const t = sim.time;
  const ct = sim.convergeT;
  const ps = sim.particles;
  let last = '';
  for (let i = 0; i < ps.length; i++) {
    const p = ps[i];
    const tw = 0.55 + 0.45 * Math.sin(t * p.twSpeed + p.twPhase);
    let a = p.baseAlpha * tw * (1 + p.bright * 1.5) * (1 + ct * 0.3);
    if (a > 1) a = 1;
    if (a < 0.02) continue;
    const li = (a * (LEVELS - 1)) | 0;
    const st = STYLE_CACHE[p.layer * 2 + (p.amber ? 1 : 0)][li];
    if (st !== last) {
      ctx.fillStyle = st;
      last = st;
    }
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, TAU);
    ctx.fill();
  }

  const rps = sim.ripples;
  if (rps.length > 0) {
    ctx.lineWidth = 1.5;
    for (let i = 0; i < rps.length; i++) {
      const rp = rps[i];
      ctx.strokeStyle = hexA(PALETTE.amber, rp.alpha * 0.75);
      ctx.beginPath();
      ctx.arc(rp.x, rp.y, rp.r, 0, TAU);
      ctx.stroke();
    }
  }
}

/* ------------------------------------------------------------------ */
/* scene component                                                     */
/* ------------------------------------------------------------------ */

export function ParticleUniverse({ active }: { active: boolean }) {
  const { canvasRef, viewport } = useCanvas2d();
  const reduced = usePrefersReducedMotion();
  const [converged, setConverged] = useState(false);

  const simRef = useRef<Sim | null>(null);
  const pointerRef = useRef<Pointer>({ x: 0, y: 0, sx: 0, sy: 0, inside: false });
  const repaintRef = useRef<() => void>(() => {});

  const toggleConverge = useCallback(() => {
    const sim = simRef.current;
    if (!sim || sim.targets.length === 0) return;
    if (reduced) {
      // reduced motion: instant, one-shot converge
      if (sim.phase === 'idle') {
        sim.phase = 'holding';
        sim.convergeT = 1;
        for (const p of sim.particles) {
          p.x = p.targetX;
          p.y = p.targetY;
          p.vx = 0;
          p.vy = 0;
          p.bright = 0;
        }
        setConverged(true);
      } else {
        sim.phase = 'idle';
        sim.convergeT = 0;
        for (const p of sim.particles) {
          p.x = p.restX;
          p.y = p.restY;
          p.vx = 0;
          p.vy = 0;
          p.bright = 0;
        }
        setConverged(false);
      }
      repaintRef.current();
      return;
    }
    if (sim.phase === 'idle') {
      sim.phase = 'converging';
      setConverged(true);
    } else {
      sim.phase = 'releasing';
    }
  }, [reduced]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    setConverged(false);

    const sim: Sim = {
      particles: createParticles(w, h),
      ripples: [],
      targets: sampleTargets(w, h),
      convergeT: 0,
      phase: 'idle',
      holdT: 0,
      time: 0,
      onSettle: () => setConverged(false),
    };
    assignTargets(sim.particles, sim.targets);
    simRef.current = sim;
    const ptr = pointerRef.current;
    ptr.x = w / 2;
    ptr.y = h / 2;
    ptr.sx = w / 2;
    ptr.sy = h / 2;
    ptr.inside = false;

    // resample once the display font arrives so the word forms in real Fraunces
    let alive = true;
    document.fonts?.ready.then(() => {
      if (!alive || simRef.current !== sim) return;
      sim.targets = sampleTargets(w, h);
      assignTargets(sim.particles, sim.targets);
      repaintRef.current();
    });

    const paintOnce = () => paint(ctx, sim, w, h);
    repaintRef.current = paintOnce;
    paintOnce(); // synchronous first frame — no blank flash

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'c' || e.key === 'C') toggleConverge();
    };
    window.addEventListener('keydown', onKey);

    if (reduced) {
      return () => {
        alive = false;
        window.removeEventListener('keydown', onKey);
        repaintRef.current = () => {};
        if (simRef.current === sim) simRef.current = null;
      };
    }

    let raf = 0;
    let last = performance.now();
    let running = true;

    const tick = (now: number) => {
      if (!running) return;
      raf = requestAnimationFrame(tick);
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05;
      if (dt <= 0) return;
      stepSim(sim, ptr, w, h, dt);
      paint(ctx, sim, w, h);
    };
    raf = requestAnimationFrame(tick);

    const onVisibility = () => {
      if (document.hidden) {
        running = false;
        cancelAnimationFrame(raf);
      } else if (!running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      alive = false;
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey);
      repaintRef.current = () => {};
      if (simRef.current === sim) simRef.current = null;
    };
  }, [active, reduced, viewport, toggleConverge]);

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const p = pointerRef.current;
    const was = p.inside;
    p.x = e.clientX - rect.left;
    p.y = e.clientY - rect.top;
    if (!was) {
      p.sx = p.x;
      p.sy = p.y;
    }
    p.inside = true;
  };

  const handlePointerLeave = () => {
    pointerRef.current.inside = false;
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    handlePointerMove(e);
    const sim = simRef.current;
    const canvas = canvasRef.current;
    if (!sim || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const maxR = Math.hypot(Math.max(x, w - x), Math.max(y, h - y));
    sim.ripples.push({ x, y, r: 8, alpha: 1, maxR });
    if (sim.ripples.length > 6) sim.ripples.shift();
    if (reduced) {
      // one-shot frozen ripple frame
      const rp = sim.ripples[sim.ripples.length - 1];
      rp.r = Math.min(150, maxR * 0.45);
      rp.alpha = 0.7;
      repaintRef.current();
    }
  };

  return (
    <div
      className="particle-universe"
      style={{ position: 'absolute', inset: 0, overflow: 'hidden', background: PALETTE.bg }}
      aria-label="Particle Universe"
    >
      {/* DOM title — floats above the opaque canvas so it stays visible;
          particles can't cover it, but the outlined treatment keeps it airy.
          pointerEvents none so all clicks reach the canvas. */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 4,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          pointerEvents: 'none',
          textAlign: 'center',
          padding: '0 24px',
          opacity: converged ? 0 : 1,
          transition: 'opacity 0.9s ease',
        }}
        aria-hidden={converged}
      >
        <h1
          className="scene-title"
          style={{
            fontSize: 'clamp(64px, 17vw, 200px)',
            color: 'transparent',
            WebkitTextStroke: `1px ${hexA(PALETTE.ink, 0.8)}`,
            mixBlendMode: 'screen',
          }}
        >
          AETHER
        </h1>
        <p
          style={{
            margin: '18px 0 0',
            fontFamily: 'var(--font-ui)',
            fontSize: 12,
            letterSpacing: '0.42em',
            textTransform: 'uppercase',
            color: hexA(PALETTE.ink, 0.55),
          }}
        >
          an interactive exhibition in four movements
        </p>
      </div>

      <canvas
        ref={canvasRef}
        className="canvas-fill"
        style={{ background: PALETTE.bg, zIndex: 3, cursor: 'crosshair' }}
        onPointerMove={handlePointerMove}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerLeave}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerLeave}
      />

      <button
        type="button"
        className="universe-converge"
        onClick={toggleConverge}
        aria-pressed={converged}
        style={{
          position: 'absolute',
          right: 32,
          bottom: 110,
          zIndex: 6,
          fontFamily: 'var(--font-ui)',
          fontSize: 11,
          letterSpacing: '0.32em',
          textTransform: 'uppercase',
          color: PALETTE.ink,
          background: hexA(PALETTE.bg, 0.55),
          border: `1px solid ${hexA(PALETTE.amber, 0.55)}`,
          borderRadius: 999,
          padding: '12px 24px 12px 28px',
          cursor: 'pointer',
          backdropFilter: 'blur(6px)',
        }}
      >
        Converge
      </button>

      <SceneHint style={{ position: 'absolute', left: 32, bottom: 110, zIndex: 5 }}>
        MOVE TO EXPLORE — CLICK TO RIPPLE
      </SceneHint>
    </div>
  );
}
