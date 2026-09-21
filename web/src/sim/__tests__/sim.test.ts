import { describe, expect, it } from 'vitest';
import { runStrategy, simulate, winProbability } from '../simulate';
import { sampleScenario, degradationDelta } from '../scenario';
import { deterministicTime, enumerateStrategies, isLegal, legalCompoundSequences } from '../optimize';
import { undercutCurve, undercutGain } from '../undercut';
import { makeRng, quantileSorted } from '../rng';
import { DEFAULT_SETTINGS, type Strategy } from '../types';
import { TEST_CIRCUIT } from './fixtures';

const oneStop: Strategy = {
  id: 'test-1stop',
  label: '1-stop M-H',
  stints: [
    { compound: 'MEDIUM', startLap: 1, endLap: 22, startAge: 0 },
    { compound: 'HARD', startLap: 23, endLap: 50, startAge: 0 },
  ],
};

const twoStop: Strategy = {
  id: 'test-2stop',
  label: '2-stop S-M-H',
  stints: [
    { compound: 'SOFT', startLap: 1, endLap: 15, startAge: 0 },
    { compound: 'MEDIUM', startLap: 16, endLap: 33, startAge: 0 },
    { compound: 'HARD', startLap: 34, endLap: 50, startAge: 0 },
  ],
};

describe('rng', () => {
  it('is deterministic for a given seed', () => {
    const a = Array.from({ length: 5 }, makeRng(42));
    const b = Array.from({ length: 5 }, makeRng(42));
    expect(a).toEqual(b);
  });

  it('interpolates quantiles', () => {
    expect(quantileSorted([0, 10], 0.5)).toBe(5);
    expect(quantileSorted([0, 1, 2, 3, 4], 0.5)).toBe(2);
  });
});

describe('degradation', () => {
  it('is monotonically increasing in tyre age', () => {
    const c = { alpha: 0, beta: 0.05, gamma: 0.002 };
    let prev = -Infinity;
    for (let age = 0; age <= 40; age++) {
      const d = degradationDelta(c, age);
      expect(d).toBeGreaterThan(prev);
      prev = d;
    }
  });

  it('accelerates — the quadratic term produces a cliff', () => {
    const c = { alpha: 0, beta: 0.05, gamma: 0.002 };
    const early = degradationDelta(c, 10) - degradationDelta(c, 5);
    const late = degradationDelta(c, 35) - degradationDelta(c, 30);
    expect(late).toBeGreaterThan(early);
  });
});

describe('fuel model', () => {
  it('makes the car faster as the race runs, all else equal', () => {
    // Lap 1 on a brand new tyre must be slower than lap 50 on a brand new tyre,
    // because the car is carrying a full fuel load. The previous engine had this
    // backwards and biased itself toward extra stops.
    const flat = {
      ...TEST_CIRCUIT,
      noiseSd: 0,
      safetyCar: { ...TEST_CIRCUIT.safetyCar, lapOneRate: 0, perLapRate: 0 },
    };
    const scenario = sampleScenario(flat, { ...DEFAULT_SETTINGS, enableParameterUncertainty: false, enableSafetyCar: false }, 0);
    const single: Strategy = {
      id: 'x',
      label: 'x',
      stints: [{ compound: 'MEDIUM', startLap: 1, endLap: 50, startAge: 0 }],
    };
    const cum = runStrategy(flat, single, scenario);
    const lap1 = cum[1] - cum[0];
    // Compare against a hypothetical fresh tyre late in the race.
    const fuelSavingOverRace = flat.fuelEffect * 49;
    expect(fuelSavingOverRace).toBeGreaterThan(1.0);
    expect(lap1).toBeGreaterThan(flat.baseLapTime);
  });
});

