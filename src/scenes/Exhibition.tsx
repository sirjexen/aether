import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCanvas2d } from '../hooks/useCanvas2d';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import { clamp, damp, scaledCount } from '../lib/perf';
import { PALETTE, hexA, mixHex } from '../styles/palette';
import { SceneHint } from '../components/SceneHint';
import './Exhibition.css';

/* ------------------------------------------------------------------ */
/* shared bits                                                         */
/* ------------------------------------------------------------------ */

interface PointerState {
  x: number; // 0..1 across the viewport
  y: number; // 0..1 down the viewport
  inside: boolean;
}

interface ArtProps {
  active: boolean;
  pointer: { current: PointerState };
}

/** Deterministic PRNG so every first frame is composed, not random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const easeOutBack = (x: number): number => {
  const c = 1.70158;
  return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2);
};

interface ArtworkMeta {
  id: string;
  numeral: string;
  title: string;
  year: string;
  medium: string;
  statement: string;
}

const ARTWORKS: ArtworkMeta[] = [
  {
    id: 'tidal',
    numeral: 'I',
    title: 'Tidal Memory',
    year: '2026',
    medium: 'generative ink on null canvas',
    statement:
      'The sea keeps every version of the shore. These lines are what it remembers of your passing.',
  },
  {
    id: 'machines',
    numeral: 'II',
    title: 'Silent Machines',
    year: '2025',
    medium: 'kinetic geometry, edition of 1',
    statement:
      'Engines that dream in perfect circles. Brush one and it steps politely aside — startle them and they rearrange the room.',
  },
  {
    id: 'garden',
    numeral: 'III',
    title: 'Garden of Static',
    year: '2026',
    medium: 'particle blooms, interactive',
    statement:
      'Plant light in dark soil. It opens, it breathes, and by morning it has forgotten your hand.',
  },
];

const NAV_ITEMS = [
  { numeral: 'I', label: 'Tidal Memory' },
  { numeral: 'II', label: 'Silent Machines' },
  { numeral: 'III', label: 'Garden of Static' },
  { numeral: 'Fin', label: 'Closing' },
];

/* ------------------------------------------------------------------ */
/* Artwork I — Tidal Memory                                            */
/* ------------------------------------------------------------------ */

interface TidalLine {
  frac: number;
  amp: number;
  phase: number;
  freq: number;
  speed: number;
  alpha: number;
}

const TIDAL_COUNT = scaledCount(28);
const TIDAL_PTS = 90;

