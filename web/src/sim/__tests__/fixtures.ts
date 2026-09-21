import type { CircuitModel, Compound, DegradationCurve } from '../types';

function curve(compound: Compound, alpha: number, beta: number, gamma: number): DegradationCurve {
  return {
    compound,
    alpha,
    beta,
    gamma,
    alphaSd: 0.05,
    betaSd: 0.005,
    gammaSd: 0.0005,
    sampleLaps: 500,
    observedMaxStint: 40,
  };
}

/** A deliberately plain circuit so assertions read against known numbers. */
export const TEST_CIRCUIT: CircuitModel = {
  key: 'test',
  name: 'Test Circuit',
  raceLaps: 50,
  baseLapTime: 90,
  pitLaneLoss: 18,
  pitStopMu: Math.log(2.4),
  pitStopSigma: 0.18,
  fuelEffect: 0.03,
  noiseRho: 0.6,
  noiseSd: 0.25,
  safetyCar: {
    lapOneRate: 0.1,
    perLapRate: 0.012,
    meanDuration: 4,
    pitLossDiscount: 0.45,
    lapTimeMultiplier: 1.4,
  },
  curves: {
    SOFT: curve('SOFT', -0.5, 0.075, 0.0035),
    MEDIUM: curve('MEDIUM', 0, 0.045, 0.0018),
    HARD: curve('HARD', 0.45, 0.028, 0.0009),
  },
  racesObserved: 3,
  gammaCalibration: null,
};
