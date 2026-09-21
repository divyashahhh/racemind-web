import { degradationDelta, availableDryCompounds } from './scenario';
import { DRY_COMPOUNDS, type CircuitModel, type Compound, type Stint, type Strategy } from './types';

/**
 * Deterministic race time for a plan, ignoring noise, safety cars and rain.
 *
 * Used only as a cheap screen: enumerating every pit-lap/compound combination and
 * Monte Carlo-ing all of them would be thousands of times slower than the user will
 * tolerate. So we score everything deterministically, keep the best handful, and
 * spend the simulation budget only on those.
 */
/**
 * cost[compound][start][end] = green-flag time for a stint of that compound over
 * laps [start, end].
 *
 * The exhaustive search evaluates millions of candidate plans. Re-summing each
 * stint's laps inside that loop makes enumeration take tens of seconds on a 70-lap
 * circuit; with the table it is a handful of array lookups per plan.
 */
export type StintCostTable = Map<Compound, Float64Array[]>;

export function buildCostTable(circuit: CircuitModel): StintCostTable {
  const n = circuit.raceLaps;
  const table: StintCostTable = new Map();

  for (const compound of DRY_COMPOUNDS) {
    const curve = circuit.curves[compound];
    if (!curve) continue;
    const rows: Float64Array[] = new Array(n + 2);
    for (let start = 1; start <= n; start++) {
      const row = new Float64Array(n + 2);
      let running = 0;
      for (let lap = start; lap <= n; lap++) {
        running +=
          circuit.baseLapTime +
          degradationDelta(curve, lap - start) +
          circuit.fuelEffect * (n - lap);
        row[lap] = running;
      }
      rows[start] = row;
    }
    table.set(compound, rows);
  }
  return table;
}

/**
 * Deterministic race time for a plan, ignoring noise, safety cars and rain.
 *
 * Used as a cheap screen: Monte Carlo-ing every pit-lap/compound combination would be
 * thousands of times slower than the user will tolerate. So we score everything
 * deterministically, keep the best handful, and spend the simulation budget on those.
 */
/**
 * Expected cost of one pit stop.
 *
 * Must be the *mean* of the log-normal, not its median. The simulator samples the full
 * distribution, whose fat right tail puts the mean well above the median (~3.7s versus
 * ~1.9s of stationary time). Screening on the median silently under-prices every extra
 * stop, so the deterministic shortlist and the Monte Carlo disagree about which plan is
 * best — and any calibration done against the screen is tuned to the wrong number.
 */
export function expectedStopCost(circuit: CircuitModel): number {
  return circuit.pitLaneLoss + Math.exp(circuit.pitStopMu + (circuit.pitStopSigma ** 2) / 2);
}

export function deterministicTime(
  circuit: CircuitModel,
  stints: Stint[],
  table?: StintCostTable,
): number {
  const costs = table ?? buildCostTable(circuit);
  const stopCost = expectedStopCost(circuit);
  let total = 0;

  for (let i = 0; i < stints.length; i++) {
    const stint = stints[i];
    const rows = costs.get(stint.compound);
    // The table assumes a stint starts on a fresh set; a scrubbed set falls back to
    // the direct sum rather than silently using the wrong curve.
    if (!rows || stint.startAge !== 0) return directTime(circuit, stints);
    const row = rows[stint.startLap];
    if (!row) return Number.POSITIVE_INFINITY;
    total += row[stint.endLap];
    if (i < stints.length - 1) total += stopCost;
  }
  return total;
}

function directTime(circuit: CircuitModel, stints: Stint[]): number {
  const n = circuit.raceLaps;
  const stopCost = expectedStopCost(circuit);
  let total = 0;
  for (let i = 0; i < stints.length; i++) {
    const stint = stints[i];
    const curve = circuit.curves[stint.compound];
    if (!curve) return Number.POSITIVE_INFINITY;
    for (let lap = stint.startLap; lap <= stint.endLap; lap++) {
      total +=
        circuit.baseLapTime +
        degradationDelta(curve, lap - stint.startLap + stint.startAge) +
        circuit.fuelEffect * (n - lap);
    }
    if (i < stints.length - 1) total += stopCost;
  }
  return total;
}

function buildStints(pitLaps: number[], compounds: Compound[], raceLaps: number): Stint[] {
  const stints: Stint[] = [];
  let start = 1;
  for (let i = 0; i < compounds.length; i++) {
    const end = i < pitLaps.length ? pitLaps[i] : raceLaps;
    stints.push({ compound: compounds[i], startLap: start, endLap: end, startAge: 0 });
    start = end + 1;
  }
  return stints;
}

/** Compound sequences of the given length that satisfy the two-dry-compound rule. */
export function legalCompoundSequences(
  circuit: CircuitModel,
  numStints: number,
): Compound[][] {
  const pool = availableDryCompounds(circuit);
  const out: Compound[][] = [];
  const walk = (path: Compound[]) => {
    if (path.length === numStints) {
      // FIA sporting regulations: at least two different dry compounds must be used
      // in a dry race. A one-compound plan is not merely slow, it is illegal.
      if (new Set(path).size >= 2) out.push([...path]);
      return;
    }
    for (const c of pool) {
      path.push(c);
      walk(path);
      path.pop();
    }
  };
  walk([]);
  return out;
}

export interface EnumerationOptions {
  minStops: number;
  maxStops: number;
  /** Lap spacing of the pit-lap search grid. 1 is exhaustive; 2 halves the work. */
  gridStep: number;
  /** Shortest permitted stint, in laps. */
  minStintLaps: number;
  /** How many plans to hand on to the Monte Carlo stage. */
  shortlist: number;
}

