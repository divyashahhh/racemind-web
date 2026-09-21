/** Seconds -> "1:32:04.812", the way a race time is actually written. */
export function formatRaceTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds)) return '—';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.round((totalSeconds - Math.floor(totalSeconds)) * 1000);
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const body = `${mm}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
  return hours > 0 ? `${hours}:${body}` : body;
}

/** Seconds -> "1:18.412", for a single lap. */
export function formatLapTime(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toFixed(3).padStart(6, '0')}`;
}

/** Signed gap, e.g. "+1.284" / "-0.377". */
export function formatDelta(seconds: number, digits = 3): string {
  if (!Number.isFinite(seconds)) return '—';
  const sign = seconds > 0 ? '+' : seconds < 0 ? '−' : '';
  return `${sign}${Math.abs(seconds).toFixed(digits)}`;
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/** Linear interpolation of a value in [d0,d1] onto [r0,r1]. */
export function scale(value: number, d0: number, d1: number, r0: number, r1: number): number {
  if (d1 === d0) return r0;
  return r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}

/** "Nice" axis ticks covering [lo,hi] with roughly `count` steps. */
export function niceTicks(lo: number, hi: number, count = 5): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo === hi) return [lo];
  const span = hi - lo;
  const rawStep = span / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / magnitude;
  const step = (normalized >= 5 ? 5 : normalized >= 2 ? 2 : 1) * magnitude;
  const start = Math.ceil(lo / step) * step;
  const ticks: number[] = [];
  for (let t = start; t <= hi + step * 1e-9; t += step) ticks.push(Number(t.toFixed(10)));
  return ticks;
}
