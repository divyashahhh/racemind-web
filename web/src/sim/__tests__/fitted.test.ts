import { describe, expect, it } from 'vitest';
import { CIRCUITS, MODEL_META } from '../../models/catalog';
import { enumerateStrategies, isLegal } from '../optimize';
import { simulate, winProbability } from '../simulate';
import { DEFAULT_SETTINGS } from '../types';
import { DRY_COMPOUNDS } from '../types';

/**
 * Sanity checks against the *real* fitted coefficients, not a fixture.
 *
 * A model can pass every unit test on synthetic inputs and still ship nonsense once
 * the actual numbers are loaded. These assert the properties an F1 fan would notice
 * immediately if they broke.
 */
describe('fitted model', () => {
  it('loaded circuits with plausible metadata', () => {
    expect(CIRCUITS.length).toBeGreaterThan(15);
    expect(MODEL_META.usableLaps).toBeGreaterThan(10_000);
    for (const c of CIRCUITS) {
      expect(c.raceLaps).toBeGreaterThan(40);
      expect(c.raceLaps).toBeLessThan(90);
      expect(c.baseLapTime).toBeGreaterThan(60);
      expect(c.baseLapTime).toBeLessThan(140);
      // Pit loss anywhere outside this range means the lane/stop split is broken.
      expect(c.pitLaneLoss).toBeGreaterThan(12);
      expect(c.pitLaneLoss).toBeLessThan(35);
    }
  });

  it('orders the compound ladder correctly at every circuit', () => {
    for (const c of CIRCUITS) {
      const soft = c.curves.SOFT;
      const medium = c.curves.MEDIUM;
      const hard = c.curves.HARD;
      if (!soft || !medium || !hard) continue;

      // Softer compounds degrade faster...
      expect(soft.beta).toBeGreaterThanOrEqual(medium.beta - 1e-9);
      expect(medium.beta).toBeGreaterThanOrEqual(hard.beta - 1e-9);
      // ...and are faster on a fresh tyre.
      expect(soft.alpha).toBeLessThanOrEqual(medium.alpha + 1e-9);
      expect(medium.alpha).toBeLessThanOrEqual(hard.alpha + 1e-9);
      // Degradation is never negative: tyres do not improve with age.
      for (const compound of DRY_COMPOUNDS) {
        const curve = c.curves[compound];
        if (!curve) continue;
        expect(curve.beta).toBeGreaterThanOrEqual(0);
        expect(curve.gamma).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('produces legal, distinct, plausibly-timed strategies everywhere', () => {
    for (const circuit of CIRCUITS) {
      const strategies = enumerateStrategies(circuit);
      expect(strategies.length, circuit.name).toBeGreaterThan(1);
      for (const s of strategies) {
        expect(isLegal(s), `${circuit.name} ${s.label}`).toBe(true);
        expect(s.stints.length).toBeLessThanOrEqual(4);
      }
      // The shortlist must contain genuinely different ideas, not six near-copies.
      expect(new Set(strategies.map((s) => s.label)).size).toBeGreaterThan(1);
    }
  });

  it('simulates every circuit to a realistic race duration', () => {
    const settings = { ...DEFAULT_SETTINGS, iterations: 120 };
    for (const circuit of CIRCUITS) {
      const strategies = enumerateStrategies(circuit).slice(0, 3);
      const outcomes = simulate(circuit, strategies, settings);
      for (const o of outcomes) {
        const minutes = o.p50 / 60;
        // Every real grand prix falls comfortably inside this window.
        expect(minutes, `${circuit.name} ${o.strategyId}`).toBeGreaterThan(60);
        expect(minutes, `${circuit.name} ${o.strategyId}`).toBeLessThan(135);
        expect(o.p10).toBeLessThanOrEqual(o.p50);
        expect(o.p50).toBeLessThanOrEqual(o.p90);
      }
    }
  });

  it('offers a real choice between stop counts, not six versions of one plan', () => {
    // The question a strategist actually asks is "one stop or two?". A shortlist that
    // is all one-stops cannot answer it. An earlier selection rule ranked purely by
    // time and did exactly that at almost every circuit.
    for (const circuit of CIRCUITS) {
      const strategies = enumerateStrategies(circuit);
      const stopCounts = new Set(strategies.map((s) => s.stints.length - 1));
      expect(stopCounts.size, `${circuit.name}: ${strategies.map((s) => s.label).join(', ')}`)
        .toBeGreaterThanOrEqual(2);

      // Mirrored orders (S-M vs M-S) are the same idea and must not both appear.
      const families = strategies.map(
        (s) => `${s.stints.length}:${[...s.stints.map((x) => x.compound)].sort().join('')}`,
      );
      expect(new Set(families).size).toBe(families.length);
    }
  });

  it('separates the best plan from the worst', () => {
    const settings = { ...DEFAULT_SETTINGS, iterations: 400 };
    const decisive: string[] = [];

    for (const circuit of CIRCUITS) {
      const strategies = enumerateStrategies(circuit);
      const outcomes = simulate(circuit, strategies, settings);
      const sorted = [...outcomes].sort((a, b) => a.p50 - b.p50);
      const bestVsWorst = winProbability(sorted[0].rawTotals, sorted[sorted.length - 1].rawTotals);

      // The plan with the better median must at least win more often than not. If the
      // model could not manage that, it would be telling the user nothing.
      expect(bestVsWorst, circuit.name).toBeGreaterThan(0.55);
      // And the gap has to be worth caring about.
      expect(sorted[sorted.length - 1].p50 - sorted[0].p50, circuit.name).toBeGreaterThan(3);

      if (bestVsWorst > 0.8) decisive.push(circuit.key);
    }

    // Most circuits should be decisive, but not all of them — and the exceptions are
    // the interesting part. Interlagos carries a high safety-car rate, and a single
    // deployment is worth more than the ~20s that separates its best plan from its
    // worst. A model that reported high confidence there would be lying.
    expect(decisive.length).toBeGreaterThan(CIRCUITS.length * 0.6);
  });

  it('widens the outcome spread when rain is possible', () => {
    const circuit = CIRCUITS[0];
    const strategies = enumerateStrategies(circuit).slice(0, 1);
    const dry = simulate(circuit, strategies, { ...DEFAULT_SETTINGS, iterations: 300, rainProbability: 0 })[0];
    const wet = simulate(circuit, strategies, { ...DEFAULT_SETTINGS, iterations: 300, rainProbability: 0.6 })[0];
    expect(wet.p90 - wet.p10).toBeGreaterThan(dry.p90 - dry.p10);
  });
});
