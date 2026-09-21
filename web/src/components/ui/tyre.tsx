import { tyreOf } from '@/ui/tyres';
import { cn } from '@/lib/cn';

/** A compound as the circular marker fans know from TV graphics. */
export function TyreDot({
  compound,
  size = 'md',
  laps,
  className,
}: {
  compound: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  laps?: number;
  className?: string;
}) {
  const t = tyreOf(compound);
  const px = { xs: 18, sm: 24, md: 32, lg: 44 }[size];
  return (
    <div
      className={cn('relative grid shrink-0 place-items-center rounded-full', className)}
      style={{ width: px, height: px, border: `${Math.max(2, px / 11)}px solid ${t.hex}`, background: 'var(--color-ink-850)' }}
      title={laps ? `${t.label} — ${laps} laps` : t.label}
    >
      <span
        className="num font-bold leading-none"
        style={{ color: t.hex, fontSize: px * 0.42 }}
      >
        {t.letter}
      </span>
    </div>
  );
}

/** A full stint plan as a lap-proportional bar. */
export function StintRibbon({
  stints,
  totalLaps,
  height = 26,
  showLaps = true,
  className,
}: {
  stints: { compound: string; laps: number }[];
  totalLaps: number;
  height?: number;
  showLaps?: boolean;
  className?: string;
}) {
  const covered = stints.reduce((a, s) => a + s.laps, 0);
  return (
    <div
      className={cn('flex w-full overflow-hidden rounded-lg bg-ink-800', className)}
      style={{ height }}
    >
      {stints.map((s, i) => {
        const t = tyreOf(s.compound);
        return (
          <div
            key={i}
            className="flex min-w-0 items-center justify-center gap-1 border-r-2 border-ink-950 last:border-r-0"
            style={{ flex: s.laps, background: t.hex, color: t.onDark ? '#fff' : '#101014' }}
            title={`${t.label} — ${s.laps} laps`}
          >
            <span className="num text-[10.5px] font-bold">{t.letter}</span>
            {showLaps && s.laps / totalLaps > 0.09 && (
              <span className="num text-[10px] font-semibold opacity-70">{s.laps}</span>
            )}
          </div>
        );
      })}
      {/* A retirement leaves the bar short, which is the honest rendering. */}
      {covered < totalLaps && (
        <div
          className="bg-[repeating-linear-gradient(45deg,#24242c_0_4px,#16161b_4px_8px)]"
          style={{ flex: totalLaps - covered }}
          title="Did not finish"
        />
      )}
    </div>
  );
}
