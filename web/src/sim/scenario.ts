import { lognormal, makeRng, normal, truncatedNormal } from './rng';
import type { CircuitModel, Compound, SimulationSettings } from './types';
import { DRY_COMPOUNDS } from './types';

/** Coefficients actually used for one iteration, after posterior sampling. */
export interface SampledCurve {
  alpha: number;
  beta: number;
  gamma: number;
}

/**
 * One sampled race world. Every candidate strategy is scored against the *same*
 * scenario (common random numbers), so a comparison between two strategies reflects
 * the strategies rather than the luck of two different dice rolls. This cuts the
 * variance of the difference by roughly an order of magnitude versus sampling
 * independently, which is what makes head-to-head win probabilities usable at
 * only ~1500 iterations.
 */
export interface Scenario {
  /** safetyCar[lap] is true when the safety car is out on that lap (1-indexed). */
  safetyCar: boolean[];
  /** AR(1) lap-time noise in seconds, 1-indexed. */
  noise: number[];
  /** wet[lap] is true when the track is too wet for dry tyres. */
  wet: boolean[];
  coeffs: Record<Compound, SampledCurve>;
  /** Pre-drawn stationary stop durations; strategies index into this pool in order. */
  pitDurations: number[];
}

const MAX_STOPS = 4;

export function sampleScenario(
  circuit: CircuitModel,
  settings: SimulationSettings,
  iteration: number,
): Scenario {
  const rng = makeRng(settings.seed + iteration * 2654435761);
  const n = circuit.raceLaps;

  // --- Degradation coefficients -------------------------------------------------
  // Drawn once per iteration and shared across strategies: within a single race the
  // tyres behave one way, and every strategy lives with that same truth.
  const coeffs = {} as Record<Compound, SampledCurve>;
  for (const compound of ['SOFT', 'MEDIUM', 'HARD', 'INTERMEDIATE', 'WET'] as Compound[]) {
    const curve = circuit.curves[compound];
    if (!curve) {
      coeffs[compound] = { alpha: 0, beta: 0.05, gamma: 0.002 };
      continue;
    }
    if (!settings.enableParameterUncertainty) {
      coeffs[compound] = { alpha: curve.alpha, beta: curve.beta, gamma: curve.gamma };
      continue;
    }
    coeffs[compound] = {
      alpha: curve.alpha + curve.alphaSd * normal(rng),
      // Degradation cannot be negative: tyres do not get faster with age.
      beta: Math.max(0, curve.beta + curve.betaSd * normal(rng)),
      gamma: Math.max(0, curve.gamma + curve.gammaSd * normal(rng)),
    };
  }

  // --- Lap-to-lap noise ---------------------------------------------------------
  // AR(1) rather than IID. Consecutive laps are strongly correlated (traffic, wind,
  // driver rhythm); treating them as independent makes the outcome distribution far
  // too tight and produces overconfident win probabilities.
  const noise = new Array<number>(n + 1).fill(0);
  const innovationSd = circuit.noiseSd * Math.sqrt(1 - circuit.noiseRho * circuit.noiseRho);
  let prev = circuit.noiseSd * normal(rng);
  for (let lap = 1; lap <= n; lap++) {
    prev = circuit.noiseRho * prev + innovationSd * normal(rng);
    noise[lap] = prev;
  }

  // --- Safety cars --------------------------------------------------------------
  const safetyCar = new Array<boolean>(n + 1).fill(false);
  if (settings.enableSafetyCar) {
    const sc = circuit.safetyCar;
    let lap = 1;
    while (lap <= n) {
      const hazard = lap === 1 ? sc.lapOneRate : sc.perLapRate;
      if (rng() < hazard) {
        // Duration is geometric-ish around the observed mean.
        const duration = Math.max(1, Math.round(truncatedNormal(rng, sc.meanDuration, 1.4, 1, 8)));
        for (let k = 0; k < duration && lap + k <= n; k++) safetyCar[lap + k] = true;
        // A restart is rarely followed immediately by another deployment.
        lap += duration + 3;
      } else {
        lap += 1;
      }
    }
  }

  // --- Rain ---------------------------------------------------------------------
  const wet = new Array<boolean>(n + 1).fill(false);
  if (settings.rainProbability > 0 && rng() < settings.rainProbability) {
    const onset = 1 + Math.floor(rng() * (n - 5));
    const duration = Math.max(4, Math.round(truncatedNormal(rng, n * 0.35, n * 0.15, 4, n)));
    for (let k = 0; k < duration && onset + k <= n; k++) wet[onset + k] = true;
  }

  // --- Pit stop durations -------------------------------------------------------
  // Lognormal: the median stop is ~2.4s but the tail matters far more than the centre.
  const pitDurations: number[] = [];
  for (let i = 0; i < MAX_STOPS; i++) {
    pitDurations.push(lognormal(rng, circuit.pitStopMu, circuit.pitStopSigma));
  }

  return { safetyCar, noise, wet, coeffs, pitDurations };
}

/** Pace delta in seconds for a tyre of the given age, relative to circuit reference pace. */
export function degradationDelta(curve: SampledCurve, age: number): number {
  return curve.alpha + curve.beta * age + curve.gamma * age * age;
}

/** The dry compounds a circuit has a fitted curve for. */
export function availableDryCompounds(circuit: CircuitModel): Compound[] {
  return DRY_COMPOUNDS.filter((c) => circuit.curves[c] !== undefined);
}
