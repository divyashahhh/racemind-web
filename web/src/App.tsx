import { useState } from 'react';
import { StrategyPage } from './pages/StrategyPage';
import { RacePage } from './pages/RacePage';
import { ModelPage } from './pages/ModelPage';
import { ExplorePage } from './pages/ExplorePage';

const TABS = [
  { id: 'strategy', label: 'Strategy', render: () => <StrategyPage /> },
  { id: 'race', label: 'Race', render: () => <RacePage /> },
  { id: 'model', label: 'Model', render: () => <ModelPage /> },
  { id: 'explore', label: 'Explore', render: () => <ExplorePage /> },
] as const;

type TabId = (typeof TABS)[number]['id'];

function initialTab(): TabId {
  const hash = window.location.hash.replace('#', '');
  return TABS.some((t) => t.id === hash) ? (hash as TabId) : 'strategy';
}

export default function App() {
  const [tab, setTab] = useState<TabId>(initialTab);
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="mark" />
          <span>RaceMind</span>
          <span className="sub">strategy simulator</span>
        </div>
        <nav className="tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              className="tab"
              aria-selected={t.id === tab}
              onClick={() => {
                setTab(t.id);
                window.location.hash = t.id;
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main>{active.render()}</main>
    </div>
  );
}
