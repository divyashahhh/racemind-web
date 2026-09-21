import { useCallback, useRef, useState } from 'react';
import { COMPOUND_COLOR, COMPOUND_SHORT, COMPOUND_TEXT } from '../ui/tokens';
import { clamp } from '../lib/format';
import type { Strategy } from '../sim/types';

const MIN_STINT = 4;

/**
 * A strategy rendered as a lap-proportional bar, with draggable pit stops.
 *
 * Dragging is the point. A static plan tells you what the optimiser chose; dragging
 * the stop and watching the projected time move tells you *how much the choice
 * matters*, which is the question a strategist is actually asking. A wide flat
 * response means the call is safe; a sharp one means it is knife-edge.
 */
export function StintBar({
  strategy,
  raceLaps,
  editable = false,
  onChange,
  height = 34,
  highlightLap,
}: {
  strategy: Strategy;
  raceLaps: number;
  editable?: boolean;
  onChange?: (pitLaps: number[]) => void;
  height?: number;
  highlightLap?: number | null;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<number | null>(null);

  const pitLaps = strategy.stints.slice(0, -1).map((s) => s.endLap);

  const lapFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return 1;
      const rect = el.getBoundingClientRect();
      const fraction = (clientX - rect.left) / rect.width;
      return Math.round(clamp(fraction * raceLaps, 1, raceLaps));
    },
    [raceLaps],
  );

  const handleMove = useCallback(
    (index: number, clientX: number) => {
      if (!onChange) return;
      const next = [...pitLaps];
      // Each stop is bounded by its neighbours so a drag can never produce a
      // zero-length or negative-length stint.
      const lower = (index === 0 ? 0 : next[index - 1]) + MIN_STINT;
      const upper = (index === next.length - 1 ? raceLaps : next[index + 1]) - MIN_STINT;
      if (upper < lower) return;
      next[index] = clamp(lapFromClientX(clientX), lower, upper);
      onChange(next);
    },
    [pitLaps, onChange, raceLaps, lapFromClientX],
  );

  return (
    <div
      ref={trackRef}
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        height,
        borderRadius: 6,
        overflow: 'hidden',
        background: 'var(--surface-2)',
        userSelect: 'none',
      }}
    >
      {strategy.stints.map((stint, i) => {
        const laps = stint.endLap - stint.startLap + 1;
        return (
          <div
            key={`${i}-${stint.compound}`}
            style={{
              flex: laps,
              background: COMPOUND_COLOR[stint.compound],
              color: COMPOUND_TEXT[stint.compound],
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              fontSize: 11,
              fontWeight: 700,
              borderRight: i < strategy.stints.length - 1 ? '2px solid var(--bg)' : undefined,
              minWidth: 0,
            }}
            title={`${stint.compound} — laps ${stint.startLap}–${stint.endLap} (${laps})`}
          >
            <span>{COMPOUND_SHORT[stint.compound]}</span>
            {laps >= 6 && <span className="num" style={{ fontWeight: 600, opacity: 0.75 }}>{laps}</span>}
          </div>
        );
      })}

      {highlightLap != null && (
        <div
          style={{
            position: 'absolute',
            left: `${(highlightLap / raceLaps) * 100}%`,
            top: 0,
            bottom: 0,
            width: 2,
            background: 'var(--text)',
            opacity: 0.6,
            pointerEvents: 'none',
          }}
        />
      )}

      {editable &&
        pitLaps.map((lap, i) => (
          <div
            key={`handle-${i}`}
            role="slider"
            tabIndex={0}
            aria-label={`Pit stop ${i + 1} lap`}
            aria-valuenow={lap}
            aria-valuemin={1}
            aria-valuemax={raceLaps}
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              setDragging(i);
            }}
            onPointerMove={(e) => {
              if (dragging === i) handleMove(i, e.clientX);
            }}
            onPointerUp={(e) => {
              (e.target as HTMLElement).releasePointerCapture(e.pointerId);
              setDragging(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
              e.preventDefault();
              const next = [...pitLaps];
              const lower = (i === 0 ? 0 : next[i - 1]) + MIN_STINT;
              const upper = (i === next.length - 1 ? raceLaps : next[i + 1]) - MIN_STINT;
              next[i] = clamp(lap + (e.key === 'ArrowRight' ? 1 : -1), lower, upper);
              onChange?.(next);
            }}
            style={{
              position: 'absolute',
              left: `${(lap / raceLaps) * 100}%`,
              top: -3,
              bottom: -3,
              width: 14,
              marginLeft: -7,
              cursor: 'ew-resize',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              touchAction: 'none',
            }}
          >
            <div
              style={{
                width: 4,
                height: '100%',
                borderRadius: 2,
                background: dragging === i ? 'var(--accent)' : 'var(--text)',
                boxShadow: '0 0 0 1px var(--bg)',
              }}
            />
          </div>
        ))}
    </div>
  );
}

/** Lap-number ruler that lines up under a StintBar. */
export function LapRuler({ raceLaps, step = 10 }: { raceLaps: number; step?: number }) {
  const marks: number[] = [];
  for (let lap = 0; lap <= raceLaps; lap += step) marks.push(lap);
  if (marks[marks.length - 1] !== raceLaps) marks.push(raceLaps);
  return (
    <div style={{ position: 'relative', height: 14, marginTop: 3 }}>
      {marks.map((lap) => (
        <span
          key={lap}
          className="num"
          style={{
            position: 'absolute',
            left: `${(lap / raceLaps) * 100}%`,
            transform: lap === 0 ? 'none' : lap === raceLaps ? 'translateX(-100%)' : 'translateX(-50%)',
            fontSize: 9.5,
            color: 'var(--text-faint)',
          }}
        >
          {lap}
        </span>
      ))}
    </div>
  );
}
