import { useMemo, useRef, useState } from 'react';
import { PlotFrame, areaPath, linePath, makeScales, useMeasuredWidth } from './primitives';
import { formatDelta } from '../lib/format';
import { seriesColor } from '@/ui/tyres';
import type { Strategy, StrategyOutcome } from '../sim/types';

export interface TraceSeries {
  strategy: Strategy;
  outcome: StrategyOutcome;
}

/**
 * The race trace: cumulative time delta against a reference strategy, by lap.
 *
 * This is how strategy is actually read. An absolute cumulative-time chart is a
 * near-straight line where every strategy looks identical; plotted as a *delta*, the
 * pit stops become cliffs and the tyre-offset recovery becomes a slope. Where two
 * lines cross is where one strategy takes the lead — that crossover is the undercut,
 * made visible.
 */
export function RaceTrace({
  series,
  referenceId,
  height = 320,
  showBand = true,
}: {
  series: TraceSeries[];
  referenceId: string;
  height?: number;
  showBand?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(containerRef, 820);
  const [hoverLap, setHoverLap] = useState<number | null>(null);

  const reference = series.find((s) => s.outcome.strategyId === referenceId) ?? series[0];

  const { deltas, yDomain, laps } = useMemo(() => {
    if (!reference) return { deltas: [], yDomain: [-5, 5] as [number, number], laps: 0 };
    const n = reference.outcome.medianTrace.length - 1;
    const out = series.map((s) => ({
      series: s,
      median: s.outcome.medianTrace.map((v, lap) => v - reference.outcome.medianTrace[lap]),
      lo: s.outcome.p10Trace.map((v, lap) => v - reference.outcome.medianTrace[lap]),
      hi: s.outcome.p90Trace.map((v, lap) => v - reference.outcome.medianTrace[lap]),
    }));
    let min = 0;
    let max = 0;
    for (const d of out) {
      const pool = showBand ? [...d.lo, ...d.hi] : d.median;
      for (const v of pool) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    const pad = Math.max(1, (max - min) * 0.1);
    return { deltas: out, yDomain: [min - pad, max + pad] as [number, number], laps: n };
  }, [series, reference, showBand]);

  if (!reference || laps === 0) return <div className="faint small">No simulation yet.</div>;

  const xDomain: [number, number] = [0, laps];
  const scales = makeScales(width, height, xDomain, yDomain);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <PlotFrame
        width={width}
        height={height}
        scales={scales}
        xDomain={xDomain}
        yDomain={yDomain}
        xLabel="Lap"
        yLabel="Gap to reference (s)"
        yFormat={(v) => formatDelta(v, 0)}
        clipId="clip-trace"
        onPointerMove={(e) => {
          const rect = (e.target as SVGRectElement).getBoundingClientRect();
          const lap = Math.round(scales.xInvert(e.clientX - rect.left));
          setHoverLap(Math.max(0, Math.min(laps, lap)));
        }}
        onPointerLeave={() => setHoverLap(null)}
      >
        {/* Zero line: the reference strategy itself. */}
        <line
          x1={0}
          x2={scales.innerWidth}
          y1={scales.y(0)}
          y2={scales.y(0)}
          stroke="var(--border-strong)"
          strokeDasharray="3 3"
        />

        {showBand &&
          deltas.map((d, i) => (
            <path
              key={`band-${d.series.outcome.strategyId}`}
              d={areaPath(
                d.hi.map((v, lap) => ({ x: scales.x(lap), y: scales.y(v) })),
                d.lo.map((v, lap) => ({ x: scales.x(lap), y: scales.y(v) })),
              )}
              fill={seriesColor(i)}
              opacity={0.1}
            />
          ))}

        {deltas.map((d, i) => (
          <path
            key={`line-${d.series.outcome.strategyId}`}
            d={linePath(d.median.map((v, lap) => ({ x: scales.x(lap), y: scales.y(v) })))}
            fill="none"
            stroke={seriesColor(i)}
            strokeWidth={d.series.outcome.strategyId === referenceId ? 2.4 : 1.8}
          />
        ))}

        {/* Pit stop markers, where the cliffs come from. */}
        {deltas.map((d, i) =>
          d.series.strategy.stints.slice(0, -1).map((stint) => (
            <circle
              key={`pit-${d.series.outcome.strategyId}-${stint.endLap}`}
              cx={scales.x(stint.endLap)}
              cy={scales.y(d.median[stint.endLap])}
              r={3.2}
              fill="var(--bg)"
              stroke={seriesColor(i)}
              strokeWidth={1.8}
            />
          )),
        )}

        {hoverLap !== null && (
          <line
            x1={scales.x(hoverLap)}
            x2={scales.x(hoverLap)}
            y1={0}
            y2={scales.innerHeight}
            stroke="var(--text-faint)"
            strokeWidth={1}
          />
        )}
      </PlotFrame>

      <div className="legend" style={{ marginTop: 8 }}>
        {deltas.map((d, i) => (
          <div className="item" key={d.series.outcome.strategyId}>
            <span className="swatch" style={{ background: seriesColor(i) }} />
            <span>{d.series.strategy.label}</span>
            {hoverLap !== null && (
              <span className="num faint">{formatDelta(d.median[hoverLap], 1)}s</span>
            )}
          </div>
        ))}
        {hoverLap !== null && <span className="faint num">lap {hoverLap}</span>}
      </div>
    </div>
  );
}
