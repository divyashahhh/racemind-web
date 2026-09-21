import { useMemo, useRef } from 'react';
import { PlotFrame, makeScales, useMeasuredWidth } from './primitives';
import { formatDelta } from '../lib/format';
import { seriesColor } from '../ui/tokens';
import type { Strategy, StrategyOutcome } from '../sim/types';

/**
 * Finishing-time distributions, drawn relative to the best median plan.
 *
 * The overlap between two histograms is the honest answer to "is this strategy
 * better?". Two plans separated by 2s on the mean but overlapping almost entirely
 * are, for practical purposes, the same call — and a single number can never say so.
 */
export function OutcomeDistribution({
  series,
  height = 200,
  bins = 40,
}: {
  series: { strategy: Strategy; outcome: StrategyOutcome }[];
  height?: number;
  bins?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(ref, 640);

  const { histograms, xDomain, yMax, baseline } = useMemo(() => {
    if (series.length === 0) {
      return { histograms: [], xDomain: [0, 1] as [number, number], yMax: 1, baseline: 0 };
    }
    const base = Math.min(...series.map((s) => s.outcome.p50));
    const all = series.flatMap((s) => s.outcome.samples.map((v) => v - base));
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    const p99 = [...all].sort((a, b) => a - b)[Math.floor(all.length * 0.99)] ?? hi;
    const upper = Math.min(hi, p99);
    const step = (upper - lo) / bins;

    const built = series.map((s) => {
      const counts = new Array<number>(bins).fill(0);
      for (const v of s.outcome.samples) {
        const d = v - base;
        const idx = Math.floor((d - lo) / Math.max(1e-9, step));
        if (idx >= 0 && idx < bins) counts[idx] += 1;
      }
      return { series: s, counts };
    });
    const peak = Math.max(1, ...built.flatMap((b) => b.counts));
    return {
      histograms: built,
      xDomain: [lo, upper] as [number, number],
      yMax: peak,
      baseline: base,
    };
  }, [series, bins]);

  if (histograms.length === 0) return null;

  const yDomain: [number, number] = [0, yMax];
  const scales = makeScales(width, height, xDomain, yDomain);
  const binWidth = scales.innerWidth / bins;

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <PlotFrame
        width={width}
        height={height}
        scales={scales}
        xDomain={xDomain}
        yDomain={yDomain}
        xLabel="Finishing time vs best median (s)"
        yLabel="Simulations"
        yFormat={(v) => v.toFixed(0)}
        clipId="clip-dist"
      >
        {histograms.map((h, i) =>
          h.counts.map((count, b) =>
            count === 0 ? null : (
              <rect
                key={`${h.series.outcome.strategyId}-${b}`}
                x={b * binWidth}
                y={scales.y(count)}
                width={Math.max(1, binWidth - 0.5)}
                height={scales.innerHeight - scales.y(count)}
                fill={seriesColor(i)}
                opacity={0.45}
              />
            ),
          ),
        )}
        <line
          x1={scales.x(0)}
          x2={scales.x(0)}
          y1={0}
          y2={scales.innerHeight}
          stroke="var(--text-faint)"
          strokeDasharray="3 3"
        />
      </PlotFrame>
      <div className="small faint" style={{ marginTop: 4 }}>
        Zero is the fastest median plan ({formatDelta(baseline - baseline, 0)}s reference).
        Overlapping distributions mean the strategies are genuinely hard to separate.
      </div>
    </div>
  );
}
