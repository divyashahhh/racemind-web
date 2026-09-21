import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { PredictPage } from '@/pages/PredictPage';
import { CalendarPage } from '@/pages/CalendarPage';
import { ModelPage } from '@/pages/ModelPage';
import { SEASON, nextRound } from '@/models/context';
import { cn } from '@/lib/cn';

const TABS = [
  { id: 'predict', label: 'Predict' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'model', label: 'Model' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function initialTab(): TabId {
  const hash = window.location.hash.replace('#', '');
  return TABS.some((t) => t.id === hash) ? (hash as TabId) : 'predict';
}

export default function App() {
  const [tab, setTab] = useState<TabId>(initialTab);
  // A round chosen on the Calendar tab should carry over to Predict.
  const [round, setRound] = useState(() => nextRound().round);

  useEffect(() => {
    const onHash = () => setTab(initialTab());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (id: TabId) => {
    setTab(id);
    window.location.hash = id;
  };

  return (
    <div className="min-h-dvh bg-ink-950">
      <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-3 px-5">
          <button onClick={() => go('predict')} className="flex items-center gap-2.5">
            <span className="h-5 w-[3px] rounded-full bg-race-500" />
            <span className="text-[15px] font-bold tracking-tight">RaceMind</span>
          </button>
          <span className="hidden items-center gap-1.5 rounded-full border border-ink-700 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-chalk-500 sm:inline-flex">
            <Radio className="size-3 text-mint-500" />
            {SEASON} season
          </span>

          <nav className="ml-auto flex items-center gap-1 rounded-full border border-ink-800 bg-ink-900 p-1">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => go(t.id)}
                aria-current={t.id === tab ? 'page' : undefined}
                className={cn(
                  'rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition-colors',
                  t.id === tab ? 'bg-ink-750 text-chalk-50' : 'text-chalk-500 hover:text-chalk-200',
                )}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-6">
        {tab === 'predict' && <PredictPage round={round} onRoundChange={setRound} />}
        {tab === 'calendar' && (
          <CalendarPage
            selected={round}
            onPick={(r) => {
              setRound(r);
              go('predict');
            }}
          />
        )}
        {tab === 'model' && <ModelPage />}
      </main>

      <footer className="border-t border-ink-800 px-5 py-6">
        <div className="mx-auto max-w-[1440px] text-[11.5px] leading-relaxed text-chalk-500">
          Predictions come from a Monte Carlo race simulation on a tyre model fitted to
          real race data. This is a fan tool, not a betting product, and not affiliated
          with Formula 1. See the{' '}
          <button onClick={() => go('model')} className="text-mint-500 underline-offset-2 hover:underline">
            Model
          </button>{' '}
          tab for the maths and its limits.
        </div>
      </footer>
    </div>
  );
}
