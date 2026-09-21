import type { ReactNode } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * The bento card the whole layout is built from: near-black ground, hairline border,
 * generous rounding, optional corner affordance.
 */
export function Card({
  className,
  children,
  tone = 'default',
}: {
  className?: string;
  children: ReactNode;
  tone?: 'default' | 'accent' | 'raised';
}) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-card border transition-colors',
        tone === 'default' && 'border-ink-700/70 bg-ink-900',
        tone === 'raised' && 'border-ink-700 bg-ink-850',
        tone === 'accent' && 'border-mint-500/30 bg-mint-950',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  hint,
  action,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex items-start justify-between gap-4 px-5 pt-5', className)}>
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold tracking-tight text-chalk-50">{title}</h3>
        {hint && <p className="mt-1 text-[11.5px] leading-relaxed text-chalk-500">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('px-5 pb-5 pt-4', className)}>{children}</div>;
}

/** The ↗ badge from the reference dashboards. Decorative unless given an onClick. */
export function CornerAction({ onClick, label }: { onClick?: () => void; label?: string }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      onClick={onClick}
      aria-label={label}
      className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full border border-ink-700 bg-ink-850 text-chalk-400',
        onClick && 'transition-colors hover:border-mint-500/50 hover:text-mint-400',
      )}
    >
      <ArrowUpRight className="size-3.5" />
    </Tag>
  );
}

/** Decorative three-bar motif used as a section marker in the references. */
export function Stripes({ className }: { className?: string }) {
  return (
    <div className={cn('flex gap-[3px]', className)} aria-hidden>
      <span className="h-3 w-[2px] rounded-full bg-current opacity-90" />
      <span className="h-3 w-[2px] rounded-full bg-current opacity-60" />
      <span className="h-3 w-[2px] rounded-full bg-current opacity-30" />
    </div>
  );
}
