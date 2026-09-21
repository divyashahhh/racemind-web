/** Dry compounds, plus the two wet compounds the FIA rule explicitly excludes. */
export type Compound = 'SOFT' | 'MEDIUM' | 'HARD' | 'INTERMEDIATE' | 'WET';

export const DRY_COMPOUNDS: readonly Compound[] = ['SOFT', 'MEDIUM', 'HARD'] as const;

/**
 * Fitted degradation curve for one (circuit, compound) pair.
 *
 *   lapDelta(age) = alpha + beta * age + gamma * age^2
 *
 * relative to the circuit's reference pace. The quadratic term is what produces the
 * performance cliff; a purely linear model cannot represent it and will always
 * recommend stints that are too long.
 *
 * The `*Sd` fields are posterior standard deviations. The Monte Carlo layer samples
 * from them so that *parameter* uncertainty shows up in the output distribution,
 * not just lap-to-lap noise.
 */
export interface DegradationCurve {
  compound: Compound;
  alpha: number;
  beta: number;
  gamma: number;
  alphaSd: number;
  betaSd: number;
  gammaSd: number;
  /** Laps of observed data behind the fit. Low values mean a heavily pooled prior. */
  sampleLaps: number;
  /** Longest stint actually observed on this compound here. */
  observedMaxStint: number;
}

/** Everything the simulator needs to know about one circuit. */
export interface CircuitModel {
  key: string;
  name: string;
  /** Scheduled race distance in laps. */
  raceLaps: number;
  /** Reference green-flag lap time in seconds, on a nominal tyre with race fuel burned off. */
  baseLapTime: number;
  /** Time lost driving through the pit lane, excluding the stationary stop. */
  pitLaneLoss: number;
  /** Mean / sd of the log of the stationary stop duration. */
  pitStopMu: number;
  pitStopSigma: number;
  /**
   * Seconds per lap added per lap of fuel still on board. The car is heaviest on
   * lap 1 and lightest at the flag, so this term *decreases* through the race.
   */
  fuelEffect: number;
  /** Lap-to-lap noise: AR(1) autocorrelation and innovation sd, in seconds. */
  noiseRho: number;
  noiseSd: number;
  /** Per-lap probability of a safety car being deployed, by race phase. */
  safetyCar: SafetyCarModel;
  curves: Partial<Record<Compound, DegradationCurve>>;
  /** How many races the fit is based on. Surfaced in the UI as a confidence cue. */
  racesObserved: number;
}

export interface SafetyCarModel {
  /** Probability of at least one SC on lap 1 (start incidents are their own regime). */
  lapOneRate: number;
  /** Baseline per-lap hazard over the rest of the race. */
  perLapRate: number;
  /** Mean number of laps a safety car period lasts. */
  meanDuration: number;
  /**
   * Fraction of the normal pit loss you actually pay when stopping under a safety
   * car. The field is bunched and slow, so the stop is far cheaper — this single
   * number drives most "should I react to the SC" decisions.
   */
  pitLossDiscount: number;
  /** Multiplier on the base lap time while the safety car is out. */
  lapTimeMultiplier: number;
}

/** One planned stint: a compound and the lap the driver pits at the end of it. */
export interface Stint {
  compound: Compound;
  /** Inclusive lap the stint begins on. */
  startLap: number;
  /** Inclusive lap the stint ends on; the pit stop happens at the end of this lap. */
  endLap: number;
  /** Tyre age in laps at the moment the stint starts (non-zero for scrubbed sets). */
  startAge: number;
}

export interface Strategy {
  id: string;
  label: string;
  stints: Stint[];
}

/** Distribution summary for one strategy across all Monte Carlo iterations. */
export interface StrategyOutcome {
  strategyId: string;
  mean: number;
  p10: number;
  p50: number;
  p90: number;
  /** Sorted sample, for quantiles and the distribution plot. */
  samples: number[];
  /**
   * Per-iteration totals in iteration order. Because every strategy saw the same
   * sampled scenario at index i, these stay paired and must not be sorted — pairwise
   * win probability is computed from them directly.
   */
  rawTotals: number[];
  /** Per-lap median cumulative time, for the race trace chart. */
  medianTrace: number[];
  /** Per-lap 10th/90th percentile cumulative time, for the uncertainty fan. */
  p10Trace: number[];
  p90Trace: number[];
}

export interface SimulationSettings {
  iterations: number;
  seed: number;
  /** Include safety car sampling. Turning it off isolates pure tyre strategy. */
  enableSafetyCar: boolean;
  /** Include posterior sampling of the degradation coefficients. */
  enableParameterUncertainty: boolean;
  /** Rain probability 0-1. Above the threshold the sim samples a wet phase. */
  rainProbability: number;
}

export const DEFAULT_SETTINGS: SimulationSettings = {
  iterations: 1500,
  seed: 20260921,
  enableSafetyCar: true,
  enableParameterUncertainty: true,
  rainProbability: 0,
};
