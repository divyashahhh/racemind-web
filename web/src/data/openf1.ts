/**
 * Browser-side OpenF1 client.
 *
 * Two things this must get right, both of which the original prototype got wrong:
 *
 *  1. Field names. /laps returns `lap_duration`, not `duration`, and carries no tyre
 *     field at all — compounds live on /stints. Reading the wrong keys fails silently,
 *     producing empty tables and null model inputs rather than an error.
 *  2. Rate limits. The free tier allows 3 req/s and 30 req/min. Firing uncached
 *     requests from render will get the user throttled within seconds.
 */

const BASE = 'https://api.openf1.org/v1';

/** Only 2023 onward exists. Offering earlier seasons guarantees empty results. */
export const AVAILABLE_SEASONS = [2023, 2024, 2025, 2026] as const;
export type Season = (typeof AVAILABLE_SEASONS)[number];

export interface Session {
  session_key: number;
  meeting_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  circuit_short_name: string;
  circuit_key: number;
  country_name: string;
  location: string;
  year: number;
  is_cancelled?: boolean;
}

export interface Lap {
  session_key: number;
  driver_number: number;
  lap_number: number;
  /** Seconds. Null on the formation lap and on some in-laps. */
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  is_pit_out_lap: boolean;
  st_speed: number | null;
}

export interface Stint {
  session_key: number;
  driver_number: number;
  stint_number: number;
  lap_start: number;
  lap_end: number;
  compound: string;
  tyre_age_at_start: number | null;
}

export interface PitStop {
  session_key: number;
  driver_number: number;
  lap_number: number;
  /** Total time in the pit lane, seconds. */
  pit_duration: number | null;
  lane_duration: number | null;
}

export interface Driver {
  session_key: number;
  driver_number: number;
  full_name: string;
  name_acronym: string;
  team_name: string;
  team_colour: string | null;
  headshot_url: string | null;
}

export interface Weather {
  session_key: number;
  date: string;
  air_temperature: number;
  track_temperature: number;
  humidity: number;
  rainfall: number;
  wind_speed: number;
}

export interface RaceControl {
  session_key: number;
  date: string;
  category: string | null;
  flag: string | null;
  message: string | null;
  lap_number: number | null;
  scope: string | null;
}

export interface SessionResult {
  session_key: number;
  driver_number: number;
  position: number | null;
  number_of_laps: number | null;
  dnf: boolean | null;
  dns: boolean | null;
  dsq: boolean | null;
  duration: number | number[] | null;
  gap_to_leader: number | string | null;
}

// --- Rate limiting -------------------------------------------------------------

const MAX_PER_SECOND = 3;
const MAX_PER_MINUTE = 28; // one under the cap, to leave headroom
const timestamps: number[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (timestamps.length && now - timestamps[0] > 60_000) timestamps.shift();
    const lastSecond = timestamps.filter((t) => now - t < 1000).length;
    if (lastSecond < MAX_PER_SECOND && timestamps.length < MAX_PER_MINUTE) {
      timestamps.push(now);
      return;
    }
    await sleep(200);
  }
}

// --- Caching -------------------------------------------------------------------

const memory = new Map<string, unknown>();
/** In-flight requests, so two components mounting at once make one network call. */
const inflight = new Map<string, Promise<unknown>>();

const STORAGE_PREFIX = 'racemind:of1:';
const STORAGE_TTL_MS = 1000 * 60 * 60 * 24 * 7;

function readStorage<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: T };
    if (Date.now() - parsed.at > STORAGE_TTL_MS) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeStorage(key: string, data: unknown): void {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Quota exceeded is fine — the memory cache still covers this session.
  }
}

export function clearCache(): void {
  memory.clear();
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(STORAGE_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    /* ignore */
  }
}

// --- Fetch ---------------------------------------------------------------------

async function get<T>(endpoint: string, params: Record<string, string | number>): Promise<T[]> {
  const query = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  ).toString();
  const key = `${endpoint}?${query}`;

  const cached = (memory.get(key) as T[] | undefined) ?? readStorage<T[]>(key);
  if (cached) {
    memory.set(key, cached);
    return cached;
  }

  const existing = inflight.get(key);
  if (existing) return existing as Promise<T[]>;

  const request = (async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await acquireSlot();
      const resp = await fetch(`${BASE}/${endpoint}?${query}`);
      if (resp.status === 429) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      // OpenF1 answers "no rows" with a 404 and a JSON body, not an empty array.
      if (resp.status === 404) {
        memory.set(key, []);
        writeStorage(key, []);
        return [] as T[];
      }
      if (!resp.ok) throw new Error(`OpenF1 ${endpoint} failed: ${resp.status}`);
      const body = (await resp.json()) as unknown;
      const data = Array.isArray(body) ? (body as T[]) : [];
      memory.set(key, data);
      writeStorage(key, data);
      return data;
    }
    throw new Error(`OpenF1 ${endpoint}: rate limited after repeated retries`);
  })().finally(() => inflight.delete(key));

  inflight.set(key, request);
  return request;
}

// --- Endpoints -----------------------------------------------------------------

export async function getRaces(year: number): Promise<Session[]> {
  const sessions = await get<Session>('sessions', { year, session_name: 'Race' });
  const now = Date.now();
  return sessions
    .filter((s) => !s.is_cancelled && new Date(s.date_end).getTime() < now)
    .sort((a, b) => a.date_start.localeCompare(b.date_start));
}

export const getLaps = (sessionKey: number) => get<Lap>('laps', { session_key: sessionKey });
export const getStints = (sessionKey: number) => get<Stint>('stints', { session_key: sessionKey });
export const getPitStops = (sessionKey: number) => get<PitStop>('pit', { session_key: sessionKey });
export const getDrivers = (sessionKey: number) => get<Driver>('drivers', { session_key: sessionKey });
export const getWeather = (sessionKey: number) => get<Weather>('weather', { session_key: sessionKey });
export const getRaceControl = (sessionKey: number) =>
  get<RaceControl>('race_control', { session_key: sessionKey });
export const getSessionResult = (sessionKey: number) =>
  get<SessionResult>('session_result', { session_key: sessionKey });
