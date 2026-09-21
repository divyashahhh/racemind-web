import type { Driver, Lap, PitStop, RaceControl, Stint, Weather } from './openf1';

export interface DriverStintView {
  stintNumber: number;
  compound: string;
  lapStart: number;
  lapEnd: number;
  laps: number;
  ageAtStart: number;
  /** Median green-flag lap time within the stint, or null if none were usable. */
  medianLap: number | null;
  /** Fitted seconds-per-lap loss across the stint, from its own green-flag laps. */
  degradation: number | null;
}

export interface DriverRaceView {
  driverNumber: number;
  name: string;
  acronym: string;
  team: string;
  teamColour: string;
  totalTime: number | null;
  bestLap: number | null;
  medianLap: number | null;
  lapsCompleted: number;
  stops: number;
  stints: DriverStintView[];
  /** Cumulative elapsed time by lap, for the historical race trace. */
  cumulative: number[];
}

const TEAM_FALLBACK = '#8b949e';

/** Laps that say something about pace: no in-laps, out-laps, or safety-car laps. */
function isGreenFlag(lap: Lap, inLaps: Set<number>, scLaps: Set<number>): boolean {
  return (
    lap.lap_duration != null &&
    lap.lap_duration > 50 &&
    lap.lap_duration < 220 &&
    !lap.is_pit_out_lap &&
    !inLaps.has(lap.lap_number) &&
    !scLaps.has(lap.lap_number)
  );
}

/** Laps run under a safety car, VSC or red flag, widened by a conservative window. */
export function neutralisedLaps(control: RaceControl[]): Set<number> {
  const laps = new Set<number>();
  for (const row of control) {
    const message = (row.message ?? '').toUpperCase();
    const category = (row.category ?? '').toUpperCase();
    const neutralised =
      message.includes('SAFETY CAR') ||
      message.includes('VSC') ||
      category.includes('SAFETYCAR') ||
      (row.flag ?? '').toUpperCase() === 'RED';
    if (!neutralised || row.lap_number == null) continue;
    for (let offset = 0; offset < 4; offset++) laps.add(row.lap_number + offset);
  }
  return laps;
}

function slope(points: { x: number; y: number }[]): number | null {
  if (points.length < 5) return null;
  const n = points.length;
  const mx = points.reduce((a, p) => a + p.x, 0) / n;
  const my = points.reduce((a, p) => a + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const dx = p.x - mx;
    num += dx * (p.y - my);
    den += dx * dx;
  }
  return den > 0 ? num / den : null;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Join laps, stints, pit stops and drivers into one per-driver view of a race.
 *
 * This replaces the prototype's approach of inferring stops by counting laps more
 * than 10s above the median — a heuristic that conflated pit stops with traffic,
 * safety cars and mistakes. /pit and /stints state both facts directly.
 */
export function analyseRace(
  laps: Lap[],
  stints: Stint[],
  pits: PitStop[],
  drivers: Driver[],
  control: RaceControl[],
): DriverRaceView[] {
  const scLaps = neutralisedLaps(control);
  const byDriver = new Map<number, Lap[]>();
  for (const lap of laps) {
    if (!byDriver.has(lap.driver_number)) byDriver.set(lap.driver_number, []);
    byDriver.get(lap.driver_number)!.push(lap);
  }

  const stintsByDriver = new Map<number, Stint[]>();
  for (const s of stints) {
    if (!stintsByDriver.has(s.driver_number)) stintsByDriver.set(s.driver_number, []);
    stintsByDriver.get(s.driver_number)!.push(s);
  }

  const pitsByDriver = new Map<number, PitStop[]>();
  for (const p of pits) {
    if (!pitsByDriver.has(p.driver_number)) pitsByDriver.set(p.driver_number, []);
    pitsByDriver.get(p.driver_number)!.push(p);
  }

  const driverMeta = new Map(drivers.map((d) => [d.driver_number, d]));

  const views: DriverRaceView[] = [];
  for (const [driverNumber, driverLaps] of byDriver) {
    driverLaps.sort((a, b) => a.lap_number - b.lap_number);
    const meta = driverMeta.get(driverNumber);
    const driverStints = (stintsByDriver.get(driverNumber) ?? []).sort(
      (a, b) => a.stint_number - b.stint_number,
    );
    const inLaps = new Set((pitsByDriver.get(driverNumber) ?? []).map((p) => p.lap_number));

    const timed = driverLaps.filter((l) => l.lap_duration != null);
    const green = driverLaps.filter((l) => isGreenFlag(l, inLaps, scLaps));

    const cumulative: number[] = [0];
    let running = 0;
    for (const lap of driverLaps) {
      running += lap.lap_duration ?? 0;
      cumulative[lap.lap_number] = running;
    }

    const stintViews: DriverStintView[] = driverStints.map((s) => {
      const within = green.filter(
        (l) => l.lap_number >= s.lap_start && l.lap_number <= s.lap_end,
      );
      return {
        stintNumber: s.stint_number,
        compound: (s.compound ?? 'UNKNOWN').toUpperCase(),
        lapStart: s.lap_start,
        lapEnd: s.lap_end,
        laps: s.lap_end - s.lap_start + 1,
        ageAtStart: s.tyre_age_at_start ?? 0,
        medianLap: median(within.map((l) => l.lap_duration!)),
        degradation: slope(
          within.map((l) => ({ x: l.lap_number - s.lap_start, y: l.lap_duration! })),
        ),
      };
    });

    views.push({
      driverNumber,
      name: meta?.full_name ?? `Car ${driverNumber}`,
      acronym: meta?.name_acronym ?? String(driverNumber),
      team: meta?.team_name ?? 'Unknown',
      teamColour: meta?.team_colour ? `#${meta.team_colour}` : TEAM_FALLBACK,
      totalTime: timed.length ? timed.reduce((a, l) => a + l.lap_duration!, 0) : null,
      bestLap: green.length ? Math.min(...green.map((l) => l.lap_duration!)) : null,
      medianLap: median(green.map((l) => l.lap_duration!)),
      lapsCompleted: driverLaps.length,
      // The real stop count, from /pit — not guessed from lap-time outliers.
      stops: (pitsByDriver.get(driverNumber) ?? []).length,
      stints: stintViews,
      cumulative,
    });
  }

  // Order by laps completed then elapsed time, which reproduces the classification
  // for everyone who saw the flag.
  return views.sort((a, b) => {
    if (b.lapsCompleted !== a.lapsCompleted) return b.lapsCompleted - a.lapsCompleted;
    return (a.totalTime ?? Infinity) - (b.totalTime ?? Infinity);
  });
}

export interface WeatherSummary {
  airTemp: number | null;
  trackTemp: number | null;
  humidity: number | null;
  rainfall: boolean;
}

export function summariseWeather(rows: Weather[]): WeatherSummary {
  if (rows.length === 0) {
    return { airTemp: null, trackTemp: null, humidity: null, rainfall: false };
  }
  const mean = (pick: (w: Weather) => number) =>
    rows.reduce((a, w) => a + (pick(w) ?? 0), 0) / rows.length;
  return {
    airTemp: mean((w) => w.air_temperature),
    trackTemp: mean((w) => w.track_temperature),
    humidity: mean((w) => w.humidity),
    rainfall: rows.some((w) => w.rainfall > 0),
  };
}
