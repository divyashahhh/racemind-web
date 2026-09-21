import type { Compound } from '../sim/types';

/**
 * Official Pirelli compound colours. Getting these wrong is instantly legible to
 * anyone who watches the sport — the previous prototype painted HARD green, which
 * reads as "intermediate" and quietly undermines everything else on screen.
 */
export const COMPOUND_COLOR: Record<Compound, string> = {
  SOFT: '#e8352e',
  MEDIUM: '#f5c518',
  HARD: '#e8e8e8',
  INTERMEDIATE: '#3fb950',
  WET: '#2f81f7',
};

export const COMPOUND_TEXT: Record<Compound, string> = {
  SOFT: '#ffffff',
  MEDIUM: '#1a1a1a',
  HARD: '#1a1a1a',
  INTERMEDIATE: '#ffffff',
  WET: '#ffffff',
};

export const COMPOUND_SHORT: Record<Compound, string> = {
  SOFT: 'S',
  MEDIUM: 'M',
  HARD: 'H',
  INTERMEDIATE: 'I',
  WET: 'W',
};

/** Distinguishable series colours for comparing strategies, in draw order. */
export const SERIES_COLORS = [
  '#4c9aff',
  '#ff7b4c',
  '#a371f7',
  '#3fb950',
  '#f5c518',
  '#ff6b9d',
] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}
