import { useMemo, useState } from 'react';
import { CIRCUITS, MODEL_META, modelConfidence } from '../models/catalog';
import { DEFAULT_SETTINGS, type Compound, type SimulationSettings, type Strategy } from '../sim/types';
import { isLegal, withCompound, withPitLaps } from '../sim/optimize';
import { winProbability } from '../sim/simulate';
import { usePlanner } from '../sim/useSimulation';
import { undercutCurve, undercutWindowEnd } from '../sim/undercut';
import { LapRuler, StintBar } from '../charts/StintBar';
import { RaceTrace } from '../charts/RaceTrace';
import { OutcomeDistribution } from '../charts/OutcomeDistribution';
import { PitWindowHeatmap } from '../charts/PitWindowHeatmap';
import { formatDelta, formatPercent, formatRaceTime } from '../lib/format';
import { COMPOUND_COLOR, seriesColor } from '../ui/tokens';

const DRY: Compound[] = ['SOFT', 'MEDIUM', 'HARD'];

export function StrategyPage() {
  const [circuitKey, setCircuitKey] = useState(CIRCUITS[0]?.key ?? '');
  const circuit = CIRCUITS.find((c) => c.key === circuitKey) ?? CIRCUITS[0] ?? null;

  const [settings, setSettings] = useState<SimulationSettings>(DEFAULT_SETTINGS);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // The worker owns both the plan search and the simulation, so neither blocks paint
  // while the user is dragging a pit stop.
  const sim = usePlanner(circuit, settings);
  const { strategies, setStrategies } = sim;
  // The shortlist is replaced wholesale when the circuit changes, so clamp rather than
  // resetting in an effect.
  const selected = Math.min(selectedIndex, Math.max(0, strategies.length - 1));

  const ranked = useMemo(() => {
    if (!sim.outcomes) return [];
    return strategies
      .map((strategy, i) => ({ strategy, outcome: sim.outcomes![i], index: i }))
      .sort((a, b) => a.outcome.p50 - b.outcome.p50);
  }, [strategies, sim.outcomes]);

  const best = ranked[0];
  const selectedEntry =
    sim.outcomes && strategies[selected] && sim.outcomes[selected]
      ? { strategy: strategies[selected], outcome: sim.outcomes[selected] }
      : null;

  const undercut = useMemo(() => {
    if (!circuit) return null;
    const curve = undercutCurve(circuit, 'MEDIUM', 'MEDIUM', 1);
    return { curve, windowEnd: undercutWindowEnd(curve) };
  }, [circuit]);

  if (!circuit) {
    return <div className="page"><div className="banner bad">No fitted circuit models found. Run the ml/ pipeline first.</div></div>;
  }

  const confidence = modelConfidence(circuit);
  const pitLaps = strategies[selected]?.stints.slice(0, -1).map((s) => s.endLap) ?? [];

  const updateSelected = (next: Strategy) => {
    setStrategies((prev) => prev.map((s, i) => (i === selected ? next : s)));
  };

  return (
    <div className="page grid" style={{ gap: 14 }}>
      {/* ---------- Controls ---------- */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Race setup</div>
            <div className="card-sub">
              Model v{MODEL_META.version} · fitted on {MODEL_META.usableLaps.toLocaleString()} clean
              laps from {MODEL_META.races} races ({MODEL_META.seasons.join(', ')})
            </div>
          </div>
          <span
            className="pill"
            style={{
              color:
                confidence.level === 'high'
                  ? 'var(--good)'
                  : confidence.level === 'medium'
                    ? 'var(--warn)'
                    : 'var(--bad)',
            }}
          >
            {confidence.level} confidence
          </span>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'flex-end' }}>
          <div className="field" style={{ minWidth: 190 }}>
            <label htmlFor="circuit">Circuit</label>
            <select id="circuit" value={circuitKey} onChange={(e) => setCircuitKey(e.target.value)}>
              {CIRCUITS.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name} ({c.raceLaps} laps)
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ minWidth: 150 }}>
            <label htmlFor="iterations">Simulations</label>
            <select
              id="iterations"
              value={settings.iterations}
              onChange={(e) => setSettings((s) => ({ ...s, iterations: Number(e.target.value) }))}
            >
              <option value={500}>500 — fast</option>
              <option value={1500}>1,500 — balanced</option>
              <option value={4000}>4,000 — precise</option>
            </select>
          </div>

          <div className="field" style={{ minWidth: 170 }}>
            <label htmlFor="rain">Rain probability — {formatPercent(settings.rainProbability)}</label>
            <input
              id="rain"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.rainProbability}
              onChange={(e) => setSettings((s) => ({ ...s, rainProbability: Number(e.target.value) }))}
            />
          </div>

          <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={settings.enableSafetyCar}
              onChange={(e) => setSettings((s) => ({ ...s, enableSafetyCar: e.target.checked }))}
            />
            Safety cars
          </label>

          <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 12.5 }}>
            <input
              type="checkbox"
              checked={settings.enableParameterUncertainty}
              onChange={(e) =>
                setSettings((s) => ({ ...s, enableParameterUncertainty: e.target.checked }))
              }
            />
            Model uncertainty
          </label>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
            {(sim.running || sim.planning) && <span className="spinner" />}
            <span className="small faint num">
              {sim.planning
                ? 'searching strategies…'
                : sim.running
                  ? 'simulating…'
                  : sim.elapsedMs != null
                    ? `${settings.iterations.toLocaleString()} sims in ${sim.elapsedMs.toFixed(0)} ms`
                    : ''}
            </span>
          </div>
        </div>

        <div className="banner small" style={{ marginTop: 12 }}>
          {confidence.note}. Degradation is pooled across circuits where local data is
          thin, so a low-confidence circuit still simulates — it just leans on the prior.
        </div>
      </div>

      {/* ---------- Strategy board ---------- */}
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Strategy board</div>
            <div className="card-sub">
              Drag a pit stop to move it. Everything re-simulates as you drag.
            </div>
          </div>
          {best && (
            <span className="small faint num">
              best median {formatRaceTime(best.outcome.p50)}
            </span>
          )}
        </div>

        <div className="grid" style={{ gap: 10 }}>
          {strategies.map((strategy, i) => {
            const outcome = sim.outcomes?.[i];
            const isSelected = i === selected;
            const vsBest =
              outcome && best ? outcome.p50 - best.outcome.p50 : null;
            const winVsBest =
              outcome && best && best.index !== i
                ? winProbability(outcome.rawTotals, best.outcome.rawTotals)
                : null;

            return (
              <div
                key={strategy.id}
                onClick={() => setSelectedIndex(i)}
                style={{
                  padding: 11,
                  borderRadius: 8,
                  border: `1px solid ${isSelected ? seriesColor(i) : 'var(--border)'}`,
                  background: isSelected ? 'var(--surface-2)' : 'transparent',
                  cursor: 'pointer',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 7,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="swatch" style={{ width: 9, height: 9, borderRadius: 2, background: seriesColor(i), display: 'inline-block' }} />
                    <strong style={{ fontSize: 13 }}>{strategy.label}</strong>
                    <span className="faint num small">
                      stops lap {strategy.stints.slice(0, -1).map((s) => s.endLap).join(', ') || '—'}
                    </span>
                    {!isLegal(strategy) && (
                      <span className="pill" style={{ color: 'var(--bad)' }}>illegal — one compound</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 16, alignItems: 'baseline' }}>
                    {outcome && (
                      <>
                        <span className="num" style={{ fontSize: 13, fontWeight: 600 }}>
                          {formatRaceTime(outcome.p50)}
                        </span>
                        <span
                          className="num small"
                          style={{ color: vsBest && vsBest > 0.05 ? 'var(--text-dim)' : 'var(--good)', minWidth: 54, textAlign: 'right' }}
                        >
                          {vsBest == null ? '' : vsBest < 0.05 ? 'fastest' : `${formatDelta(vsBest, 1)}s`}
                        </span>
                        <span className="num small faint" style={{ minWidth: 68, textAlign: 'right' }}>
                          {winVsBest == null ? '—' : `${formatPercent(winVsBest)} win`}
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <StintBar
                  strategy={strategy}
                  raceLaps={circuit.raceLaps}
                  editable={isSelected}
                  onChange={(laps) => updateSelected(withPitLaps(strategy, laps, circuit.raceLaps))}
                />
                {isSelected && <LapRuler raceLaps={circuit.raceLaps} />}
              </div>
            );
          })}
        </div>

        {/* Compound editor for the selected plan */}
        {strategies[selected] && (
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
            <span className="small faint">Compounds:</span>
            {strategies[selected].stints.map((stint, idx) => (
              <div key={idx} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <span className="small faint num">S{idx + 1}</span>
                {DRY.map((c) => (
                  <button
                    key={c}
                    className="chip"
                    aria-pressed={stint.compound === c}
                    onClick={() => updateSelected(withCompound(strategies[selected], idx, c))}
                    style={
                      stint.compound === c
                        ? { background: COMPOUND_COLOR[c], borderColor: COMPOUND_COLOR[c], color: c === 'SOFT' ? '#fff' : '#1a1a1a' }
                        : undefined
                    }
                  >
                    {c[0]}
                  </button>
                ))}
              </div>
            ))}
            <span className="small faint num" style={{ marginLeft: 'auto' }}>
              pit laps {pitLaps.join(', ') || 'none'}
            </span>
          </div>
        )}
      </div>

      {/* ---------- Outcome ---------- */}
      {selectedEntry && sim.outcomes && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Outcome — {selectedEntry.strategy.label}</div>
              <div className="card-sub">
                Distribution over {settings.iterations.toLocaleString()} simulated races
              </div>
            </div>
          </div>
          <div className="stat-row" style={{ marginBottom: 16 }}>
            <div className="stat">
              <span className="k">Median finish</span>
              <span className="v num">{formatRaceTime(selectedEntry.outcome.p50)}</span>
            </div>
            <div className="stat">
              <span className="k">P10 — P90 spread</span>
              <span className="v num">
                {(selectedEntry.outcome.p90 - selectedEntry.outcome.p10).toFixed(1)}s
              </span>
            </div>
            <div className="stat">
              <span className="k">Best case (P10)</span>
              <span className="v num">{formatRaceTime(selectedEntry.outcome.p10)}</span>
            </div>
            <div className="stat">
              <span className="k">Worst case (P90)</span>
              <span className="v num">{formatRaceTime(selectedEntry.outcome.p90)}</span>
            </div>
            {best && best.index !== selected && (
              <div className="stat">
                <span className="k">Beats the top plan</span>
                <span className="v num">
                  {formatPercent(
                    winProbability(selectedEntry.outcome.rawTotals, best.outcome.rawTotals),
                  )}
                </span>
              </div>
            )}
          </div>
          <OutcomeDistribution
            series={strategies.map((strategy, i) => ({ strategy, outcome: sim.outcomes![i] }))}
          />
        </div>
      )}

      {/* ---------- Race trace ---------- */}
      {sim.outcomes && best && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Race trace</div>
              <div className="card-sub">
                Gap to {best.strategy.label}, by lap. Below the line is ahead. Shaded bands
                are the P10–P90 range; where two lines cross, the lead changes hands.
              </div>
            </div>
          </div>
          <RaceTrace
            series={strategies.map((strategy, i) => ({ strategy, outcome: sim.outcomes![i] }))}
            referenceId={best.outcome.strategyId}
          />
        </div>
      )}

      {/* ---------- Pit window + undercut ---------- */}
      <div className="grid" style={{ gridTemplateColumns: 'minmax(0,1.6fr) minmax(0,1fr)', gap: 14 }}>
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Pit window</div>
              <div className="card-sub">
                Cost of stopping on each lap, per compound pairing. A wide green band is a
                safe call; a narrow one has to be hit precisely.
              </div>
            </div>
          </div>
          <PitWindowHeatmap
            circuit={circuit}
            sequences={[
              ['MEDIUM', 'HARD'],
              ['HARD', 'MEDIUM'],
              ['SOFT', 'HARD'],
              ['SOFT', 'MEDIUM'],
              ['MEDIUM', 'SOFT'],
            ]}
            onPick={(strategy) => {
              setStrategies((prev) => prev.map((s, i) => (i === selected ? strategy : s)));
            }}
          />
        </div>

        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Undercut</div>
              <div className="card-sub">Gain from stopping one lap before a rival</div>
            </div>
          </div>
          {undercut && (
            <>
              <div className="stat-row" style={{ marginBottom: 12 }}>
                <div className="stat">
                  <span className="k">Peak gain</span>
                  <span className="v num">
                    {formatDelta(Math.max(...undercut.curve.map((p) => p.gain)), 2)}s
                  </span>
                </div>
                <div className="stat">
                  <span className="k">Window closes</span>
                  <span className="v num">
                    {undercut.windowEnd ? `lap ${undercut.windowEnd}` : 'stays open'}
                  </span>
                </div>
              </div>
              <div className="small muted" style={{ lineHeight: 1.6 }}>
                On a medium-to-medium stop the undercut{' '}
                {Math.max(...undercut.curve.map((p) => p.gain)) > 0 ? 'works' : 'does not pay'} here.
                The out-lap costs about 1.6s, so the fresh tyre has to be worth more than that
                before track position is worth trading. Low-degradation circuits favour the
                overcut instead — staying out while the rival struggles on cold rubber.
              </div>
            </>
          )}
        </div>
      </div>

      {sim.error && <div className="banner bad">{sim.error}</div>}
    </div>
  );
}
