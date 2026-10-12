import type { CSSProperties } from 'react';

interface Props {
  children: string;
  style?: CSSProperties;
}

/** Elegant uppercase interaction hint with an amber tick. */
export function SceneHint({ children, style }: Props) {
  return (
    <p className="scene-hint" style={style}>
      {children}
    </p>
  );
}
