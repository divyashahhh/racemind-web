import type { CircuitModel, Strategy, StrategyOutcome } from '@/sim/types';
import { tyreOf } from '@/ui/tyres';

export interface PlanCall {
  strategy: Strategy;
  outcome: StrategyOutcome;
  /** Share of simulated races in which this plan finished ahead of every alternative. */
  confidence: number;
  /** Lap range across which each stop stays within a second of optimal. */
  windows: { stop: number; earliest: number; latest: number; centre: number }[];
  /** "2-stop", "1-stop" — the answer a fan is actually asking for. */
  stopLabel: string;
  /** "M → H → M" */
  compoundLabel: string;
}

export interface RaceCall {
  primary: PlanCall;
  alternatives: PlanCall[];
  /** True when no plan clears 45%, i.e. the race is genuinely a coin toss. */
  contested: boolean;
  /** Probability mass by stop count, which is the headline question. */
  byStopCount: { stops: number; probability: number }[];
}

/**
 * Probability that each plan is the *fastest of those considered*.
 *
 * This is computed by asking, in every simulated race, which plan actually won — not
 * by comparing medians. Two plans whose medians differ by half a second can still be a
 * near coin toss once safety cars are in play, and a fan deserves to be told that
 * rather than handed a false favourite.
 */
export function winShares(outcomes: StrategyOutcome[]): number[] {
  const n = outcomes[0]?.rawTotals.length ?? 0;
  const wins = new Array<number>(outcomes.length).fill(0);
  for (let i = 0; i < n; i++) {
    let bestIndex = 0;
    let bestTime = Infinity;
    for (let s = 0; s < outcomes.length; s++) {
      const t = outcomes[s].rawTotals[i];
      if (t < bestTime) {
        bestTime = t;
        bestIndex = s;
      }
    }
    wins[bestIndex] += 1;
  }
  return wins.map((w) => (n ? w / n : 0));
}

function compoundLabel(strategy: Strategy): string {
  return strategy.stints.map((s) => tyreOf(s.compound).letter).join(' → ');
}

function stopLabel(strategy: Strategy): string {
  const stops = strategy.stints.length - 1;
  return stops === 0 ? 'No stop' : `${stops}-stop`;
}

/**
 * The lap range over which a stop can move before costing more than `toleranceSeconds`.
 *
 * A single "pit on lap 22" is false precision — real pit walls work to a window, and
 * how *wide* that window is tells the fan whether the call is relaxed or knife-edge.
 */
export function pitWindows(
  circuit: CircuitModel,
  strategy: Strategy,
  cost: (pitLaps: number[]) => number,
  toleranceSeconds = 1.0,
): PlanCall['windows'] {
  const base = strategy.stints.slice(0, -1).map((s) => s.endLap);
  if (base.length === 0) return [];
  const reference = cost(base);

  return base.map((centre, index) => {
    const probe = (lap: number) => {
      const candidate = [...base];
      candidate[index] = lap;
      for (let i = 1; i < candidate.length; i++) {
        if (candidate[i] <= candidate[i - 1]) return Infinity;
      }
      return cost(candidate);
    };

    let earliest = centre;
    for (let lap = centre - 1; lap >= 2; lap--) {
      if (probe(lap) - reference > toleranceSeconds) break;
      earliest = lap;
    }
    let latest = centre;
    for (let lap = centre + 1; lap <= circuit.raceLaps - 2; lap++) {
      if (probe(lap) - reference > toleranceSeconds) break;
      latest = lap;
    }
    return { stop: index + 1, earliest, latest, centre };
  });
}

export function buildCall(
  circuit: CircuitModel,
  strategies: Strategy[],
  outcomes: StrategyOutcome[],
  cost: (strategy: Strategy, pitLaps: number[]) => number,
): RaceCall | null {
  if (strategies.length === 0 || outcomes.length !== strategies.length) return null;

  const shares = winShares(outcomes);
  const plans: PlanCall[] = strategies.map((strategy, i) => ({
    strategy,
    outcome: outcomes[i],
    confidence: shares[i],
    windows: pitWindows(circuit, strategy, (laps) => cost(strategy, laps)),
    stopLabel: stopLabel(strategy),
    compoundLabel: compoundLabel(strategy),
  }));

  plans.sort((a, b) => b.confidence - a.confidence);

  // Roll probability up to the question fans actually argue about: how many stops?
  const stopTotals = new Map<number, number>();
  for (const plan of plans) {
    const stops = plan.strategy.stints.length - 1;
    stopTotals.set(stops, (stopTotals.get(stops) ?? 0) + plan.confidence);
  }
  const byStopCount = [...stopTotals.entries()]
    .map(([stops, probability]) => ({ stops, probability }))
    .sort((a, b) => b.probability - a.probability);

  return {
    primary: plans[0],
    alternatives: plans.slice(1),
    contested: plans[0].confidence < 0.45,
    byStopCount,
  };
}

/** How the model's confidence should be described in words, not decimals. */
export function confidenceWord(p: number): { word: string; tone: 'mint' | 'warn' | 'neutral' } {
  if (p >= 0.6) return { word: 'Strong call', tone: 'mint' };
  if (p >= 0.4) return { word: 'Likely', tone: 'mint' };
  if (p >= 0.25) return { word: 'Leaning', tone: 'warn' };
  return { word: 'Wide open', tone: 'warn' };
}