function TidalMemory({ active, pointer }: ArtProps) {
  const { canvasRef, viewport } = useCanvas2d();
  const reduced = usePrefersReducedMotion();
  const lines = useRef<TidalLine[]>([]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    if (lines.current.length === 0) {
      const rng = mulberry32(20260413);
      const arr: TidalLine[] = [];
      for (let i = 0; i < TIDAL_COUNT; i++) {
        arr.push({
          frac: (i + 0.5 + (rng() - 0.5) * 0.6) / TIDAL_COUNT,
          amp: 0.006 + rng() * 0.028,
          phase: rng() * Math.PI * 2,
          freq: 0.004 + rng() * 0.006,
          speed: 0.12 + rng() * 0.3,
          alpha: 0.1 + rng() * 0.22,
        });
      }
      lines.current = arr;
    }
    const L = lines.current;

    const paint = (t: number) => {
      const p = pointer.current;
      const inside = p.inside;
      const py = p.y * h;
      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, w, h);
      // pointer Y shifts the wave phase, pointer X shifts ivory -> glacier
      const phaseShift = (inside ? p.y : 0.5) * Math.PI * 4;
      const base = mixHex(PALETTE.ink, PALETTE.glacier, inside ? p.x : 0.5);
      const sigma = h * 0.09;
      ctx.lineWidth = 1;
      for (let i = 0; i < L.length; i++) {
        const ln = L[i];
        const baseY = ln.frac * h;
        let glow = 0;
        if (inside) {
          const d = (baseY - py) / sigma;
          glow = Math.exp(-d * d * 2);
        }
        const amp = ln.amp * h * (1 + glow * 0.9);
        ctx.strokeStyle = hexA(base, Math.min(0.85, ln.alpha + glow * 0.5));
        ctx.beginPath();
        for (let j = 0; j <= TIDAL_PTS; j++) {
          const x = (j / TIDAL_PTS) * w;
          const y =
            baseY + amp * Math.sin(x * ln.freq + t * ln.speed + ln.phase + phaseShift);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    };

    paint(0); // first frame, synchronously
    if (reduced) return;

    let raf = 0;
    let alive = true;
    let running = true;
    let last = performance.now();
    let t = 0;
    const loop = (now: number) => {
      if (!alive) return;
      if (document.hidden) {
        running = false;
        raf = 0;
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      t += dt;
      paint(t);
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => {
      if (!document.hidden && alive && !running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [viewport.w, viewport.h, active, reduced, canvasRef, pointer]);

  return <canvas ref={canvasRef} className="canvas-fill" aria-label="Tidal Memory — generative contour lines" />;
}

/* ------------------------------------------------------------------ */
/* Artwork II — Silent Machines                                        */
/* ------------------------------------------------------------------ */

interface Machine {
  kind: number; // 0 bar, 1 arc, 2 ring, 3 disc, 4 spoke
  orbit: number;
  orbitT: number;
  angle: number;
  angVel: number;
  size: number;
  sizeT: number;
  rot: number;
  rotVel: number;
  color: string;
  alpha: number;
  alphaT: number;
  x: number;
  y: number;
  repX: number;
  repY: number;
  repXT: number;
  repYT: number;
  hl: number;
  hlT: number;
}

const MACHINE_COUNT = scaledCount(16);
const MACHINE_COLORS = [PALETTE.ink, PALETTE.ink, PALETTE.amber, PALETTE.glacier, PALETTE.ink];

function makeMachines(seed: number, n: number, minDim: number): Machine[] {
  const rng = mulberry32(seed);
  const arr: Machine[] = [];
  for (let i = 0; i < n; i++) {
    const orbit = minDim * (0.1 + rng() * 0.34);
    const size = 12 + rng() * 52;
    const a = 0.1 + rng() * 0.2;
    arr.push({
      kind: Math.floor(rng() * 5),
      orbit,
      orbitT: orbit,
      angle: rng() * Math.PI * 2,
      angVel: (0.06 + rng() * 0.22) * (rng() < 0.5 ? -1 : 1),
      size,
      sizeT: size,
      rot: rng() * Math.PI * 2,
      rotVel: (rng() - 0.5) * 1.4,
      color: MACHINE_COLORS[Math.floor(rng() * MACHINE_COLORS.length)],
      alpha: a,
      alphaT: a,
      x: 0,
      y: 0,
      repX: 0,
      repY: 0,
      repXT: 0,
      repYT: 0,
      hl: 0,
      hlT: 0,
    });
  }
  return arr;
}

function SilentMachines({ active, pointer }: ArtProps) {
  const { canvasRef, viewport } = useCanvas2d();
  const reduced = usePrefersReducedMotion();
  const machines = useRef<Machine[]>([]);
  const seedRef = useRef(77031);
  const ui = useRef({ reshuffle: false });
  const repaint = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    const cx = w / 2;
    const cy = h / 2;
    const minDim = Math.min(w, h);

    if (machines.current.length === 0) {
      machines.current = makeMachines(seedRef.current, MACHINE_COUNT, minDim);
    }
    const M = machines.current;

    const doReshuffle = () => {
      seedRef.current += 1;
      const rng = mulberry32(seedRef.current);
      for (const m of M) {
        m.orbitT = minDim * (0.1 + rng() * 0.34);
        m.sizeT = 12 + rng() * 52;
        m.angVel = (0.06 + rng() * 0.22) * (rng() < 0.5 ? -1 : 1);
        m.alphaT = 0.1 + rng() * 0.2;
        m.color = MACHINE_COLORS[Math.floor(rng() * MACHINE_COLORS.length)];
        m.kind = Math.floor(rng() * 5);
      }
    };

    const update = (dt: number, hover: boolean, snap: boolean) => {
      if (ui.current.reshuffle) {
        ui.current.reshuffle = false;
        doReshuffle();
        if (snap) {
          for (const m of M) {
            m.orbit = m.orbitT;
            m.size = m.sizeT;
            m.alpha = m.alphaT;
            m.hl = 0;
            m.repX = 0;
            m.repY = 0;
            m.repXT = 0;
            m.repYT = 0;
          }
        }
      }
      const p = pointer.current;
      const inside = hover && p.inside;
      const pxm = p.x * w;
      const pym = p.y * h;

      let hov: Machine | null = null;
      let best = 70 * 70;
      if (inside) {
        for (const m of M) {
          const dx = m.x - pxm;
          const dy = m.y - pym;
          const d2 = dx * dx + dy * dy;
          if (d2 < best) {
            best = d2;
            hov = m;
          }
        }
      }

      for (const m of M) {
        const isHov = m === hov;
        m.hlT = isHov ? 1 : 0;
        if (isHov && inside) {
          const d = Math.sqrt(best) || 1;
          m.repXT = ((m.x - pxm) / d) * 34;
          m.repYT = ((m.y - pym) / d) * 34;
        } else {
          m.repXT = 0;
          m.repYT = 0;
        }
        m.angle += m.angVel * dt;
        m.rot += m.rotVel * dt;
        m.orbit = damp(m.orbit, m.orbitT, 3, dt);
        m.size = damp(m.size, m.sizeT, 3, dt);
        m.alpha = damp(m.alpha, m.alphaT, 3, dt);
        m.hl = damp(m.hl, m.hlT, 6, dt);
        m.repX = damp(m.repX, m.repXT, 5, dt);
        m.repY = damp(m.repY, m.repYT, 5, dt);
        m.x = cx + Math.cos(m.angle) * m.orbit + m.repX;
        m.y = cy + Math.sin(m.angle) * m.orbit * 0.84 + m.repY;
      }
    };

    const draw = () => {
      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, w, h);
      for (const m of M) {
        const a = Math.min(0.9, m.alpha * (1 + m.hl * 1.6));
        const s = Math.max(2, m.size * (1 + m.hl * 0.18));
        ctx.strokeStyle = hexA(m.color, a);
        ctx.fillStyle = hexA(m.color, a);
        switch (m.kind) {
          case 0: {
            // bar
            ctx.save();
            ctx.translate(m.x, m.y);
            ctx.rotate(m.rot);
            ctx.fillRect(-s * 1.1, -s * 0.16, s * 2.2, s * 0.32);
            ctx.restore();
            break;
          }
          case 1: {
            // arc
            ctx.lineWidth = Math.max(2, s * 0.22);
            ctx.beginPath();
            ctx.arc(m.x, m.y, s, m.rot, m.rot + Math.PI * 1.25);
            ctx.stroke();
            break;
          }
          case 2: {
            // ring
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(m.x, m.y, s, 0, Math.PI * 2);
            ctx.stroke();
            break;
          }
          case 3: {
            // disc
            ctx.fillStyle = hexA(m.color, a * 0.55);
            ctx.beginPath();
            ctx.arc(m.x, m.y, s * 0.55, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
          default: {
            // spoke
            const tx = m.x + Math.cos(m.rot) * s * 1.5;
            const ty = m.y + Math.sin(m.rot) * s * 1.5;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(m.x, m.y);
            ctx.lineTo(tx, ty);
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(tx, ty, 3, 0, Math.PI * 2);
            ctx.fill();
            break;
          }
        }
      }
    };

    update(0, false, false);
    draw(); // first frame, synchronously
    repaint.current = () => {
      update(0, false, true);
      draw();
    };
    if (reduced) return;

    let raf = 0;
    let alive = true;
    let running = true;
    let last = performance.now();
    const loop = (now: number) => {
      if (!alive) return;
      if (document.hidden) {
        running = false;
        raf = 0;
        return;
      }
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      update(dt, true, false);
      draw();
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => {
      if (!document.hidden && alive && !running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [viewport.w, viewport.h, active, reduced, canvasRef, pointer]);

  const onPointerDown = () => {
    ui.current.reshuffle = true;
    if (reduced) repaint.current?.();
  };

  return (
    <canvas
      ref={canvasRef}
      className="canvas-fill"
      onPointerDown={onPointerDown}
      aria-label="Silent Machines — click to reshuffle the arrangement"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Artwork III — Garden of Static                                      */
/* ------------------------------------------------------------------ */

interface Bloom {
  x: number;
  y: number;
  born: number;
  seed: number;
  petals: number;
  maxR: number;
  hue: number;
}

interface Spore {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  ph: number;
}

const BLOOM_CAP = 12;
const BLOOM_LIFE = 25;
const SPORE_COUNT = scaledCount(70);

function GardenOfStatic({ active, pointer }: ArtProps) {
  const { canvasRef, viewport } = useCanvas2d();
  const reduced = usePrefersReducedMotion();
  const blooms = useRef<Bloom[]>([]);
  const spores = useRef<Spore[]>([]);
  const pending = useRef<{ x: number; y: number }[]>([]);
  const seedRef = useRef(1);
  const timeRef = useRef(0);
  const repaint = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    if (spores.current.length === 0) {
      const rng = mulberry32(4242);
      const arr: Spore[] = [];
      for (let i = 0; i < SPORE_COUNT; i++) {
        arr.push({
          x: rng() * w,
          y: rng() * h,
          vx: (rng() - 0.5) * 14,
          vy: (rng() - 0.5) * 10,
          r: 0.8 + rng() * 1.4,
          ph: rng() * Math.PI * 2,
        });
      }
      spores.current = arr;
    }

    const plant = (x: number, y: number, born: number) => {
      const rng = mulberry32(seedRef.current * 7919 + 13);
      blooms.current.push({
        x,
        y,
        born,
        seed: seedRef.current,
        petals: 9 + Math.floor(rng() * 6),
        maxR: Math.min(w, h) * (0.06 + rng() * 0.09),
        hue: rng(),
      });
      seedRef.current += 1;
      while (blooms.current.length > BLOOM_CAP) blooms.current.shift();
    };

    const drawBloom = (b: Bloom, now: number) => {
      const age = now - b.born;
      if (age < 0) return;
      const open = easeOutBack(clamp(age / 1.3, 0, 1));
      if (open <= 0) return;
      const R = b.maxR * open * (1 + 0.05 * Math.sin(now * 1.8 + b.seed));
      const fade =
        age > BLOOM_LIFE - 5 ? clamp(1 - (age - (BLOOM_LIFE - 5)) / 5, 0, 1) : 1;
      if (fade <= 0) return;
      const p = pointer.current;
      const wx = p.inside ? (p.x * w - b.x) * 0.06 : 0;
      const wy = p.inside ? (p.y * h - b.y) * 0.06 : 0;
      const rng = mulberry32(b.seed * 131 + 7);
      const col = mixHex(PALETTE.ink, PALETTE.glacier, b.hue);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = hexA(col, 0.5 * fade);
      ctx.fillStyle = hexA(col, 0.65 * fade);
      for (let i = 0; i < b.petals; i++) {
        const ang = (i / b.petals) * Math.PI * 2 + (rng() - 0.5) * 0.35;
        const len = R * (0.72 + rng() * 0.42);
        const tx = b.x + Math.cos(ang) * len + wx;
        const ty = b.y + Math.sin(ang) * len + wy;
        ctx.beginPath();
        ctx.moveTo(b.x, b.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(tx, ty, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = hexA(PALETTE.amber, 0.85 * fade);
      ctx.beginPath();
      ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
      ctx.fill();
    };

    const frame = (now: number, dt: number) => {
      const pd = pending.current;
      if (pd.length > 0) {
        for (const q of pd) plant(q.x, q.y, now);
        pd.length = 0;
      }
      ctx.fillStyle = PALETTE.bg;
      ctx.fillRect(0, 0, w, h);
      const S = spores.current;
      for (let i = 0; i < S.length; i++) {
        const s = S[i];
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        if (s.x < -4) s.x = w + 4;
        else if (s.x > w + 4) s.x = -4;
        if (s.y < -4) s.y = h + 4;
        else if (s.y > h + 4) s.y = -4;
        const a = 0.08 + 0.07 * Math.sin(now * 0.9 + s.ph);
        ctx.fillStyle = hexA(PALETTE.ink, Math.max(0.02, a));
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      const B = blooms.current;
      for (let i = B.length - 1; i >= 0; i--) {
        if (now - B[i].born > BLOOM_LIFE) B.splice(i, 1);
        else drawBloom(B[i], now);
      }
    };

    if (reduced) {
      if (blooms.current.length === 0) {
        const t0 = 8;
        plant(w * 0.3, h * 0.42, t0 - 6);
        plant(w * 0.62, h * 0.58, t0 - 9);
        plant(w * 0.78, h * 0.3, t0 - 3);
        timeRef.current = t0;
      }
      frame(timeRef.current, 0);
      repaint.current = () => frame(timeRef.current, 0);
      return;
    }

    timeRef.current = 0;
    frame(0, 0); // first frame, synchronously
    let raf = 0;
    let alive = true;
    let running = true;
    let last = performance.now();
    const loop = (nowMs: number) => {
      if (!alive) return;
      if (document.hidden) {
        running = false;
        raf = 0;
        return;
      }
      const dt = Math.min((nowMs - last) / 1000, 0.05);
      last = nowMs;
      timeRef.current += dt;
      frame(timeRef.current, dt);
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => {
      if (!document.hidden && alive && !running) {
        running = true;
        last = performance.now();
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [viewport.w, viewport.h, active, reduced, canvasRef, pointer]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pending.current.push({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (reduced) repaint.current?.();
  };

  return (
    <canvas
      ref={canvasRef}
      className="canvas-fill"
      onPointerDown={onPointerDown}
      aria-label="Garden of Static — click to plant a bloom"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Closing — Fin                                                       */
/* ------------------------------------------------------------------ */

interface TrailPt {
  x: number;
  y: number;
  t: number;
}

function FinCanvas({ active }: ArtProps) {
  const { canvasRef, viewport } = useCanvas2d();
  const reduced = usePrefersReducedMotion();
  const pts = useRef<TrailPt[]>([]);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    ctx.fillStyle = PALETTE.bg;
    ctx.fillRect(0, 0, w, h);

    if (reduced) {
      // one composed static frame: a single fading arc
      const g = ctx.createLinearGradient(0, h * 0.7, w, h * 0.3);
      g.addColorStop(0, hexA(PALETTE.amber, 0));
      g.addColorStop(0.5, hexA(PALETTE.amber, 0.5));
      g.addColorStop(1, hexA(PALETTE.amber, 0));
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(w * 0.1, h * 0.65);
      ctx.bezierCurveTo(w * 0.35, h * 0.2, w * 0.65, h * 0.85, w * 0.9, h * 0.4);
      ctx.stroke();
      return;
    }

    let raf = 0;
    let alive = true;
    let running = true;
    const loop = () => {
      if (!alive) return;
      if (document.hidden) {
        running = false;
        raf = 0;
        return;
      }
      // fade the whole field a little each frame; trails decay into the dark
      ctx.fillStyle = hexA(PALETTE.bg, 0.12);
      ctx.fillRect(0, 0, w, h);
      const P = pts.current;
      const cutoff = performance.now() - 1800;
      while (P.length > 0 && P[0].t < cutoff) P.shift();
      const n = P.length;
      if (n > 1) {
        ctx.lineCap = 'round';
        for (let i = 1; i < n; i++) {
          const f = i / (n - 1);
          ctx.strokeStyle = hexA(PALETTE.amber, f * 0.75);
          ctx.lineWidth = 0.5 + f * 5;
          ctx.beginPath();
          ctx.moveTo(P[i - 1].x, P[i - 1].y);
          ctx.lineTo(P[i].x, P[i].y);
          ctx.stroke();
        }
        const head = P[n - 1];
        ctx.fillStyle = hexA(PALETTE.ink, 0.85);
        ctx.beginPath();
        ctx.arc(head.x, head.y, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(loop);
    };
    const onVis = () => {
      if (!document.hidden && alive && !running) {
        running = true;
        raf = requestAnimationFrame(loop);
      }
    };
    document.addEventListener('visibilitychange', onVis);
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      running = false;
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [viewport.w, viewport.h, active, reduced, canvasRef]);

  const push = (x: number, y: number) => {
    const P = pts.current;
    P.push({ x, y, t: performance.now() });
    if (P.length > 90) P.splice(0, P.length - 90);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (reduced) return;
    push(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (reduced) return;
    push(e.nativeEvent.offsetX, e.nativeEvent.offsetY);
  };

  return (
    <canvas
      ref={canvasRef}
      className="canvas-fill"
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      aria-label="Fin — move to paint light trails"
    />
  );
}

/* ------------------------------------------------------------------ */
/* Exhibition — the gallery shell                                      */
/* ------------------------------------------------------------------ */

export function Exhibition({ active }: { active: boolean }) {
  const reduced = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const pointer = useRef<PointerState>({ x: 0.5, y: 0.5, inside: false });
  const parallaxRef = useRef<HTMLDivElement | null>(null);

  const next = useCallback(() => setIndex((v) => (v + 1) % 4), []);
  const prev = useCallback(() => setIndex((v) => (v + 3) % 4), []);
  const go = useCallback((i: number) => setIndex(((i % 4) + 4) % 4), []);

  // Capture-phase so gallery arrows win over the shell's scene-switch arrows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopPropagation();
        next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        e.stopPropagation();
        prev();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [next, prev]);

  // subtle pointer parallax on the stage wrapper, damped
  useEffect(() => {
    if (!active || reduced) return;
    const el = parallaxRef.current;
    let raf = 0;
    let alive = true;
    let cx = 0;
    let cy = 0;
    const loop = () => {
      if (!alive) return;
      if (!document.hidden && el) {
        const p = pointer.current;
        const tx = p.inside ? (p.x - 0.5) * 20 : 0;
        const ty = p.inside ? (p.y - 0.5) * 20 : 0;
        cx = damp(cx, tx, 4, 1 / 60);
        cy = damp(cy, ty, 4, 1 / 60);
        el.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, [active, reduced]);

  const onRootMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointer.current.x = e.clientX / window.innerWidth;
    pointer.current.y = e.clientY / window.innerHeight;
    pointer.current.inside = true;
  };
  const onRootLeave = () => {
    pointer.current.inside = false;
  };

  const art = index < 3 ? ARTWORKS[index] : null;

  return (
    <div
      className="exhibition"
      onPointerMove={onRootMove}
      onPointerLeave={onRootLeave}
    >
      <div className="exhibition-parallax" ref={parallaxRef}>
        <div className="exhibition-stage" key={index}>
          {index === 0 && <TidalMemory active={active} pointer={pointer} />}
          {index === 1 && <SilentMachines active={active} pointer={pointer} />}
          {index === 2 && <GardenOfStatic active={active} pointer={pointer} />}
          {index === 3 && <FinCanvas active={active} pointer={pointer} />}
        </div>
      </div>

      {art ? (
        <div className="exhibition-caption">
          <div className="exhibition-caption-inner" key={art.id}>
            <p className="exhibition-kicker">{art.numeral}</p>
            <h2 className="scene-title exhibition-caption-title">{art.title}</h2>
            <p className="exhibition-medium">
              {art.year} · {art.medium}
            </p>
            <p className="exhibition-statement">{art.statement}</p>
          </div>
        </div>
      ) : (
        <div className="exhibition-fin-text" key="fin">
          <p className="exhibition-fin-line">The exhibition continues in your motion.</p>
          <p className="exhibition-fin-sub">— thank you for playing</p>
        </div>
      )}

      <nav className="exhibition-rail" aria-label="Artworks">
        <button
          type="button"
          className="exhibition-arrow"
          onClick={prev}
          aria-label="Previous artwork"
        >
          ←
        </button>
        {NAV_ITEMS.map((item, i) => (
          <button
            key={item.numeral}
            type="button"
            className={`exhibition-rail-item${i === index ? ' is-active' : ''}`}
            onClick={() => go(i)}
            aria-current={i === index ? 'true' : undefined}
            aria-label={`${item.numeral}: ${item.label}`}
          >
            <span className="exhibition-numeral">{item.numeral}</span>
            <span className="exhibition-rail-title">{item.label}</span>
          </button>
        ))}
        <button
          type="button"
          className="exhibition-arrow"
          onClick={next}
          aria-label="Next artwork"
        >
          →
        </button>
      </nav>

      <SceneHint
        style={{ position: 'absolute', left: 32, bottom: 110, zIndex: 5, pointerEvents: 'none' }}
      >
        {index === 3 ? 'MOVE TO PAINT' : 'HOVER TO INSPECT — CLICK TO AWAKEN'}
      </SceneHint>
    </div>
  );
}
