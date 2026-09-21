import type { Compound } from '@/sim/types';

/**
 * Pirelli compound identity. An F1 fan decodes these colours faster than any label,
 * so they are treated as data, not decoration.
 */
export const TYRE: Record<Compound, { hex: string; letter: string; label: string; onDark: boolean }> = {
  SOFT:         { hex: '#e8352e', letter: 'S', label: 'Soft',         onDark: true },
  MEDIUM:       { hex: '#f5c518', letter: 'M', label: 'Medium',       onDark: false },
  HARD:         { hex: '#ebebeb', letter: 'H', label: 'Hard',         onDark: false },
  INTERMEDIATE: { hex: '#3fb950', letter: 'I', label: 'Intermediate', onDark: true },
  WET:          { hex: '#2f81f7', letter: 'W', label: 'Wet',          onDark: true },
};

export function tyreOf(compound: string) {
  return TYRE[compound as Compound] ?? { hex: '#6f7480', letter: '?', label: compound, onDark: true };
}

/** Series colours for comparing plans, tuned to sit on the near-black ground. */
export const SERIES = ['#00d7b6', '#ff8a4c', '#a371f7', '#4c9aff', '#f5c518', '#ff6b9d'] as const;

export const seriesColor = (i: number) => SERIES[i % SERIES.length];
