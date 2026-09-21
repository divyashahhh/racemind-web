import { useEffect, useState, type ReactNode, type RefObject } from 'react';
import { niceTicks, scale } from '../lib/format';

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const DEFAULT_MARGIN: Margin = { top: 12, right: 16, bottom: 30, left: 52 };

export interface Scales {
  x: (v: number) => number;
  y: (v: number) => number;
  xInvert: (px: number) => number;
  innerWidth: number;
  innerHeight: number;
  margin: Margin;
}

export function makeScales(
  width: number,
  height: number,
  xDomain: [number, number],
  yDomain: [number, number],
  margin: Margin = DEFAULT_MARGIN,
): Scales {
  const innerWidth = Math.max(1, width - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top - margin.bottom);
  return {
    x: (v) => scale(v, xDomain[0], xDomain[1], 0, innerWidth),
    // SVG y grows downward, so the range is inverted.
    y: (v) => scale(v, yDomain[0], yDomain[1], innerHeight, 0),
    xInvert: (px) => scale(px, 0, innerWidth, xDomain[0], xDomain[1]),
    innerWidth,
    innerHeight,
    margin,
  };
}

/** Axes, gridlines and a clipping region. Children are drawn in plot coordinates. */
export function PlotFrame({
  width,
  height,
  scales,
  xDomain,
  yDomain,
  xLabel,
  yLabel,
  yFormat = (v) => v.toFixed(0),
  xTickCount = 8,
  yTickCount = 5,
  clipId,
  children,
  onPointerMove,
  onPointerLeave,
}: {
  width: number;
  height: number;
  scales: Scales;
  xDomain: [number, number];
  yDomain: [number, number];
  xLabel?: string;
  yLabel?: string;
  yFormat?: (v: number) => string;
  xTickCount?: number;
  yTickCount?: number;
  clipId: string;
  children: ReactNode;
  onPointerMove?: (e: React.PointerEvent<SVGRectElement>) => void;
  onPointerLeave?: () => void;
}) {
  const { margin, innerWidth, innerHeight } = scales;
  const xTicks = niceTicks(xDomain[0], xDomain[1], xTickCount);
  const yTicks = niceTicks(yDomain[0], yDomain[1], yTickCount);

  return (
    <svg width={width} height={height} style={{ display: 'block', touchAction: 'none' }}>
      <defs>
        <clipPath id={clipId}>
          <rect x={0} y={0} width={innerWidth} height={innerHeight} />
        </clipPath>
      </defs>
      <g transform={`translate(${margin.left},${margin.top})`}>
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line
              x1={0}
              x2={innerWidth}
              y1={scales.y(t)}
              y2={scales.y(t)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text
              x={-8}
              y={scales.y(t)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize={10}
              fill="var(--text-faint)"
              className="num"
            >
              {yFormat(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t) => (
          <g key={`x${t}`}>
            <line
              x1={scales.x(t)}
              x2={scales.x(t)}
              y1={0}
              y2={innerHeight}
              stroke="var(--surface-2)"
              strokeWidth={1}
            />
            <text
              x={scales.x(t)}
              y={innerHeight + 15}
              textAnchor="middle"
              fontSize={10}
              fill="var(--text-faint)"
              className="num"
            >
              {t}
            </text>
          </g>
        ))}

        <g clipPath={`url(#${clipId})`}>{children}</g>

        <line x1={0} x2={innerWidth} y1={innerHeight} y2={innerHeight} stroke="var(--border-strong)" />
        <line x1={0} x2={0} y1={0} y2={innerHeight} stroke="var(--border-strong)" />

        {xLabel && (
          <text
            x={innerWidth / 2}
            y={innerHeight + 28}
            textAnchor="middle"
            fontSize={10}
            fill="var(--text-faint)"
          >
            {xLabel}
          </text>
        )}
        {yLabel && (
          <text
            transform={`translate(${-margin.left + 11},${innerHeight / 2}) rotate(-90)`}
            textAnchor="middle"
            fontSize={10}
            fill="var(--text-faint)"
          >
            {yLabel}
          </text>
        )}

        {onPointerMove && (
          <rect
            x={0}
            y={0}
            width={innerWidth}
            height={innerHeight}
            fill="transparent"
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
          />
        )}
      </g>
    </svg>
  );
}

/** Build an SVG path string from points already in pixel space. */
export function linePath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');
}

/** Closed band between an upper and lower series, for uncertainty fans. */
export function areaPath(
  upper: { x: number; y: number }[],
  lower: { x: number; y: number }[],
): string {
  if (upper.length === 0) return '';
  const up = upper.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  const down = [...lower].reverse().map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`);
  return `${up.join(' ')} ${down.join(' ')} Z`;
}

/** Measure a container so charts can be responsive without a resize library. */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>, fallback = 640): number {
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
