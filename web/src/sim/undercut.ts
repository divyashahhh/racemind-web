import { degradationDelta } from './scenario';
import type { CircuitModel, Compound } from './types';

/**
 * Seconds lost on the first flying lap after a stop, warming the tyre up and
 * rejoining. Real undercuts live or die on this number: it is the tax you pay for
 * the fresh-rubber advantage, and on cold-track circuits it can cancel the gain
 * entirely.
 */
export const OUT_LAP_PENALTY = 1.6;

/** Seconds lost per lap when running within DRS range behind another car. */
export const TRAFFIC_PENALTY = 0.7;

export interface UndercutInput {
  circuit: CircuitModel;
  /** Compound and age of the tyre currently fitted, at the moment of the decision. */
  currentCompound: Compound;
  currentAge: number;
  /** Compound being fitted at the stop. */
  freshCompound: Compound;
  /** How many laps earlier than the rival you stop. */
  lapsEarly: number;
}

/**
 * Net time gained on a rival by stopping `lapsEarly` laps before they do.
 *
 * Both cars pay the same pit loss, so it cancels and drops out of the comparison.
 * What remains is: for each lap of the window you are on a fresh tyre while they are
 * on an ageing one, minus the out-lap tax you pay once.
 *
 * A positive result means the undercut works. A negative result means the overcut
 * is the better call — which on low-degradation circuits is very often true, and is
 * exactly the distinction a single "optimal total race time" number cannot express.
 */
export function undercutGain(input: UndercutInput): number {
  const { circuit, currentCompound, currentAge, freshCompound, lapsEarly } = input;
  const oldCurve = circuit.curves[currentCompound];
  const freshCurve = circuit.curves[freshCompound];
  if (!oldCurve || !freshCurve) return 0;

  let gain = -OUT_LAP_PENALTY;
  for (let k = 1; k <= lapsEarly; k++) {
    const rivalPace = degradationDelta(oldCurve, currentAge + k);
    const ourPace = degradationDelta(freshCurve, k);
    gain += rivalPace - ourPace;
  }
  return gain;
}

/**
 * Undercut gain as a function of the lap you stop on, for the whole race.
 * Feeds the undercut chart: where the curve crosses zero is the lap the undercut
 * stops paying.
 */
export function undercutCurve(
  circuit: CircuitModel,
  currentCompound: Compound,
  freshCompound: Compound,
  lapsEarly = 1,
): { lap: number; gain: number }[] {
  const out: { lap: number; gain: number }[] = [];
  for (let lap = 1; lap <= circuit.raceLaps; lap++) {
    out.push({
      lap,
      gain: undercutGain({
        circuit,
        currentCompound,
        currentAge: lap,
        freshCompound,
        lapsEarly,
      }),
    });
  }
  return out;
}

/**
 * The lap on which an undercut attempt stops being worth it — the first lap where
 * the gain has fallen below zero after previously being positive.
 */
export function undercutWindowEnd(curve: { lap: number; gain: number }[]): number | null {
  let wasPositive = false;
  for (const point of curve) {
    if (point.gain > 0) wasPositive = true;
    else if (wasPositive) return point.lap;
  }
  return null;
}
