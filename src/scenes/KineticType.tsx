import { useEffect, useRef, useState } from 'react';
import { clamp, damp, lerp } from '../lib/perf';
import { PALETTE, mixHex } from '../styles/palette';
import { SceneHint } from '../components/SceneHint';
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion';
import './KineticType.css';

/**
 * Scene 03 — "Kinetic Typography Lab".
 * DOM-based kinetic type: the word FLUX reacts to the pointer every frame.
 * Only `transform` (plus, in WEIGHT mode, font-variation-settings / font-size /
 * color) is written per frame — never layout props. Glyph base centers are
 * cached on mount / resize / mode change, never re-measured per frame.
 */

const GLYPHS = ['F', 'L', 'U', 'X'];
const MODE_NAMES = ['TIDE', 'SCATTER', 'WEIGHT', 'ORBIT'] as const;
const POINTER_FALLOFF = 260; // px — pointer influence falloff
const STAGGER_MS = 70; // per-glyph stagger on mode transitions
const BLEND_MS = 800; // mode transition duration per glyph

interface Vec {
  x: number;
  y: number;
}

interface GlyphPose {
  tx: number;
  ty: number;
  rot: number;
  scale: number;
  wght: number;
  sizeMul: number;
  warmth: number;
}

interface ScatterSeed {
  dx: number;
  dy: number;
  rot: number;
  scale: number;
}

interface LoopState {
  poses: GlyphPose[];
  from: GlyphPose[]; // pose snapshot at last mode change (transition blend source)
  fsCache: number[]; // last written font-size per glyph (avoid redundant writes)
  blendStart: number;
  centers: Vec[]; // cached glyph base centers, viewport coords
  vw: number;
  vh: number;
  baseFont: number; // px font-size of a glyph at rest
  px: number;
  py: number;
  spx: number; // smoothed pointer
  spy: number;
  seen: boolean; // pointer has entered the stage at least once
  orbit: number; // accumulated orbit angle (ORBIT mode)
  last: number; // last rAF timestamp
}

const NEUTRAL_POSE: GlyphPose = {
  tx: 0,
  ty: 0,
  rot: 0,
  scale: 1,
  wght: 300,
  sizeMul: 1,
  warmth: 0,
};

function makeLoopState(): LoopState {
  return {
    poses: GLYPHS.map(() => ({ ...NEUTRAL_POSE })),
    from: GLYPHS.map(() => ({ ...NEUTRAL_POSE })),
    fsCache: GLYPHS.map(() => -1),
    blendStart: -1e12,
    centers: GLYPHS.map(() => ({ x: 0, y: 0 })),
    vw: 0,
    vh: 0,
    baseFont: 200,
    px: 0,
    py: 0,
    spx: 0,
    spy: 0,
    seen: false,
    orbit: 0,
    last: 0,
  };
}

/** Deterministic PRNG so SCATTER offsets are stable per mount. */
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

function makeSeeds(): ScatterSeed[] {
  const rnd = mulberry32(20261013);
  return GLYPHS.map(() => ({
    dx: (rnd() * 2 - 1) * 250,
    dy: (rnd() * 2 - 1) * 190,
    rot: (rnd() * 2 - 1) * 42,
    scale: 0.85 + rnd() * 0.45,
  }));
}

interface Repel {
  dx: number;
  dy: number;
  prox: number; // 0..1 proximity of pointer to glyph
  side: number; // -1 | 1, which side of the pointer the glyph sits on
}

/** Repel offset away from the pointer with quadratic falloff. */
function repel(px: number, py: number, gx: number, gy: number): Repel {
  const dx = gx - px;
  const dy = gy - py;
  const d = Math.hypot(dx, dy) || 0.0001;
  const prox = clamp(1 - d / POINTER_FALLOFF, 0, 1);
  const e = prox * prox;
  const push = (110 * e) / d;
  return { dx: dx * push, dy: dy * push, prox, side: dx >= 0 ? 1 : -1 };
}

