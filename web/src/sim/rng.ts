/**
 * Seeded pseudo-random number generation.
 *
 * The Monte Carlo layer needs reproducibility (same seed -> same answer, so the UI
 * does not flicker between renders) and it needs *common random numbers*: every
 * candidate strategy must be scored against the identical sampled race scenario.
 * Math.random cannot give us either.
 */

/** mulberry32 — small, fast, good enough for Monte Carlo. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box-Muller. */
export function normal(rng: () => number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Normal truncated to [lo, hi], resampled rather than clamped to avoid mass at the bounds. */
export function truncatedNormal(
  rng: () => number,
  mean: number,
  sd: number,
  lo: number,
  hi: number,
): number {
  for (let i = 0; i < 24; i++) {
    const x = mean + sd * normal(rng);
    if (x >= lo && x <= hi) return x;
  }
  return Math.min(hi, Math.max(lo, mean));
}

/**
 * Lognormal draw parameterised by the mean and sd of the *underlying* normal.
 * Used for pit stop durations, whose right tail (a slow wheel gun, a released-unsafe
 * hold) is exactly what decides marginal strategy calls.
 */
export function lognormal(rng: () => number, mu: number, sigma: number): number {
  return Math.exp(mu + sigma * normal(rng));
}

/** Percentile of an already-sorted ascending array, linearly interpolated. */
export function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}
