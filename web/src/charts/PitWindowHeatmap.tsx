import { useMemo, useRef, useState } from 'react';
import { useMeasuredWidth } from './primitives';
import { formatDelta } from '../lib/format';
import type { CircuitModel, Compound, Strategy } from '../sim/types';
import { deterministicTime } from '../sim/optimize';
import { TYRE } from '@/ui/tyres';

export interface HeatRow {
  compounds: Compound[];
  label: string;
  cells: { lap: number; time: number }[];
}

/**
 * Expected race time as a function of where the single pit stop falls.
 *
 * The shape is what matters, not the minimum. A wide flat trough means the call is
 * robust and the team can react to a safety car without losing anything; a narrow
 * spike means the window is tight and the stop has to be hit precisely. That
 * distinction is invisible in a single "optimal lap" number.
 */
export function PitWindowHeatmap({
  circuit,
  sequences,
  height = 26,
  onPick,
}: {
  circuit: CircuitModel;
  sequences: Compound[][];
  height?: number;
  onPick?: (strategy: Strategy) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useMeasuredWidth(ref, 820);
  const [hover, setHover] = useState<{ row: number; lap: number; time: number } | null>(null);

  const { rows, min, max } = useMemo(() => {
    const built: HeatRow[] = sequences.map((compounds) => {
      const cells: { lap: number; time: number }[] = [];
      for (let lap = 5; lap <= circuit.raceLaps - 5; lap++) {
        const stints = [
          { compound: compounds[0], startLap: 1, endLap: lap, startAge: 0 },
          { compound: compounds[1], startLap: lap + 1, endLap: circuit.raceLaps, startAge: 0 },
        ];
        cells.push({ lap, time: deterministicTime(circuit, stints) });
      }
      return { compounds, label: compounds.map((c) => TYRE[c].letter).join('–'), cells };
    });
    let lo = Infinity;
    let hi = -Infinity;
    for (const r of built) {
      for (const c of r.cells) {
        if (Number.isFinite(c.time)) {
          if (c.time < lo) lo = c.time;
          if (c.time > hi) hi = c.time;
        }
      }
    }
    // Clip the top of the range: a handful of catastrophic plans would otherwise
    // flatten the colour scale across everything that is actually competitive.
    const all = built.flatMap((r) => r.cells.map((c) => c.time)).filter(Number.isFinite).sort((a, b) => a - b);
    const clipped = all[Math.floor(all.length * 0.85)] ?? hi;
    return { rows: built, min: lo, max: clipped };
  }, [circuit, sequences]);

  if (rows.length === 0) return null;

  const labelWidth = 44;
  const cellWidth = Math.max(1, (width - labelWidth) / (rows[0]?.cells.length || 1));

  const color = (time: number) => {
    if (!Number.isFinite(time)) return 'var(--surface-2)';
    const t = Math.min(1, Math.max(0, (time - min) / Math.max(1e-6, max - min)));
    // Fast (green) -> neutral (amber) -> slow (red). Perceptually ordered, and the
    // best cells read as clearly best at a glance.
    const stops: [number, [number, number, number]][] = [
      [0, [63, 185, 80]],
      [0.5, [245, 197, 24]],
      [1, [232, 53, 46]],
    ];
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) {
        a = stops[i];
        b = stops[i + 1];
        break;
      }
    }
    const f = (t - a[0]) / Math.max(1e-6, b[0] - a[0]);
    const rgb = a[1].map((v, i) => Math.round(v + (b[1][i] - v) * f));
    return `rgb(${rgb.join(',')})`;
  };

  return (
    <div ref={ref} style={{ width: '100%' }}>
      <svg width={width} height={rows.length * (height + 3) + 20} style={{ display: 'block' }}>
        {rows.map((row, r) => (
          <g key={row.label} transform={`translate(0,${r * (height + 3)})`}>
            <text
              x={labelWidth - 8}
              y={height / 2}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10.5}
              fill="var(--text-dim)"
              className="num"
            >
              {row.label}
            </text>
            {row.cells.map((cell, i) => (
              <rect
                key={cell.lap}
                x={labelWidth + i * cellWidth}
                y={0}
                width={Math.ceil(cellWidth)}
                height={height}
                fill={color(cell.time)}
                opacity={hover && hover.row === r && hover.lap === cell.lap ? 1 : 0.88}
                onPointerEnter={() => setHover({ row: r, lap: cell.lap, time: cell.time })}
                onPointerLeave={() => setHover(null)}
                onClick={() =>
                  onPick?.({
                    id: `${row.compounds.join('>')}@${cell.lap}`,
                    label: `1-stop ${row.label}`,
                    stints: [
                      { compound: row.compounds[0], startLap: 1, endLap: cell.lap, startAge: 0 },
                      { compound: row.compounds[1], startLap: cell.lap + 1, endLap: circuit.raceLaps, startAge: 0 },
                    ],
                  })
                }
                style={{ cursor: onPick ? 'pointer' : 'default' }}
              />
            ))}
          </g>
        ))}
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const lap = Math.round(5 + f * (circuit.raceLaps - 10));
          const i = lap - 5;
          return (
            <text
              key={lap}
              x={labelWidth + i * cellWidth}
              y={rows.length * (height + 3) + 12}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-faint)"
              className="num"
            >
              {lap}
            </text>
          );
        })}
      </svg>
      <div className="small faint" style={{ marginTop: 4, minHeight: 16 }}>
        {hover ? (
          <span className="num">
            Stop lap {hover.lap} · {formatDelta(hover.time - min, 1)}s off the best plan shown
          </span>
        ) : (
          'Hover a cell for the cost of stopping on that lap. Click to load it.'
        )}
      </div>
    </div>
  );
}