interface TargetCtx {
  i: number;
  t: number;
  px: number;
  py: number;
  seen: boolean;
  bx: number; // glyph base center x (viewport coords)
  by: number;
  vw: number;
  vh: number;
  orbit: number; // accumulated orbit angle
  orbitR: number; // orbit radius multiplier from pointer
  seed: ScatterSeed;
  cur: GlyphPose; // current damped pose (for position-aware interaction)
}

/**
 * Mode-specific target pose. One function, switched on mode, so the rAF
 * loop stays a thin damp-and-write pass.
 */
function computeTargets(mode: number, c: TargetCtx): GlyphPose {
  const { i, t } = c;

  if (mode === 0) {
    // ---- 01 TIDE: sine-wave drift + pointer wake ----
    let tx = Math.sin(t * 0.6 + i * 2.4) * 10;
    let ty = Math.sin(t * 1.3 + i * 1.9) * 28;
    let rot = Math.sin(t * 0.8 + i * 1.3) * 3.5;
    const gx = c.bx + c.cur.tx;
    const gy = c.by + c.cur.ty;
    const r = repel(c.px, c.py, gx, gy);
    tx += r.dx;
    ty += r.dy;
    rot += r.side * 8 * r.prox;
    if (c.seen) {
      // wake: extra displacement trailing behind the pointer's x
      const behind = c.px - 90 - gx;
      const g = Math.exp(-(behind * behind) / (2 * 120 * 120));
      ty += g * 42 * Math.sin(t * 2.4 + i * 0.9);
      tx -= g * 26;
    }
    return { tx, ty, rot, scale: 1 + 0.15 * r.prox, wght: 300, sizeMul: 1, warmth: 0 };
  }

  if (mode === 1) {
    // ---- 02 SCATTER: fixed pseudo-random dispersal; near-cursor attraction ----
    let tx = c.seed.dx;
    let ty = c.seed.dy;
    let rot = c.seed.rot;
    let scale = c.seed.scale;
    if (c.seen) {
      const gx = c.bx + c.cur.tx;
      const gy = c.by + c.cur.ty;
      const d = Math.hypot(c.px - gx, c.py - gy);
      const R = 260;
      if (d < R) {
        const pull = 1 - d / R;
        // attracted toward the cursor…
        tx = lerp(tx, c.px - c.bx, pull * 0.6);
        ty = lerp(ty, c.py - c.by, pull * 0.6);
        // …and orbiting nervously around it
        const ja = t * 10 + i * 2.4;
        tx += Math.cos(ja) * 9 * pull;
        ty += Math.sin(ja * 1.35) * 9 * pull;
        rot += Math.sin(t * 8 + i * 1.7) * 7 * pull;
        scale = lerp(scale, 1.1, pull);
      }
    }
    return { tx, ty, rot, scale, wght: 300, sizeMul: 1, warmth: 0 };
  }

  if (mode === 2) {
    // ---- 03 WEIGHT: variable-font showcase, pointer-driven ----
    const gx = c.bx + c.cur.tx;
    const gy = c.by + c.cur.ty;
    const r = repel(c.px, c.py, gx, gy);
    const prox = c.seen ? r.prox : 0;
    return {
      tx: r.dx * 0.5,
      ty: r.dy * 0.5,
      rot: r.side * 6 * prox,
      scale: 1 + 0.1 * prox,
      wght: lerp(100, 900, prox),
      sizeMul: 1 + 0.5 * prox,
      warmth: prox * prox,
    };
  }

  // ---- 04 ORBIT: glyphs circle the viewport center on elliptical paths ----
  const cx = c.vw / 2;
  const cy = c.vh / 2;
  const base = Math.min(c.vw, c.vh);
  const rx = base * 0.3 * c.orbitR;
  const ry = base * 0.19 * c.orbitR;
  const a = c.orbit + i * (Math.PI / 2) + 0.7;
  return {
    tx: cx + Math.cos(a) * rx - c.bx,
    ty: cy + Math.sin(a) * ry - c.by,
    rot: Math.sin(a + i) * 9,
    scale: 1,
    wght: 300,
    sizeMul: 1,
    warmth: 0,
  };
}

