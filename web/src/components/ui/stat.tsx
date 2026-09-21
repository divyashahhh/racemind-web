import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * Oversized numeral with a micro-label above it — the core visual unit of the
 * reference dashboards, where the number is the headline and the words are the caption.
 */
export function Stat({
  label,
  value,
  unit,
  sub,
  size = 'md',
  className,
  accent,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
  accent?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="eyebrow">{label}</div>
      <div
        className={cn(
          'num mt-1.5 flex items-baseline gap-1 font-semibold leading-none tracking-tight',
          size === 'sm' && 'text-lg',
          size === 'md' && 'text-2xl',
          size === 'lg' && 'text-[2.15rem]',
          size === 'xl' && 'text-[3.25rem]',
        )}
        style={accent ? { color: accent } : undefined}
      >
        {value}
        {unit && <span className="text-[0.45em] font-medium text-chalk-400">{unit}</span>}
      </div>
      {sub && <div className="mt-1.5 text-[11.5px] leading-snug text-chalk-500">{sub}</div>}
    </div>
  );
}
