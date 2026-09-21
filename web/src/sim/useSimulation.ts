import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkerRequest, WorkerResponse } from './sim.worker';
import { DEFAULT_SETTINGS } from './types';
import type { CircuitModel, SimulationSettings, Strategy, StrategyOutcome } from './types';

export interface SimulationState {
  outcomes: StrategyOutcome[] | null;
  running: boolean;
  elapsedMs: number | null;
  error: string | null;
}

export interface PlannerState extends SimulationState {
  strategies: Strategy[];
  planning: boolean;
  /** Replace the shortlist, e.g. after the user drags a pit stop. */
  setStrategies: (update: Strategy[] | ((prev: Strategy[]) => Strategy[])) => void;
}

function createWorker(): Worker {
  return new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
}

/**
 * Owns the worker, the shortlist and the simulation results for one circuit.
 *
 * Only the newest request of each kind is honoured. Dragging a pit stop fires a
 * simulate request per frame; without "latest wins" they would queue and the UI would
 * fall further behind the more the user interacted with it.
 */
export function usePlanner(
  circuit: CircuitModel | null,
  settings: SimulationSettings = DEFAULT_SETTINGS,
): PlannerState {
  const workerRef = useRef<Worker | null>(null);
  const nextId = useRef(0);
  const latestEnumerate = useRef(0);
  const latestSimulate = useRef(0);

  const [strategies, setStrategiesState] = useState<Strategy[]>([]);
  const [planning, setPlanning] = useState(false);
  const [state, setState] = useState<SimulationState>({
    outcomes: null,
    running: false,
    elapsedMs: null,
    error: null,
  });

  useEffect(() => {
    const worker = createWorker();
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const message = event.data;
      if (message.kind === 'error') {
        setState((prev) => ({ ...prev, running: false, error: message.message }));
        setPlanning(false);
        return;
      }
      if (message.kind === 'enumerate') {
        if (message.id !== latestEnumerate.current) return;
        setStrategiesState(message.strategies);
        setPlanning(false);
        return;
      }
      if (message.id !== latestSimulate.current) return;
      setState({ outcomes: message.outcomes, running: false, elapsedMs: message.elapsedMs, error: null });
    };
    worker.onerror = (event) => {
      setState((prev) => ({ ...prev, running: false, error: event.message || 'Simulation failed' }));
      setPlanning(false);
    };
    workerRef.current = worker;
    return () => worker.terminate();
  }, []);

  // Re-derive the shortlist when the circuit changes.
  useEffect(() => {
    const worker = workerRef.current;
    if (!circuit) {
      // Rounds with no fitted model must not keep showing the previous circuit's call.
      setStrategiesState([]);
      setState({ outcomes: null, running: false, elapsedMs: null, error: null });
      setPlanning(false);
      return;
    }
    if (!worker) return;
    const id = ++nextId.current;
    latestEnumerate.current = id;
    setPlanning(true);
    setState({ outcomes: null, running: true, elapsedMs: null, error: null });
    const request: WorkerRequest = { kind: 'enumerate', id, circuit };
    worker.postMessage(request);
  }, [circuit?.key]);

  const key = useMemo(
    () => `${circuit?.key ?? ''}|${strategies.map((s) => s.id).join('~')}|${JSON.stringify(settings)}`,
    [circuit?.key, strategies, settings],
  );

  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !circuit || strategies.length === 0) return;
    const id = ++nextId.current;
    latestSimulate.current = id;
    setState((prev) => ({ ...prev, running: true, error: null }));
    const request: WorkerRequest = { kind: 'simulate', id, circuit, strategies, settings };
    worker.postMessage(request);
  }, [key]);

  return {
    ...state,
    strategies,
    planning,
    setStrategies: setStrategiesState as PlannerState['setStrategies'],
  };
}