/** Cache glyph base centers (layout read — done on resize/mode change, never per frame). */
function measure(
  root: HTMLDivElement,
  glyphs: (HTMLSpanElement | null)[],
  s: LoopState,
): void {
  const rr = root.getBoundingClientRect();
  s.vw = window.innerWidth;
  s.vh = window.innerHeight;
  glyphs.forEach((el, idx) => {
    if (!el) return;
    // offsetLeft/Top are layout-based, unaffected by transforms — stable read.
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = el;
    while (node && node !== root) {
      x += node.offsetLeft;
      y += node.offsetTop;
      node = node.offsetParent as HTMLElement | null;
    }
    s.centers[idx] = {
      x: rr.left + x + el.offsetWidth / 2,
      y: rr.top + y + el.offsetHeight / 2,
    };
    if (idx === 0) {
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (Number.isFinite(fs) && fs > 0) s.baseFont = fs;
    }
  });
}

export function KineticType({ active }: { active: boolean }) {
  const reduced = usePrefersReducedMotion();
  const [mode, setMode] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const glyphRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const modeRef = useRef(mode);
  const seedsRef = useRef<ScatterSeed[] | null>(null);
  if (seedsRef.current === null) seedsRef.current = makeSeeds();
  const loopRef = useRef<LoopState | null>(null);
  if (loopRef.current === null) loopRef.current = makeLoopState();

  const nextMode = () => setMode((m) => (m + 1) % MODE_NAMES.length);

  const handlePointer = (clientX: number, clientY: number) => {
    const s = loopRef.current;
    if (!s) return;
    s.px = clientX;
    s.py = clientY;
    if (!s.seen) {
      s.seen = true;
      s.spx = clientX;
      s.spy = clientY;
    }
  };

  // Measure once on mount; re-measure on resize and after fonts load.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const s = loopRef.current;
    if (!s) return;
    const doMeasure = () => {
      if (rootRef.current && loopRef.current) {
        measure(rootRef.current, glyphRefs.current, loopRef.current);
      }
    };
    doMeasure();
    const ro = new ResizeObserver(doMeasure);
    ro.observe(root);
    let alive = true;
    document.fonts.ready
      .then(() => {
        if (alive) doMeasure();
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      ro.disconnect();
    };
  }, []);

  // Mode change: snapshot poses for the staggered choreographed transition,
  // then re-cache centers (font-size may differ between modes).
  useEffect(() => {
    modeRef.current = mode;
    const s = loopRef.current;
    if (!s) return;
    s.from = s.poses.map((p) => ({ ...p }));
    s.blendStart = performance.now();
    if (rootRef.current) measure(rootRef.current, glyphRefs.current, s);
  }, [mode]);

  // The rAF loop — per-glyph damped springs, transform-only writes.
  useEffect(() => {
    if (!active || reduced) return;
    const s = loopRef.current;
    const seeds = seedsRef.current;
    if (!s || !seeds) return;

    let raf = 0;
    s.last = performance.now();

    const tick = (now: number) => {
      const dt = clamp((now - s.last) / 1000, 0.0001, 0.05);
      s.last = now;
      const t = now / 1000;
      const m = modeRef.current;

      // Smooth the pointer once per frame (shared by all glyphs).
      s.spx = damp(s.spx, s.px, 12, dt);
      s.spy = damp(s.spy, s.py, 12, dt);

      // ORBIT: pointer distance from viewport center drives radius + speed.
      let orbitR = 1;
      let orbitSpeed = 0.9;
      if (s.seen && s.vw > 0 && s.vh > 0) {
        const pd = Math.hypot(s.spx - s.vw / 2, s.spy - s.vh / 2);
        const maxD = Math.hypot(s.vw, s.vh) / 2 || 1;
        const k = clamp(pd / maxD, 0, 1);
        orbitR = lerp(0.55, 1.9, k);
        orbitSpeed = 0.9 * lerp(0.5, 1.6, k);
      }
      if (m === 3) s.orbit += dt * orbitSpeed;

      for (let idx = 0; idx < GLYPHS.length; idx += 1) {
        const el = glyphRefs.current[idx];
        if (!el) continue;
        const pose = s.poses[idx];
        const target = computeTargets(m, {
          i: idx,
          t,
          px: s.spx,
          py: s.spy,
          seen: s.seen,
          bx: s.centers[idx].x,
          by: s.centers[idx].y,
          vw: s.vw,
          vh: s.vh,
          orbit: s.orbit,
          orbitR,
          seed: seeds[idx],
          cur: pose,
        });

        // Choreographed mode transition: per-glyph stagger, ease-out blend
        // from the pose snapshot taken at mode change.
        const bk = clamp((now - s.blendStart - idx * STAGGER_MS) / BLEND_MS, 0, 1);
        const be = 1 - Math.pow(1 - bk, 3);
        const fr = s.from[idx];
        pose.tx = damp(pose.tx, lerp(fr.tx, target.tx, be), 7, dt);
        pose.ty = damp(pose.ty, lerp(fr.ty, target.ty, be), 7, dt);
        pose.rot = damp(pose.rot, lerp(fr.rot, target.rot, be), 8, dt);
        pose.scale = damp(pose.scale, lerp(fr.scale, target.scale, be), 8, dt);
        pose.wght = damp(pose.wght, lerp(fr.wght, target.wght, be), 6, dt);
        pose.sizeMul = damp(pose.sizeMul, lerp(fr.sizeMul, target.sizeMul, be), 8, dt);
        pose.warmth = damp(pose.warmth, lerp(fr.warmth, target.warmth, be), 6, dt);

        // Write: transform only (+ WEIGHT extras). Never layout props.
        el.style.transform =
          `translate3d(${pose.tx.toFixed(2)}px, ${pose.ty.toFixed(2)}px, 0) ` +
          `rotate(${pose.rot.toFixed(2)}deg) scale(${pose.scale.toFixed(3)})`;

        if (m === 2) {
          const fs = s.baseFont * pose.sizeMul;
          if (Math.abs(fs - s.fsCache[idx]) > 0.5) {
            el.style.fontSize = `${fs.toFixed(1)}px`;
            s.fsCache[idx] = fs;
          }
          el.style.fontVariationSettings = `'wght' ${Math.round(pose.wght)}`;
          el.style.color =
            pose.warmth > 0.02
              ? mixHex(PALETTE.ink, PALETTE.amber, clamp(pose.warmth, 0, 1))
              : '';
        } else {
          if (el.style.fontSize !== '') {
            el.style.fontSize = '';
            s.fsCache[idx] = -1;
          }
          if (el.style.fontVariationSettings !== '') el.style.fontVariationSettings = '';
          if (el.style.color !== '') el.style.color = '';
        }
      }

      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf);
        raf = 0;
      } else if (raf === 0) {
        s.last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [active, reduced]);

  return (
    <div
      ref={rootRef}
      className={reduced ? 'kinetic-type reduced' : 'kinetic-type'}
      onClick={nextMode}
      onPointerMove={(e) => handlePointer(e.clientX, e.clientY)}
      onPointerDown={(e) => handlePointer(e.clientX, e.clientY)}
    >
      <div className="kinetic-type__stage" aria-hidden="true">
        {GLYPHS.map((g, i) => (
          <span
            key={g}
            ref={(el) => {
              glyphRefs.current[i] = el;
            }}
            className="kinetic-type__glyph"
          >
            {g}
          </span>
        ))}
      </div>

      <div key={mode} className="kinetic-type__mode" aria-live="polite">
        <span className="kinetic-type__mode-num">Mode {String(mode + 1).padStart(2, '0')}</span>
        <span className="kinetic-type__mode-sep">—</span>
        <span>{MODE_NAMES[mode]}</span>
      </div>

      <button
        type="button"
        className="kinetic-type__next"
        onClick={(e) => {
          e.stopPropagation();
          nextMode();
        }}
      >
        Next mode
      </button>

      <SceneHint style={{ position: 'absolute', left: 32, bottom: 110 }}>
        CLICK TO TRANSFORM — MOVE TO DISTURB
      </SceneHint>
    </div>
  );
}
