# AETHER — Scene Worker Contract

## Project
`~/workspace/aether/` — React 18 + TypeScript (strict) + Vite 5. No new npm
dependencies. No external assets, fonts, images, or network calls.

## Art direction (non-negotiable)
- Dark cinematic: background `#07070c`, ink `#f2efe6` (warm ivory).
- Accents used sparingly: ember amber `#e8a84c`, glacier `#93cfe6`.
- NO random neon gradients, NO cheap glow, NO generic templates.
- Typography: Fraunces Variable (display serif) + Space Grotesk Variable (UI).
  Use `.scene-title` for monumental titles, `<SceneHint>` for hints.
- Subtle film grain + vignette are applied globally by the shell — do not add your own.

## Scene component API
Each scene lives in `src/scenes/<Name>.tsx` and MUST:

```tsx
export function ParticleUniverse({ active }: { active: boolean }) {
  /* ... */
}
```

- Named export matching the file (see names in App.tsx).
- Accept `{ active: boolean }`. When `active` becomes false (or on unmount):
  cancel ALL requestAnimationFrame loops and remove ALL listeners. Only the
  active scene is mounted, so unmount cleanup is sufficient.
- Fill the viewport: root element `position:absolute; inset:0` (or use
  `.canvas-fill` for the canvas). The shell reserves top (~70px) and bottom
  (~90px) for chrome — keep key content clear of those bands on small screens.
- Paint a fully composed, beautiful FIRST FRAME synchronously (no blank flash).
- Use `useCanvas2d()` from `src/hooks/useCanvas2d.ts` for canvas sizing/DPR.
- Use `src/lib/perf.ts`: `scaledCount(n)` for particle/effect budgets,
  `damp`, `clamp`, `lerp`. Respect `usePrefersReducedMotion()`:
  when reduced, render ONE beautiful static frame (no loops) and make
  interactions instant/one-shot.
- Colors: import from `src/styles/palette.ts` (`PALETTE`, `hexA`, `mixHex`).
- Hints: render `<SceneHint>` with the hint text from your spec, positioned
  bottom-left above the nav (e.g. `position:absolute; left:32px; bottom:110px`).
- Touch: pointer events must work with touch (`touch-action: none` is in
  `.canvas-fill`; add `onPointerDown/Move/Up` handling, not just mouse).
- Keyboard: every clickable control must be a real `<button>`; canvas-only
  scenes should expose at least one keyboard alternative where specced.
- TypeScript strict: no unused vars, no `any` leaks, `tsc --noEmit` must pass.
- Cleanup: every `requestAnimationFrame`, listener, observer, and timeout
  created in an effect must be cancelled in its cleanup function.

## Performance budget (the user reported lag on a previous art piece)
- Desktop DPR cap 2, mobile 1.5 (handled by `useCanvas2d`).
- Prefer transform/opacity and canvas redraws over layout thrash.
- Particle counts via `scaledCount()`: universe ~1000 full, sculpture ~7 rings,
  type ~ one word of glyphs, exhibition varies.
- Pause work when tab hidden (`document.visibilitychange` → stop rAF).
- Keep per-frame allocations near zero (reuse objects/arrays).

## What NOT to do
- Do not modify `src/App.tsx`, `src/index.css`, `src/styles/*`, `src/lib/*`,
  `src/hooks/*`, `src/components/*`, `index.html`.
- Do not add dependencies or global CSS.
- Do not leave `console.log` in the code.
