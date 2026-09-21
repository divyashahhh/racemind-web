/// <reference lib="webworker" />
import { enumerateStrategies, DEFAULT_ENUMERATION, type EnumerationOptions } from './optimize';
import { simulate } from './simulate';
import type { CircuitModel, SimulationSettings, Strategy, StrategyOutcome } from './types';

export type WorkerRequest =
  | { kind: 'enumerate'; id: number; circuit: CircuitModel; options?: EnumerationOptions }
  | { kind: 'simulate'; id: number; circuit: CircuitModel; strategies: Strategy[]; settings: SimulationSettings };

export type WorkerResponse =
  | { kind: 'enumerate'; id: number; strategies: Strategy[]; elapsedMs: number }
  | { kind: 'simulate'; id: number; outcomes: StrategyOutcome[]; elapsedMs: number }
  | { kind: 'error'; id: number; message: string };

/**
 * Both the search and the simulation run off the main thread.
 *
 * The exhaustive plan search is ~450ms on a 60-lap circuit and over a second on the
 * long ones, and the Monte Carlo is a few million lap evaluations on top. Either one
 * on the main thread blocks paint long enough to break the drag interaction on the
 * strategy board, which is the one thing that has to stay smooth.
 */
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  const started = performance.now();
  const post = (response: WorkerResponse) => (self as unknown as Worker).postMessage(response);

  try {
    if (request.kind === 'enumerate') {
      post({
        kind: 'enumerate',
        id: request.id,
        strategies: enumerateStrategies(request.circuit, request.options ?? DEFAULT_ENUMERATION),
        elapsedMs: performance.now() - started,
      });
      return;
    }
    post({
      kind: 'simulate',
      id: request.id,
      outcomes: simulate(request.circuit, request.strategies, request.settings),
      elapsedMs: performance.now() - started,
    });
  } catch (err) {
    post({ kind: 'error', id: request.id, message: err instanceof Error ? err.message : String(err) });
  }
};
