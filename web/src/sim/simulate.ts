import { quantileSorted } from './rng';
import { degradationDelta, sampleScenario, type Scenario } from './scenario';
import type {
  CircuitModel,
  SimulationSettings,
  Strategy,
  StrategyOutcome,
} from './types';

/** Penalty per lap for running dry tyres on a wet track, and inters on a dry one. */
const WRONG_TYRE_PENALTY = 9.0;
const INTER_ON_DRY_PENALTY = 2.5;

/**
 * Run one strategy through one sampled scenario, returning cumulative elapsed time
 * after each lap. This is the innermost loop of the whole app: keep it allocation-free
 * beyond the single output array.
 */
export function runStrategy(
  circuit: CircuitModel,
  strategy: Strategy,
  scenario: Scenario,
): number[] {
  const n = circuit.raceLaps;
  const cumulative = new Array<number>(n + 1);
  cumulative[0] = 0;

  let stintIndex = 0;
  let stopsTaken = 0;
  let elapsed = 0;

  for (let lap = 1; lap <= n; lap++) {
    let stint = strategy.stints[stintIndex];
    // Guard against a malformed plan that does not cover the full distance.
    while (stint && lap > stint.endLap && stintIndex < strategy.stints.length - 1) {
      stintIndex += 1;
      stint = strategy.stints[stintIndex];
    }
    if (!stint) stint = strategy.stints[strategy.stints.length - 1];

    const age = lap - stint.startLap + stint.startAge;
    const curve = scenario.coeffs[stint.compound];

    let lapTime =
      circuit.baseLapTime +
      degradationDelta(curve, age) +
      // Fuel: heaviest on lap 1, lightest at the flag. The car gets *faster* as the
      // race runs, which is the opposite of what a naive per-stint model produces.
      circuit.fuelEffect * (n - lap) +
      scenario.noise[lap];

    if (scenario.wet[lap]) {
      if (stint.compound === 'SOFT' || stint.compound === 'MEDIUM' || stint.compound === 'HARD') {
        lapTime += WRONG_TYRE_PENALTY;
      }
    } else if (stint.compound === 'INTERMEDIATE' || stint.compound === 'WET') {
      lapTime += INTER_ON_DRY_PENALTY;
    }

    if (scenario.safetyCar[lap]) {
      // Under a safety car the field runs to a delta; tyre state barely matters.
      lapTime = circuit.baseLapTime * circuit.safetyCar.lapTimeMultiplier + scenario.noise[lap] * 0.2;
    }

    // The pit stop is paid on the lap the driver enters the pit lane.
    const isLastStint = stintIndex === strategy.stints.length - 1;
    if (!isLastStint && lap === stint.endLap) {
      const stationary = scenario.pitDurations[Math.min(stopsTaken, scenario.pitDurations.length - 1)];
      const fullLoss = circuit.pitLaneLoss + stationary;
      lapTime += scenario.safetyCar[lap]
        ? fullLoss * circuit.safetyCar.pitLossDiscount
        : fullLoss;
      stopsTaken += 1;
    }

    elapsed += lapTime;
    cumulative[lap] = elapsed;
  }

  return cumulative;
}

/**
 * Monte Carlo over all candidate strategies using common random numbers.
 *
 * Returns one outcome per strategy plus the raw per-iteration totals, which the
 * caller needs to compute exact pairwise win probabilities.
 */
export function simulate(
  circuit: CircuitModel,
  strategies: Strategy[],
  settings: SimulationSettings,
): StrategyOutcome[] {
  const n = circuit.raceLaps;
  const iterations = settings.iterations;

  // totals[s][i] and traces[s][lap][i]
  const totals: number[][] = strategies.map(() => new Array<number>(iterations));
  const lapSamples: number[][][] = strategies.map(() =>
    Array.from({ length: n + 1 }, () => new Array<number>(iterations)),
  );

  for (let i = 0; i < iterations; i++) {
    const scenario = sampleScenario(circuit, settings, i);
    for (let s = 0; s < strategies.length; s++) {
      const cumulative = runStrategy(circuit, strategies[s], scenario);
      totals[s][i] = cumulative[n];
      const store = lapSamples[s];
      for (let lap = 0; lap <= n; lap++) store[lap][i] = cumulative[lap];
    }
  }

  return strategies.map((strategy, s) => {
    const samples = [...totals[s]].sort((a, b) => a - b);
    const medianTrace = new Array<number>(n + 1);
    const p10Trace = new Array<number>(n + 1);
    const p90Trace = new Array<number>(n + 1);
    for (let lap = 0; lap <= n; lap++) {
      const col = lapSamples[s][lap].slice().sort((a, b) => a - b);
      medianTrace[lap] = quantileSorted(col, 0.5);
      p10Trace[lap] = quantileSorted(col, 0.1);
      p90Trace[lap] = quantileSorted(col, 0.9);
    }
    return {
      strategyId: strategy.id,
      mean: samples.reduce((a, b) => a + b, 0) / samples.length,
      p10: quantileSorted(samples, 0.1),
      p50: quantileSorted(samples, 0.5),
      p90: quantileSorted(samples, 0.9),
      samples,
      rawTotals: totals[s],
      medianTrace,
      p10Trace,
      p90Trace,
    };
  });
}

/**
 * Probability that strategy A finishes ahead of strategy B.
 *
 * Because both were run against identical scenarios, comparing the paired samples
 * index-by-index is valid and far more sensitive than comparing their marginals.
 * Pass `rawTotals` (iteration order), never `samples` (sorted) — sorting destroys
 * the pairing and silently turns this into a much noisier estimate.
 */
export function winProbability(a: number[], b: number[]): number {
  let wins = 0;
  for (let i = 0; i < a.length; i++) if (a[i] < b[i]) wins += 1;
  return wins / a.length;
}
