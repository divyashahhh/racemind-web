import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
  swatch?: string;
  disabled?: boolean;
}

export function Select({
  value,
  onChange,
  options,
  label,
  placeholder = 'Select…',
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  label?: string;
  placeholder?: string;
  className?: string;
}) {
  const active = options.find((o) => o.value === value);
  return (
    <div className={cn('min-w-0', className)}>
      {label && <div className="eyebrow mb-1.5">{label}</div>}
      <RadixSelect.Root value={value} onValueChange={onChange}>
        <RadixSelect.Trigger
          className={cn(
            'flex w-full items-center gap-2.5 rounded-xl border border-ink-700 bg-ink-850 px-3.5 py-2.5',
            'text-left text-[13px] font-medium text-chalk-50 outline-none transition-colors',
            'hover:border-ink-600 focus-visible:border-mint-500/60 data-[state=open]:border-mint-500/60',
          )}
        >
          {active?.swatch && (
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: active.swatch }} />
          )}
          <RadixSelect.Value placeholder={placeholder} className="truncate" />
          <ChevronDown className="ml-auto size-4 shrink-0 text-chalk-500" />
        </RadixSelect.Trigger>

        <RadixSelect.Portal>
          <RadixSelect.Content
            position="popper"
            sideOffset={6}
            className="z-50 max-h-[min(24rem,60vh)] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-ink-700 bg-ink-850 shadow-2xl shadow-black/60"
          >
            <RadixSelect.Viewport className="p-1.5">
              {options.map((o) => (
                <RadixSelect.Item
                  key={o.value}
                  value={o.value}
                  disabled={o.disabled}
                  className={cn(
                    'flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] outline-none',
                    'text-chalk-200 data-[highlighted]:bg-ink-750 data-[highlighted]:text-chalk-50',
                    'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40',
                  )}
                >
                  {o.swatch && (
                    <span className="size-2.5 shrink-0 rounded-full" style={{ background: o.swatch }} />
                  )}
                  <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                  {o.hint && <span className="ml-auto text-[11px] text-chalk-500">{o.hint}</span>}
                  <RadixSelect.ItemIndicator className={cn(o.hint && 'ml-1')}>
                    <Check className="size-3.5 text-mint-400" />
                  </RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  );
}
