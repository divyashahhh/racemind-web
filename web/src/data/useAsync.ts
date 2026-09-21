import { useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Minimal async-resource hook.
 *
 * Deliberately not a data-fetching library: the OpenF1 client already owns caching,
 * deduplication and rate limiting, so all that is left is tracking state and
 * discarding results from a request the user has already navigated away from.
 */
export function useAsync<T>(factory: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const generation = useRef(0);

  useEffect(() => {
    const current = ++generation.current;
    setState((prev) => ({ data: prev.data, loading: true, error: null }));
    factory()
      .then((data) => {
        if (generation.current === current) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (generation.current !== current) return;
        setState({
          data: null,
          loading: false,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}
