import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import { ParticleUniverse } from './scenes/ParticleUniverse';
import { ReactiveSculpture } from './scenes/ReactiveSculpture';
import { KineticType } from './scenes/KineticType';
import { Exhibition } from './scenes/Exhibition';

interface SceneDef {
  id: string;
  num: string;
  label: string;
  Component: (props: { active: boolean }) => JSX.Element;
}

const SCENES: SceneDef[] = [
  { id: 'universe', num: '01', label: 'Universe', Component: ParticleUniverse },
  { id: 'sculpture', num: '02', label: 'Sculpture', Component: ReactiveSculpture },
  { id: 'type', num: '03', label: 'Typography', Component: KineticType },
  { id: 'exhibition', num: '04', label: 'Exhibition', Component: Exhibition },
];

export default function App() {
  const [index, setIndex] = useState(0);

  const goTo = useCallback((i: number) => {
    setIndex(((i % SCENES.length) + SCENES.length) % SCENES.length);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') goTo(index + 1);
      else if (e.key === 'ArrowLeft') goTo(index - 1);
      else if (e.key >= '1' && e.key <= '4') goTo(Number(e.key) - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, goTo]);

  const { Component } = SCENES[index];

  return (
    <div className="aether">
      <header className="aether-header">
        <button
          className="aether-wordmark"
          onClick={() => goTo(0)}
          aria-label="AETHER — back to the beginning"
        >
          AETHER<span>.</span>
        </button>
        <div className="aether-counter" aria-live="polite">
          <strong>{SCENES[index].num}</strong> / 04 — {SCENES[index].label}
        </div>
      </header>

      <main className="aether-stage">
        <div className="scene-view" key={SCENES[index].id}>
          <Component active />
        </div>
      </main>

      <nav className="aether-nav" aria-label="Scenes">
        <div className="aether-nav-inner">
          <button
            className="aether-nav-arrow"
            onClick={() => goTo(index - 1)}
            aria-label="Previous scene"
          >
            ←
          </button>
          {SCENES.map((s, i) => (
            <button
              key={s.id}
              className={`aether-nav-item${i === index ? ' active' : ''}`}
              onClick={() => goTo(i)}
              aria-current={i === index ? 'true' : undefined}
              aria-label={`Scene ${s.num}: ${s.label}`}
            >
              <span className="num">{s.num}</span>
              <span className="lbl">{s.label}</span>
            </button>
          ))}
          <span className="aether-nav-divider" />
          <button
            className="aether-nav-arrow"
            onClick={() => goTo(index + 1)}
            aria-label="Next scene"
          >
            →
          </button>
        </div>
      </nav>

      <div className="vignette" aria-hidden="true" />
      <div className="grain" aria-hidden="true" />
    </div>
  );
}