export const DEFAULT_ENUMERATION: EnumerationOptions = {
  minStops: 1,
  maxStops: 3,
  gridStep: 1,
  minStintLaps: 5,
  shortlist: 6,
};

function label(stints: Stint[]): string {
  const stops = stints.length - 1;
  const seq = stints.map((s) => s.compound[0]).join('-');
  return `${stops}-stop ${seq}`;
}

/**
 * Enumerate every legal plan on the pit-lap grid, score it deterministically, and
 * return a shortlist that spans genuinely different strategic ideas.
 *
 * Two selection rules do the real work here, and both were added after watching what
 * a naive "top 6 by time" produced:
 *
 *  1. **Balance across stop counts.** Ranked purely by time, all six slots fill with
 *     one-stop plans at almost every circuit, because the best one-stops cluster
 *     together. But "one stop or two?" is *the* strategic question, and a shortlist
 *     that cannot show both sides of it is useless. So each stop count gets its own
 *     quota before any is allowed a second entry.
 *
 *  2. **Collapse mirrored orders.** `SOFT-MEDIUM` and `MEDIUM-SOFT` are the same idea
 *     with the stints swapped and are usually within a few tenths. Keying the
 *     de-duplication on the compound *multiset* rather than the sequence stops the
 *     list filling with pairs that look different and behave identically.
 */
export function enumerateStrategies(
  circuit: CircuitModel,
  options: EnumerationOptions = DEFAULT_ENUMERATION,
): Strategy[] {
  const n = circuit.raceLaps;
  const table = buildCostTable(circuit);
  const byStopCount = new Map<number, { stints: Stint[]; time: number }[]>();

  for (let stops = options.minStops; stops <= options.maxStops; stops++) {
    const numStints = stops + 1;
    const sequences = legalCompoundSequences(circuit, numStints);
    if (sequences.length === 0) continue;

    // Best plan per compound multiset, so mirrored orders collapse to one entry.
    const bestPerFamily = new Map<string, { stints: Stint[]; time: number }>();

    const walkLaps = (path: number[]) => {
      if (path.length === stops) {
        if (n - path[path.length - 1] < options.minStintLaps) return;
        for (const compounds of sequences) {
          const stints = buildStints(path, compounds, n);
          const time = deterministicTime(circuit, stints, table);
          if (!Number.isFinite(time)) continue;
          const family = [...compounds].sort().join('');
          const incumbent = bestPerFamily.get(family);
          if (!incumbent || time < incumbent.time) bestPerFamily.set(family, { stints, time });
        }
        return;
      }
      const prev = path.length ? path[path.length - 1] : 0;
      const remainingStints = stops - path.length;
      const latest = n - options.minStintLaps * remainingStints;
      for (let lap = prev + options.minStintLaps; lap <= latest; lap += options.gridStep) {
        path.push(lap);
        walkLaps(path);
        path.pop();
      }
    };
    walkLaps([]);

    const ranked = [...bestPerFamily.values()].sort((a, b) => a.time - b.time);
    if (ranked.length) byStopCount.set(stops, ranked);
  }

  // Round-robin across stop counts: every stop count contributes its best plan before
  // any contributes a second.
  const stopCounts = [...byStopCount.keys()].sort((a, b) => a - b);
  const cursors = new Map(stopCounts.map((k) => [k, 0]));
  const picked: Strategy[] = [];

  while (picked.length < options.shortlist) {
    let addedThisRound = false;
    for (const stops of stopCounts) {
      if (picked.length >= options.shortlist) break;
      const pool = byStopCount.get(stops)!;
      const cursor = cursors.get(stops)!;
      if (cursor >= pool.length) continue;
      cursors.set(stops, cursor + 1);
      const candidate = pool[cursor];
      picked.push({
        id: `${candidate.stints.map((s) => s.compound).join('>')}@${candidate.stints.map((s) => s.endLap).join(',')}`,
        label: label(candidate.stints),
        stints: candidate.stints,
      });
      addedThisRound = true;
    }
    if (!addedThisRound) break;
  }

  // Present fastest first, while keeping the diversity the quota bought.
  return picked.sort(
    (a, b) => deterministicTime(circuit, a.stints, table) - deterministicTime(circuit, b.stints, table),
  );
}

/** Re-derive a Strategy after the user drags a pit stop to a new lap. */
export function withPitLaps(strategy: Strategy, pitLaps: number[], raceLaps: number): Strategy {
  const compounds = strategy.stints.map((s) => s.compound);
  const stints = buildStints(pitLaps, compounds, raceLaps);
  return { ...strategy, id: `${compounds.join('>')}@${pitLaps.join(',')}`, stints };
}

/** Swap the compound on one stint, keeping the pit laps fixed. */
export function withCompound(strategy: Strategy, stintIndex: number, compound: Compound): Strategy {
  const stints = strategy.stints.map((s, i) => (i === stintIndex ? { ...s, compound } : s));
  return {
    ...strategy,
    id: `${stints.map((s) => s.compound).join('>')}@${stints.map((s) => s.endLap).join(',')}`,
    label: label(stints),
    stints,
  };
}

/** True when the plan uses at least two distinct dry compounds. */
export function isLegal(strategy: Strategy): boolean {
  const dry = strategy.stints
    .map((s) => s.compound)
    .filter((c) => c === 'SOFT' || c === 'MEDIUM' || c === 'HARD');
  return new Set(dry).size >= 2;
}
