import { CalendarDays, Zap } from 'lucide-react';
import { CALENDAR, SEASON, nextRound } from '@/models/context';
import { CIRCUIT_BY_KEY } from '@/models/catalog';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';

const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function CalendarPage({
  selected,
  onPick,
}: {
  selected: number;
  onPick: (round: number) => void;
}) {
  const upcoming = nextRound().round;
  const modelled = CALENDAR.filter((r) => r.hasModel).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{SEASON} calendar</h1>
          <p className="mt-1.5 text-[12.5px] text-chalk-400">
            {CALENDAR.length} rounds · {CALENDAR.filter((r) => r.sprint).length} sprints ·{' '}
            {modelled} with a fitted tyre model. Pick a race to predict it.
          </p>
        </div>
        <Badge tone="mint">
          <CalendarDays className="size-3" />
          Next up · R{upcoming}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {CALENDAR.map((r) => {
          const date = new Date(r.date);
          const circuit = r.circuitKey ? CIRCUIT_BY_KEY.get(r.circuitKey) : null;
          const isSelected = r.round === selected;
          return (
            <button key={r.round} onClick={() => onPick(r.round)} className="text-left">
              <Card
                className={cn(
                  'h-full transition-colors',
                  isSelected ? 'border-mint-500/60' : 'hover:border-ink-600',
                  !r.hasModel && 'opacity-70',
                )}
              >
                <CardBody className="flex h-full flex-col gap-3 pt-5">
                  <div className="flex items-start justify-between gap-2">
                    <span className="num text-[11px] font-semibold text-chalk-500">
                      R{String(r.round).padStart(2, '0')}
                    </span>
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {r.round === upcoming && <Badge tone="mint">Next</Badge>}
                      {r.sprint && (
                        <Badge tone="race">
                          <Zap className="size-2.5" />
                          Sprint
                        </Badge>
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-[15px] font-semibold leading-tight tracking-tight">
                      {r.shortName}
                    </h3>
                    <p className="mt-1 text-[11.5px] text-chalk-500">{r.location}</p>
                  </div>

                  <div className="mt-auto flex items-end justify-between gap-2 border-t border-ink-800 pt-3">
                    <span className="num text-[11.5px] text-chalk-400">
                      {date.getUTCDate()} {MONTH[date.getUTCMonth()]}
                    </span>
                    {r.hasModel ? (
                      <span className="num text-[11px] text-chalk-500">
                        {circuit?.raceLaps ?? '—'} laps · {r.racesInHistory} on record
                      </span>
                    ) : (
                      <span className="text-[11px] font-medium text-amber-400">no data</span>
                    )}
                  </div>
                </CardBody>
              </Card>
            </button>
          );
        })}
      </div>

      <Card>
        <CardBody>
          <h3 className="text-[13px] font-semibold">Why two rounds have no model</h3>
          <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-chalk-400">
            Portimão and Istanbul Park return to the calendar in {SEASON} but have not
            hosted a Grand Prix since 2021 — before the timing data this model is built
            from begins. Rather than dress up a guess as a prediction, RaceMind declines
            to call those two races. Barcelona and Zandvoort, which do have data, have
            dropped off the calendar.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
