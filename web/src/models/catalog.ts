import type { CircuitModel, Compound, DegradationCurve } from '../sim/types';
import raw from './circuits.json';

/** Shape of the artefact written by ml/fit.py. */
interface FittedPayload {
  version: number;
  fittedAt: string;
  usableLaps: number;
  races: number;
  seasons: number[];
  global: { fuelEffect: number; pitStopMu: number; pitStopSigma: number };
  circuits: Record<string, RawCircuit>;
}

interface RawCircuit {
  key: string;
  name: string;
  raceLaps: number;
  baseLapTime: number;
  fuelEffect: number;
  pitLaneLoss: number;
  pitStopMu: number;
  pitStopSigma: number;
  noiseSd: number;
  noiseRho: number;
  racesObserved: number;
  safetyCar: CircuitModel['safetyCar'];
  curves: Record<string, Omit<DegradationCurve, 'compound'> & { compound: string }>;
}

const payload = raw as unknown as FittedPayload;

function toCircuit(entry: RawCircuit): CircuitModel {
  const curves: Partial<Record<Compound, DegradationCurve>> = {};
  for (const [name, curve] of Object.entries(entry.curves)) {
    curves[name as Compound] = { ...curve, compound: name as Compound };
  }
  return {
    key: entry.key,
    name: entry.name,
    raceLaps: entry.raceLaps,
    baseLapTime: entry.baseLapTime,
    pitLaneLoss: entry.pitLaneLoss,
    pitStopMu: entry.pitStopMu,
    pitStopSigma: entry.pitStopSigma,
    fuelEffect: entry.fuelEffect,
    noiseRho: entry.noiseRho,
    noiseSd: entry.noiseSd,
    safetyCar: entry.safetyCar,
    curves,
    racesObserved: entry.racesObserved,
  };
}

export const MODEL_META = {
  version: payload.version,
  fittedAt: payload.fittedAt,
  usableLaps: payload.usableLaps,
  races: payload.races,
  seasons: payload.seasons,
  global: payload.global,
};

export const CIRCUITS: CircuitModel[] = Object.values(payload.circuits)
  .map(toCircuit)
  .sort((a, b) => a.name.localeCompare(b.name));

export const CIRCUIT_BY_KEY = new Map(CIRCUITS.map((c) => [c.key, c]));

export function findCircuit(name: string | null | undefined): CircuitModel | null {
  if (!name) return null;
  const exact = CIRCUIT_BY_KEY.get(name);
  if (exact) return exact;
  const lowered = name.toLowerCase();
  return (
    CIRCUITS.find((c) => c.key.toLowerCase() === lowered) ??
    CIRCUITS.find((c) => c.name.toLowerCase().includes(lowered)) ??
    null
  );
}

/**
 * How much of a circuit's model is its own data versus the pooled prior.
 * Surfaced in the UI so a thinly-observed circuit is not presented with the same
 * confidence as one with four races behind it.
 */
export function modelConfidence(circuit: CircuitModel): {
  level: 'high' | 'medium' | 'low';
  laps: number;
  note: string;
} {
  const laps = Object.values(circuit.curves).reduce((a, c) => a + (c?.sampleLaps ?? 0), 0);
  if (circuit.racesObserved >= 3 && laps >= 1500) {
    return { level: 'high', laps, note: `${circuit.racesObserved} races, ${laps.toLocaleString()} clean laps` };
  }
  if (circuit.racesObserved >= 2 && laps >= 600) {
    return { level: 'medium', laps, note: `${circuit.racesObserved} races, ${laps.toLocaleString()} clean laps — partially pooled` };
  }
  return {
    level: 'low',
    laps,
    note: `Only ${circuit.racesObserved} race(s), ${laps.toLocaleString()} clean laps — largely the pooled prior`,
  };
}
