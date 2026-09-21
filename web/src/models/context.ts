import raw from './context.json';

export interface Round {
  round: number;
  name: string;
  shortName: string;
  country: string;
  countryCode: string;
  location: string;
  date: string;
  sprint: boolean;
  /** Key into the fitted circuit catalog, or null where the model has never seen it. */
  circuitKey: string | null;
  hasModel: boolean;
  racesInHistory: number;
}

export interface Driver {
  number: number;
  name: string;
  acronym: string;
  headshot: string | null;
}

export interface Team {
  name: string;
  colour: string;
  drivers: Driver[];
  /** Median lap-time offset vs the field across 2026, in seconds. Negative is faster. */
  paceOffset: number | null;
}

export interface HistoryEntry {
  driver: string;
  acronym: string;
  team: string;
  position: number | null;
  finished: boolean;
  stops: number;
  compounds: string[];
  stintLaps: number[];
  pitLaps: number[];
  allDry: boolean;
}

export interface HistoryRace {
  year: number;
  totalLaps: number;
  entries: HistoryEntry[];
}

interface ContextPayload {
  generatedAt: string;
  season: number;
  calendar: Round[];
  teams: Team[];
  history: Record<string, HistoryRace[]>;
}

const payload = raw as unknown as ContextPayload;

export const SEASON = payload.season;
export const CALENDAR: Round[] = payload.calendar;
export const TEAMS: Team[] = payload.teams;

export const ROUND_BY_NUMBER = new Map(CALENDAR.map((r) => [r.round, r]));
export const TEAM_BY_NAME = new Map(TEAMS.map((t) => [t.name, t]));

/** Past races at a circuit, newest first. Empty for circuits with no OpenF1 history. */
export function historyFor(circuitKey: string | null): HistoryRace[] {
  if (!circuitKey) return [];
  return payload.history[circuitKey] ?? [];
}

/** Every past run by one team at one circuit, newest first. */
export function teamHistory(circuitKey: string | null, team: string) {
  return historyFor(circuitKey).flatMap((race) =>
    race.entries
      .filter((e) => e.team === team)
      .map((entry) => ({ year: race.year, totalLaps: race.totalLaps, entry })),
  );
}

/**
 * The next round after today, which is what a fan actually wants to see on landing.
 * Falls back to round 1 once the season is over.
 */
export function nextRound(today = new Date()): Round {
  return CALENDAR.find((r) => new Date(r.date) >= today) ?? CALENDAR[0];
}

/** How often each stop count has been used at a circuit, across all dry runs. */
export function stopCountHistogram(circuitKey: string | null): Map<number, number> {
  const counts = new Map<number, number>();
  for (const race of historyFor(circuitKey)) {
    for (const entry of race.entries) {
      if (!entry.finished || !entry.allDry) continue;
      counts.set(entry.stops, (counts.get(entry.stops) ?? 0) + 1);
    }
  }
  return counts;
}
