# AETHER — Interactive Digital Playground

An interactive digital exhibition in four movements. React 18 + TypeScript +
Vite 5 + Canvas 2D. No backend, no keys, fully offline-capable.

## Quick start

```bash
npm ci
npm run dev      # dev server with HMR
npm run build    # type-check + production build into dist/
npx vite preview # serve the production build
```

You can also open `dist/index.html` directly from disk — no server needed
(the build uses relative asset paths).

## Scenes

- `src/scenes/ParticleUniverse.tsx` — 01 · generative particle field,
  pointer repulsion, click ripples, Converge moment
- `src/scenes/ReactiveSculpture.tsx` — 02 · "Glass Organ", drag-to-sculpt
  petal rings with spring physics
- `src/scenes/KineticType.tsx` — 03 · kinetic typography lab, 4 click-cycled
  modes (Tide / Scatter / Weight / Orbit)
- `src/scenes/Exhibition.tsx` — 04 · gallery of 3 generative artworks + Fin

Shared: `src/lib/perf.ts` (adaptive budgets), `src/hooks/useCanvas2d.ts`,
`src/styles/palette.ts`, `CONTRACT.md` (scene worker contract).

## QA

`qa/` holds the Playwright-based screenshot + interaction + FPS scripts used
for verification (headless Chromium at `/opt/meta-chromium/chrome`):

```bash
node qa/screenshots.mjs    # capture all scenes (needs dist/ built)
node qa/interactions.mjs   # exercise interactive paths, fail on any error
node qa/fps.mjs            # rough headless FPS probe
```
