import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { StrategyPage } from '../pages/StrategyPage';
import { ModelPage } from '../pages/ModelPage';
import { ExplorePage } from '../pages/ExplorePage';
import { RacePage } from '../pages/RacePage';
import App from '../App';

/**
 * Smoke tests: every page must mount and reach a usable state.
 *
 * A clean typecheck and a successful bundle say nothing about whether a page throws
 * on first render — which is exactly the class of failure that made the original
 * prototype's analytics tab show "No Data Found" forever.
 */

// The worker and network are not available under jsdom, so both are stubbed. The point
// here is that the components mount and wire up, not that the maths runs again.
// The worker is unavailable under jsdom, so the planner is stubbed with a real
// shortlist computed synchronously. That still exercises the board, the compound
// editor and the stint bars.
vi.mock('../sim/useSimulation', async () => {
  const { enumerateStrategies } = await vi.importActual<typeof import('../sim/optimize')>('../sim/optimize');
  return {
    usePlanner: (circuit: Parameters<typeof enumerateStrategies>[0] | null) => ({
      outcomes: null,
      running: false,
      planning: false,
      elapsedMs: null,
      error: null,
      strategies: circuit ? enumerateStrategies(circuit) : [],
      setStrategies: () => {},
    }),
  };
});

vi.mock('../data/openf1', async () => {
  const actual = await vi.importActual<typeof import('../data/openf1')>('../data/openf1');
  return {
    ...actual,
    getRaces: vi.fn(async () => [
      {
        session_key: 1,
        meeting_key: 1,
        session_name: 'Race',
        session_type: 'Race',
        date_start: '2026-03-08T15:00:00+00:00',
        date_end: '2026-03-08T17:00:00+00:00',
        circuit_short_name: 'Sakhir',
        circuit_key: 63,
        country_name: 'Bahrain',
        location: 'Sakhir',
        year: 2026,
      },
    ]),
    getLaps: vi.fn(async () => [
      { session_key: 1, driver_number: 1, lap_number: 1, lap_duration: 95.1, duration_sector_1: null, duration_sector_2: null, duration_sector_3: null, is_pit_out_lap: false, st_speed: null },
      { session_key: 1, driver_number: 1, lap_number: 2, lap_duration: 94.8, duration_sector_1: null, duration_sector_2: null, duration_sector_3: null, is_pit_out_lap: false, st_speed: null },
    ]),
    getStints: vi.fn(async () => [
      { session_key: 1, driver_number: 1, stint_number: 1, lap_start: 1, lap_end: 2, compound: 'MEDIUM', tyre_age_at_start: 0 },
    ]),
    getPitStops: vi.fn(async () => []),
    getDrivers: vi.fn(async () => [
      { session_key: 1, driver_number: 1, full_name: 'Max Verstappen', name_acronym: 'VER', team_name: 'Red Bull Racing', team_colour: '3671C6', headshot_url: null },
    ]),
    getWeather: vi.fn(async () => [
      { session_key: 1, date: '', air_temperature: 22, track_temperature: 34, humidity: 50, rainfall: 0, wind_speed: 1 },
    ]),
    getRaceControl: vi.fn(async () => []),
  };
});

// Without vitest `globals`, testing-library does not register its own auto-cleanup,
// so mounted trees would otherwise pile up and every query would match twice.
afterEach(cleanup);

beforeEach(() => {
  // ResizeObserver backs the responsive charts and does not exist in jsdom.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

describe('pages render', () => {
  it('mounts the app shell with all four tabs', () => {
    render(<App />);
    for (const label of ['Strategy', 'Race', 'Model', 'Explore']) {
      expect(screen.getByRole('tab', { name: label })).toBeTruthy();
    }
  });

  it('renders the strategy board with a circuit selected', async () => {
    render(<StrategyPage />);
    expect(screen.getByText('Strategy board')).toBeTruthy();
    expect(screen.getByLabelText('Circuit')).toBeTruthy();
    // The shortlist must actually be populated, not an empty list.
    await waitFor(() => {
      expect(screen.getAllByText(/-stop/).length).toBeGreaterThan(1);
    });
  });

  it('renders the model page with fitted coefficients and a backtest', () => {
    render(<ModelPage />);
    expect(screen.getByText('Fitted model')).toBeTruthy();
    expect(screen.getByText('Degradation curves')).toBeTruthy();
    expect(screen.getByText('Backtest')).toBeTruthy();
    expect(screen.getByText(/Known limitations/)).toBeTruthy();
  });

  it('renders the circuit comparison', () => {
    render(<ExplorePage />);
    expect(screen.getByText('Circuits')).toBeTruthy();
    expect(screen.getAllByRole('row').length).toBeGreaterThan(10);
  });

  it('loads a race and shows real stint data', async () => {
    render(<RacePage />);
    await waitFor(() => expect(screen.getByText(/Tyre strategies/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Max Verstappen')).toBeTruthy());
    expect(screen.getByText('Classification')).toBeTruthy();
  });
});
