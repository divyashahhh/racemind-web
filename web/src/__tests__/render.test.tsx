import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import App from '../App';
import { PredictPage } from '../pages/PredictPage';
import { CalendarPage } from '../pages/CalendarPage';
import { ModelPage } from '../pages/ModelPage';
import { CALENDAR, TEAMS } from '../models/context';

/**
 * Smoke tests: every page must mount and reach a usable state.
 *
 * A clean typecheck and a successful bundle say nothing about whether a page throws on
 * first render — which is the class of failure that left the original prototype's
 * analytics tab showing "No Data Found" forever.
 */

// The worker is unavailable under jsdom, so the planner is stubbed with a real shortlist
// computed synchronously. That still exercises the board, the call and the evidence.
vi.mock('../sim/useSimulation', async () => {
  const { enumerateStrategies } = await vi.importActual<typeof import('../sim/optimize')>('../sim/optimize');
  return {
    usePlanner: (circuit: Parameters<typeof enumerateStrategies>[0] | null) => ({
      outcomes: null,
      running: false,
      planning: Boolean(circuit),
      elapsedMs: null,
      error: null,
      strategies: circuit ? enumerateStrategies(circuit) : [],
      setStrategies: () => {},
    }),
  };
});

afterEach(cleanup);

beforeEach(() => {
  // ResizeObserver backs the responsive charts and does not exist in jsdom.
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  // Radix Select measures with pointer APIs jsdom does not implement.
  Element.prototype.scrollIntoView = () => {};
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.releasePointerCapture = () => {};
});

describe('shell', () => {
  it('mounts with the three tabs of the rebranded IA', () => {
    render(<App />);
    expect(screen.getByText('RaceMind')).toBeTruthy();
    // Scoped to the nav: the footer also links to Model.
    const nav = within(screen.getByRole('navigation'));
    for (const label of ['Predict', 'Calendar', 'Model']) {
      expect(nav.getByRole('button', { name: label }), label).toBeTruthy();
    }
  });

  it('shows the 2027 season badge', () => {
    render(<App />);
    expect(screen.getByText(/2027 season/i)).toBeTruthy();
  });
});

describe('predict page', () => {
  it('renders the input controls a fan needs', () => {
    render(<PredictPage round={1} onRoundChange={() => {}} />);
    for (const label of ['Your team', 'Driver', 'Race', 'Grid slot', 'Rain risk', 'Track temperature']) {
      expect(screen.getByText(label), label).toBeTruthy();
    }
  });

  it('shows the call panel while the simulation is pending', () => {
    render(<PredictPage round={1} onRoundChange={() => {}} />);
    expect(screen.getByText(/Simulating the race/i)).toBeTruthy();
  });

  it('surfaces real historical evidence rather than model output', async () => {
    render(<PredictPage round={1} onRoundChange={() => {}} />);
    // Round 1 is Sakhir, which has four races of history.
    await waitFor(() => {
      expect(screen.getByText(/What .* actually did at Sakhir/i)).toBeTruthy();
    });
  });

  it('refuses to predict a round with no fitted model, and says why', () => {
    const portugal = CALENDAR.find((r) => !r.hasModel)!;
    render(<PredictPage round={portugal.round} onRoundChange={() => {}} />);
    expect(screen.getByText(new RegExp(`No model for ${portugal.location}`, 'i'))).toBeTruthy();
    // And it must not show a call anyway.
    expect(screen.queryByText(/Most likely strategy/i)).toBeNull();
  });
});

describe('calendar page', () => {
  it('lists all 24 rounds of the 2027 season', () => {
    render(<CalendarPage selected={1} onPick={() => {}} />);
    expect(CALENDAR).toHaveLength(24);
    for (const round of CALENDAR.slice(0, 5)) {
      expect(screen.getByText(round.shortName), round.shortName).toBeTruthy();
    }
  });

  it('flags the rounds with no data instead of hiding them', () => {
    render(<CalendarPage selected={1} onPick={() => {}} />);
    const missing = CALENDAR.filter((r) => !r.hasModel);
    expect(missing.length).toBeGreaterThan(0);
    expect(screen.getAllByText('no data')).toHaveLength(missing.length);
  });
});

describe('model page', () => {
  it('holds the technical material, including the honest limitations', () => {
    render(<ModelPage />);
    expect(screen.getByText('Under the hood')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Limitations' })).toBeTruthy();
  });

  it('shows the fitted corpus size', () => {
    const { container } = render(<ModelPage />);
    expect(within(container).getByText('Clean laps fitted')).toBeTruthy();
    expect(within(container).getByText('66,278')).toBeTruthy();
  });
});

describe('2027 context', () => {
  it('has a full grid with team colours and drivers', () => {
    expect(TEAMS.length).toBeGreaterThanOrEqual(10);
    for (const team of TEAMS) {
      expect(team.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(team.drivers.length).toBeGreaterThan(0);
    }
  });

  it('maps every round to either a fitted circuit or an explicit null', () => {
    for (const round of CALENDAR) {
      if (round.hasModel) expect(round.circuitKey).toBeTruthy();
      expect(round.round).toBeGreaterThan(0);
      expect(round.date).toMatch(/^2027-/);
    }
  });
});