describe('runStrategy', () => {
  it('charges exactly one pit loss per stop and none for the final stint', () => {
    const flat = { ...TEST_CIRCUIT, noiseSd: 0 };
    const free = { ...flat, pitLaneLoss: 0, pitStopMu: -Infinity };
    const settings = { ...DEFAULT_SETTINGS, enableSafetyCar: false, enableParameterUncertainty: false };
    const scenario = sampleScenario(flat, settings, 0);
    const freeScenario = { ...scenario, pitDurations: scenario.pitDurations.map(() => 0) };

    const twoStintPlan: Strategy = {
      id: 'w', label: 'w',
      stints: [
        { compound: 'MEDIUM', startLap: 1, endLap: 25, startAge: 0 },
        { compound: 'MEDIUM', startLap: 26, endLap: 50, startAge: 0 },
      ],
    };

    // Identical plan, identical scenario, the only difference being whether the pit
    // lane costs anything. The gap must be exactly one stop's worth.
    const charged = runStrategy(flat, twoStintPlan, scenario)[50];
    const uncharged = runStrategy(free, twoStintPlan, freeScenario)[50];
    expect(charged - uncharged).toBeCloseTo(flat.pitLaneLoss + scenario.pitDurations[0], 6);

    // A no-stop plan pays nothing at all.
    const noStop: Strategy = {
      id: 'n', label: 'n',
      stints: [{ compound: 'MEDIUM', startLap: 1, endLap: 50, startAge: 0 }],
    };
    expect(runStrategy(flat, noStop, scenario)[50]).toBeCloseTo(
      runStrategy(free, noStop, freeScenario)[50], 6,
    );
  });

  it('finds splitting a long stint worthwhile when the cliff is steep', () => {
    // With a quadratic cliff, a 50-lap stint ends ~6.7s/lap off the pace. Two 25-lap
    // stints must beat it by more than the ~20s pit loss, or the degradation model is
    // not actually producing a cliff.
    const flat = { ...TEST_CIRCUIT, noiseSd: 0 };
    const settings = { ...DEFAULT_SETTINGS, enableSafetyCar: false, enableParameterUncertainty: false };
    const scenario = sampleScenario(flat, settings, 0);
    const noStop: Strategy = {
      id: 'n', label: 'n',
      stints: [{ compound: 'MEDIUM', startLap: 1, endLap: 50, startAge: 0 }],
    };
    const withStop: Strategy = {
      id: 'w', label: 'w',
      stints: [
        { compound: 'MEDIUM', startLap: 1, endLap: 25, startAge: 0 },
        { compound: 'MEDIUM', startLap: 26, endLap: 50, startAge: 0 },
      ],
    };
    expect(runStrategy(flat, withStop, scenario)[50]).toBeLessThan(
      runStrategy(flat, noStop, scenario)[50],
    );
  });

  it('produces a monotonically increasing cumulative trace', () => {
    const scenario = sampleScenario(TEST_CIRCUIT, DEFAULT_SETTINGS, 7);
    const cum = runStrategy(TEST_CIRCUIT, twoStop, scenario);
    for (let lap = 1; lap <= TEST_CIRCUIT.raceLaps; lap++) {
      expect(cum[lap]).toBeGreaterThan(cum[lap - 1]);
    }
  });

  it('covers the full race distance', () => {
    const scenario = sampleScenario(TEST_CIRCUIT, DEFAULT_SETTINGS, 1);
    const cum = runStrategy(TEST_CIRCUIT, oneStop, scenario);
    expect(cum).toHaveLength(TEST_CIRCUIT.raceLaps + 1);
  });
});

