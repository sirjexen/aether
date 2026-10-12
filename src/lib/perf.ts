/**
 * Performance budget helpers. The user previously reported a similar
 * interactive piece felt laggy, so every scene must adapt to device
 * capability and cap device-pixel-ratio aggressively.
 */

export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 500)
  );
}

/** Cap for canvas backing-store DPR: 2 on desktop, 1.5 on mobile. */
export function dprCap(): number {
  return isMobile() ? 1.5 : 2;
}

/**
 * Scale a "full power" particle/effect count down to what the device
 * can handle. Desktops with 8+ cores get the full count; fewer cores
 * or mobile get a reduced count. Never below 35% of full.
 */
export function scaledCount(full: number): number {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  let factor = 1;
  if (isMobile()) factor = 0.45;
  else if (cores <= 4) factor = 0.6;
  else if (cores <= 6) factor = 0.8;
  return Math.max(Math.round(full * factor), Math.round(full * 0.35));
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/** Clamp a value into [min, max]. */
export const clamp = (v: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, v));

/** Linear interpolation. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Frame-rate independent damping: moves `current` toward `target`.
 * `lambda` ~ higher = snappier. Returns the new value.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}
