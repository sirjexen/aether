/** Single source of truth for canvas colors — mirrors tokens.css. */
export const PALETTE = {
  bg: '#07070c',
  bg2: '#0d0d15',
  ink: '#f2efe6',
  amber: '#e8a84c',
  glacier: '#93cfe6',
} as const;

/** Append alpha to a #rrggbb hex color: hexA('#e8a84c', 0.5) -> 'rgba(232,168,76,0.5)' */
export function hexA(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Linear interpolation between two hex colors, t in [0,1]. */
export function mixHex(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `#${m.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
