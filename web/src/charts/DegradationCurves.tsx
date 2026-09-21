import { useMemo, useRef } from 'react';
import { PlotFrame, linePath, makeScales, useMeasuredWidth } from './primitives';
import { COMPOUND_COLOR } from '../ui/tokens';
import { degradationDelta } from '../sim/scenario';
import { DRY_COMPOUNDS, type CircuitModel } from '../sim/types';

/**
 * The fitted degradation curves, with the posterior uncertainty band around each.
 *
 * This chart is the model's receipt. A user can see how steeply each compound falls
 * away, where the cliff bites, and — from the width of the band — how much the fit
 * is actually supported by data at this circuit rather than borrowed from the pooled
 * prior.
 */
export function DegradationCurves({
  circuit,
  maxAge,
  height = 280,
}: {
  circuit: CircuitModel;
  maxAge?: number;
  height?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(ref, 640);

  const ageLimit =
    maxAge ??
    Math.max(
      20,
      ...DRY_COMPOUNDS.map((c) => circuit.curves[c]?.observedMaxStint ?? 0),
    );

  const { series, yDomain } = useMemo(() => {
    const built = DRY_COMPOUNDS.flatMap((compound) => {
      const curve = circuit.curves[compound];
      if (!curve) return [];
      const points: { age: number; mid: number; lo: number; hi: number }[] = [];
      for (let age = 0; age <= ageLimit; age++) {
        const mid = degradationDelta(curve, age);
        // One posterior sd on beta and gamma, which widens with age exactly as the
        // real uncertainty does.
        const spread = curve.betaSd * age + curve.gammaSd * age * age + curve.alphaSd;
        points.push({ age, mid, lo: mid - spread, hi: mid + spread });
      }
      return [{ compound, curve, points }];
    });
    let lo = 0;
    let hi = 0;
    for (const s of built) {
      for (const p of s.points) {
        if (p.lo < lo) lo = p.lo;
        if (p.hi > hi) hi = p.hi;
      }
    }
    return { series: built, yDomain: [lo - 0.2, hi + 0.2] as [number, number] };
  }, [circuit, ageLimit]);

  if (series.length === 0) return <div className="faint small">No fitted curves for this circuit.</div>;

  const xDomain: [number, number] = [0, ageLimit];
  const scales = makeScales(width, height, xDomain, yDomain);

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <PlotFrame
        width={width}
        height={height}
        scales={scales}
        xDomain={xDomain}
        yDomain={yDomain}
        xLabel="Tyre age (laps)"
        yLabel="Pace loss (s/lap)"
        yFormat={(v) => v.toFixed(1)}
        clipId="clip-deg"
      >
        {series.map((s) => (
          <path
            key={`band-${s.compound}`}
            d={`${linePath(s.points.map((p) => ({ x: scales.x(p.age), y: scales.y(p.hi) })))} ${s.points
              .slice()
              .reverse()
              .map((p) => `L${scales.x(p.age).toFixed(2)},${scales.y(p.lo).toFixed(2)}`)
              .join(' ')} Z`}
            fill={COMPOUND_COLOR[s.compound]}
            opacity={0.12}
          />
        ))}
        {series.map((s) => (
          <path
            key={`line-${s.compound}`}
            d={linePath(s.points.map((p) => ({ x: scales.x(p.age), y: scales.y(p.mid) })))}
            fill="none"
            stroke={COMPOUND_COLOR[s.compound]}
            strokeWidth={2}
          />
        ))}
        {/* Where each compound has actually been run to. Beyond this the curve is
            extrapolation, and the app should not pretend otherwise. */}
        {series.map((s) =>
          s.curve.observedMaxStint > 0 && s.curve.observedMaxStint <= ageLimit ? (
            <line
              key={`obs-${s.compound}`}
              x1={scales.x(s.curve.observedMaxStint)}
              x2={scales.x(s.curve.observedMaxStint)}
              y1={0}
              y2={scales.innerHeight}
              stroke={COMPOUND_COLOR[s.compound]}
              strokeWidth={1}
              strokeDasharray="2 4"
              opacity={0.5}
            />
          ) : null,
        )}
      </PlotFrame>
      <div className="legend" style={{ marginTop: 6 }}>
        {series.map((s) => (
          <div className="item" key={s.compound}>
            <span className="swatch" style={{ background: COMPOUND_COLOR[s.compound] }} />
            <span>{s.compound}</span>
            <span className="faint num">
              {s.curve.sampleLaps.toLocaleString()} laps · max {s.curve.observedMaxStint}
            </span>
          </div>
        ))}
        <span className="faint">dashed = longest stint actually observed</span>
      </div>
    </div>
  );
}
