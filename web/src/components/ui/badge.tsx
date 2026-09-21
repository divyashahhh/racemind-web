import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

const TONES = {
  neutral: 'border-ink-700 bg-ink-850 text-chalk-400',
  mint: 'border-mint-500/30 bg-mint-500/10 text-mint-400',
  race: 'border-race-500/30 bg-race-500/10 text-race-500',
  warn: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
} as const;

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode;
  tone?: keyof typeof TONES;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-[3px] text-[10.5px] font-semibold uppercase tracking-[0.08em]',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
