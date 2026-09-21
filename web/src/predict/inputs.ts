import type { CircuitModel, SimulationSettings } from '@/sim/types';
import { DEFAULT_SETTINGS } from '@/sim/types';
import type { Team } from '@/models/context';

export interface RaceInputs {
  teamName: string;
  driverNumber: number;
  round: number;
  gridPosition: number;
  rainChance: number;
  /** Track temperature in °C. Hotter tracks chew tyres faster. */
  trackTemp: number;
}

export const DEFAULT_INPUTS: Omit<RaceInputs, 'teamName' | 'driverNumber' | 'round'> = {
  gridPosition: 5,
  rainChance: 0.1,
  trackTemp: 35,
};

/** Reference track temperature the model was fitted around. */
const BASELINE_TEMP = 35;
/** Extra degradation per °C above baseline, per lap of tyre age. */
const TEMP_DEG_SENSITIVITY = 0.0009;

/**
 * Fold the user's inputs into the circuit model.
 *
 * Three real effects, each small on its own and jointly enough to change the call:
 *
 *  - **Team pace.** A slower car pays the same fixed pit loss over a slower lap, so
 *    stopping costs it proportionally less. Backmarkers really do stop more often.
 *  - **Track temperature.** Degradation scales with surface temperature; this is the
 *    single biggest lever a fan can actually observe before a race.
 *  - **Grid slot.** Handled as opening-stint traffic in the simulation settings.
 */
export function applyInputs(
  circuit: CircuitModel,
  team: Team | undefined,
  inputs: RaceInputs,
): { circuit: CircuitModel; settings: SimulationSettings } {
  const paceOffset = team?.paceOffset ?? 0;
  const tempDelta = inputs.trackTemp - BASELINE_TEMP;

  const curves = { ...circuit.curves };
  for (const key of Object.keys(curves) as (keyof typeof curves)[]) {
    const curve = curves[key];
    if (!curve) continue;
    curves[key] = {
      ...curve,
      beta: Math.max(0, curve.beta + tempDelta * TEMP_DEG_SENSITIVITY),
    };
  }

  const adjusted: CircuitModel = {
    ...circuit,
    baseLapTime: circuit.baseLapTime + paceOffset,
    curves,
  };

  // Grid slot -> dirty air. P1 is clear; the effect saturates around the midfield.
  const behind = Math.max(0, inputs.gridPosition - 1);
  const settings: SimulationSettings = {
    ...DEFAULT_SETTINGS,
    rainProbability: inputs.rainChance,
    traffic: {
      perLap: Math.min(0.9, behind * 0.055),
      decayLaps: Math.min(circuit.raceLaps - 1, 8 + behind),
    },
  };

  return { circuit: adjusted, settings };
}
