import * as RadixSlider from '@radix-ui/react-slider';
import { cn } from '@/lib/cn';

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  display,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string;
  display?: string;
  className?: string;
}) {
  return (
    <div className={cn('min-w-0', className)}>
      {label && (
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <span className="eyebrow">{label}</span>
          {display && <span className="num text-[12px] font-semibold text-chalk-200">{display}</span>}
        </div>
      )}
      <RadixSlider.Root
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        className="relative flex h-5 w-full touch-none select-none items-center"
      >
        <RadixSlider.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-ink-750">
          <RadixSlider.Range className="absolute h-full bg-mint-500" />
        </RadixSlider.Track>
        <RadixSlider.Thumb
          aria-label={label}
          className="block size-4 rounded-full border-2 border-mint-500 bg-ink-950 outline-none transition-transform hover:scale-110 focus-visible:ring-2 focus-visible:ring-mint-500/40"
        />
      </RadixSlider.Root>
    </div>
  );
}