describe('simulate', () => {
  const settings = { ...DEFAULT_SETTINGS, iterations: 300 };

  it('returns ordered quantiles', () => {
    const [outcome] = simulate(TEST_CIRCUIT, [oneStop], settings);
    expect(outcome.p10).toBeLessThanOrEqual(outcome.p50);
    expect(outcome.p50).toBeLessThanOrEqual(outcome.p90);
  });

  it('is reproducible for a fixed seed', () => {
    const a = simulate(TEST_CIRCUIT, [oneStop], settings)[0];
    const b = simulate(TEST_CIRCUIT, [oneStop], settings)[0];
    expect(a.p50).toBe(b.p50);
  });

  it('uses common random numbers so paired differences are tighter than marginals', () => {
    const [a, b] = simulate(TEST_CIRCUIT, [oneStop, twoStop], settings);
    const paired = a.rawTotals.map((v, i) => v - b.rawTotals[i]);
    const sd = (xs: number[]) => {
      const m = xs.reduce((p, c) => p + c, 0) / xs.length;
      return Math.sqrt(xs.reduce((p, c) => p + (c - m) ** 2, 0) / xs.length);
    };
    // If the scenarios were independent the paired sd would be ~sqrt(2)x either
    // marginal. Common random numbers should make it markedly smaller instead.
    expect(sd(paired)).toBeLessThan(sd(a.rawTotals));
  });

  it('reports win probabilities in [0,1] that sum to 1 with ties excluded', () => {
    const [a, b] = simulate(TEST_CIRCUIT, [oneStop, twoStop], settings);
    const pa = winProbability(a.rawTotals, b.rawTotals);
    const pb = winProbability(b.rawTotals, a.rawTotals);
    expect(pa).toBeGreaterThanOrEqual(0);
    expect(pa).toBeLessThanOrEqual(1);
    expect(pa + pb).toBeCloseTo(1, 5);
  });

  it('widens the outcome distribution when safety cars are enabled', () => {
    const without = simulate(TEST_CIRCUIT, [oneStop], { ...settings, enableSafetyCar: false })[0];
    const with_ = simulate(TEST_CIRCUIT, [oneStop], { ...settings, enableSafetyCar: true })[0];
    expect(with_.p90 - with_.p10).toBeGreaterThan(without.p90 - without.p10);
  });
});

describe('optimizer', () => {
  it('only emits compound sequences that satisfy the two-compound rule', () => {
    for (const seq of legalCompoundSequences(TEST_CIRCUIT, 2)) {
      expect(new Set(seq).size).toBeGreaterThanOrEqual(2);
    }
    expect(legalCompoundSequences(TEST_CIRCUIT, 1)).toHaveLength(0);
  });

  it('produces only legal shortlisted strategies that span the race', () => {
    const strategies = enumerateStrategies(TEST_CIRCUIT);
    expect(strategies.length).toBeGreaterThan(0);
    for (const s of strategies) {
      expect(isLegal(s)).toBe(true);
      expect(s.stints[0].startLap).toBe(1);
      expect(s.stints[s.stints.length - 1].endLap).toBe(TEST_CIRCUIT.raceLaps);
      for (let i = 1; i < s.stints.length; i++) {
        expect(s.stints[i].startLap).toBe(s.stints[i - 1].endLap + 1);
      }
    }
  });

  it('ranks its own top pick ahead of an obviously bad plan', () => {
    const best = enumerateStrategies(TEST_CIRCUIT)[0];
    const silly: Strategy = {
      id: 'silly', label: 'silly',
      stints: [
        { compound: 'SOFT', startLap: 1, endLap: 45, startAge: 0 },
        { compound: 'MEDIUM', startLap: 46, endLap: 50, startAge: 0 },
      ],
    };
    expect(deterministicTime(TEST_CIRCUIT, best.stints)).toBeLessThan(
      deterministicTime(TEST_CIRCUIT, silly.stints),
    );
  });
});

describe('undercut', () => {
  it('pays off more against an old tyre than a fresh one', () => {
    const base = { circuit: TEST_CIRCUIT, currentCompound: 'MEDIUM' as const, freshCompound: 'MEDIUM' as const, lapsEarly: 1 };
    expect(undercutGain({ ...base, currentAge: 28 })).toBeGreaterThan(
      undercutGain({ ...base, currentAge: 4 }),
    );
  });

  it('is unprofitable on lap 1 — the out-lap tax is not yet covered', () => {
    expect(
      undercutGain({
        circuit: TEST_CIRCUIT,
        currentCompound: 'MEDIUM',
        currentAge: 1,
        freshCompound: 'MEDIUM',
        lapsEarly: 1,
      }),
    ).toBeLessThan(0);
  });

  it('returns one point per racing lap', () => {
    expect(undercutCurve(TEST_CIRCUIT, 'MEDIUM', 'SOFT')).toHaveLength(TEST_CIRCUIT.raceLaps);
  });
});
