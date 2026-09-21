import type { CircuitModel } from '@/sim/types';
import { historyFor, stopCountHistogram, teamHistory, type HistoryRace } from '@/models/context';
import { tyreOf } from '@/ui/tyres';

export interface Insight {
  id: string;
  headline: string;
  detail: string;
  tone: 'neutral' | 'mint' | 'warn';
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}

/**
 * What the record actually says about this circuit, phrased for a fan rather than a
 * strategist. Every line is derived from real stint and pit data, never from the model
 * — the point of this panel is to let the user check the prediction against reality.
 */
export function circuitInsights(circuit: CircuitModel | null, circuitKey: string | null): Insight[] {
  const races = historyFor(circuitKey);
  const out: Insight[] = [];

  const histogram = stopCountHistogram(circuitKey);
  const total = [...histogram.values()].reduce((a, b) => a + b, 0);
  if (total > 0) {
    const [topStops, topCount] = [...histogram.entries()].sort((a, b) => b[1] - a[1])[0];
    out.push({
      id: 'stops',
      headline: `${topStops} stop${topStops === 1 ? '' : 's'} is the norm here`,
      detail: `${pct(topCount / total)} of dry finishers across ${races.length} race${races.length === 1 ? '' : 's'} (${total} car finishes) ran exactly ${topStops}.`,
      tone: 'mint',
    });
  }

  if (circuit) {
    const medium = circuit.curves.MEDIUM;
    if (medium) {
      const lossAt20 = medium.alpha + medium.beta * 20 + medium.gamma * 400;
      out.push({
        id: 'deg',
        headline:
          lossAt20 > 1.6
            ? 'Tyres take a beating'
            : lossAt20 > 0.9
              ? 'Moderate tyre wear'
              : 'Very kind on tyres',
        detail: `A medium is about ${lossAt20.toFixed(1)}s a lap slower after 20 laps here. ${
          lossAt20 > 1.6
            ? 'That pushes teams toward an extra stop.'
            : 'Teams can run long without losing much.'
        }`,
        tone: lossAt20 > 1.6 ? 'warn' : 'neutral',
      });
    }

    const scChance = Math.min(1, circuit.safetyCar.perLapRate * circuit.raceLaps);
    out.push({
      id: 'sc',
      headline: `${pct(scChance)} chance of a safety car`,
      detail:
        scChance > 0.55
          ? 'High enough that teams will hold a stop back to react to one. Expect the unexpected.'
          : 'Low enough that teams can commit to a plan and stick to it.',
      tone: scChance > 0.55 ? 'warn' : 'neutral',
    });

    out.push({
      id: 'pit',
      headline: `A stop costs about ${circuit.pitLaneLoss.toFixed(0)}s`,
      detail:
        circuit.pitLaneLoss > 24
          ? 'One of the more expensive pit lanes on the calendar, which argues for fewer stops.'
          : 'A relatively cheap pit lane, so an extra stop is easier to justify.',
      tone: 'neutral',
    });
  }

  return out;
}

export interface TeamRecord {
  year: number;
  driver: string;
  acronym: string;
  position: number | null;
  finished: boolean;
  stops: number;
  compounds: string[];
  stintLaps: number[];
  totalLaps: number;
}

/** What this team has actually run at this circuit, newest first. */
export function teamRecords(circuitKey: string | null, team: string): TeamRecord[] {
  return teamHistory(circuitKey, team).map(({ year, totalLaps, entry }) => ({
    year,
    driver: entry.driver,
    acronym: entry.acronym,
    position: entry.position,
    finished: entry.finished,
    stops: entry.stops,
    compounds: entry.compounds,
    stintLaps: entry.stintLaps,
    totalLaps,
  }));
}

/** One line summarising the team's own pattern here, or null when there is no record. */
export function teamPattern(records: TeamRecord[], team: string): Insight | null {
  const dry = records.filter((r) => r.finished && r.compounds.every((c) => tyreOf(c).letter !== '?'));
  if (dry.length === 0) return null;

  const counts = new Map<number, number>();
  for (const r of dry) counts.set(r.stops, (counts.get(r.stops) ?? 0) + 1);
  const [stops, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];

  const best = dry.reduce<TeamRecord | null>(
    (acc, r) => (r.position && (!acc?.position || r.position < acc.position) ? r : acc),
    null,
  );

  return {
    id: 'team-pattern',
    headline: `${team} ran ${stops} stop${stops === 1 ? '' : 's'} in ${n} of their last ${dry.length}`,
    detail: best?.position
      ? `Their best result here was ${ordinal(best.position)} in ${best.year} on a ${best.stops}-stop.`
      : 'No classified finish on record here.',
    tone: 'neutral',
  };
}

/** The most common compound sequence at a circuit, as a tyre-letter string. */
export function signatureStrategy(circuitKey: string | null): { sequence: string[]; share: number } | null {
  const races: HistoryRace[] = historyFor(circuitKey);
  const counts = new Map<string, number>();
  let total = 0;
  for (const race of races) {
    for (const entry of race.entries) {
      if (!entry.finished || !entry.allDry) continue;
      counts.set(entry.compounds.join('>'), (counts.get(entry.compounds.join('>')) ?? 0) + 1);
      total += 1;
    }
  }
  if (total === 0) return null;
  const [key, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return { sequence: key.split('>'), share: n / total };
}
