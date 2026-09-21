import { useMemo, useState } from 'react';
import { CIRCUITS, modelConfidence } from '../models/catalog';
import { DRY_COMPOUNDS } from '../sim/types';
import { formatLapTime, formatPercent } from '../lib/format';
import { COMPOUND_COLOR } from '../ui/tokens';

type SortKey = 'name' | 'deg' | 'pit' | 'sc' | 'laps';

/**
 * Circuit comparison. The point is the cross-circuit contrast: Monaco and Monza are
 * different strategic problems, and seeing the degradation and safety-car numbers
 * side by side is what makes that concrete.
 */
export function ExplorePage() {
  const [sort, setSort] = useState<SortKey>('deg');

  const rows = useMemo(() => {
    const built = CIRCUITS.map((c) => {
      const medium = c.curves.MEDIUM;
      const degAt20 = medium ? medium.alpha + medium.beta * 20 + medium.gamma * 400 : 0;
      const scPerRace = Math.min(1, c.safetyCar.perLapRate * c.raceLaps);
      return { circuit: c, degAt20, scPerRace, confidence: modelConfidence(c) };
    });
    const sorters: Record<SortKey, (a: typeof built[0], b: typeof built[0]) => number> = {
      name: (a, b) => a.circuit.name.localeCompare(b.circuit.name),
      deg: (a, b) => b.degAt20 - a.degAt20,
      pit: (a, b) => b.circuit.pitLaneLoss - a.circuit.pitLaneLoss,
      sc: (a, b) => b.scPerRace - a.scPerRace,
      laps: (a, b) => b.circuit.raceLaps - a.circuit.raceLaps,
    };
    return [...built].sort(sorters[sort]);
  }, [sort]);

  const maxDeg = Math.max(...rows.map((r) => r.degAt20), 0.1);

  return (
    <div className="page grid" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Circuits</div>
            <div className="card-sub">
              Every circuit the model has been fitted for, ranked by how punishing it is
              on tyres. High degradation plus a cheap pit lane means more stops.
            </div>
          </div>
          <div className="chips">
            {(['deg', 'pit', 'sc', 'laps', 'name'] as SortKey[]).map((k) => (
              <button key={k} className="chip" aria-pressed={sort === k} onClick={() => setSort(k)}>
                {k === 'deg' ? 'degradation' : k === 'pit' ? 'pit loss' : k === 'sc' ? 'safety car' : k === 'laps' ? 'laps' : 'name'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Circuit</th>
                <th className="right">Laps</th>
                <th className="right">Ref lap</th>
                <th className="right">Pit loss</th>
                <th>Medium loss at 20 laps</th>
                <th className="right">SC per race</th>
                <th className="right">Races fitted</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ circuit, degAt20, scPerRace, confidence }) => (
                <tr key={circuit.key}>
                  <td style={{ fontWeight: 600 }}>{circuit.name}</td>
                  <td className="right num">{circuit.raceLaps}</td>
                  <td className="right num">{formatLapTime(circuit.baseLapTime)}</td>
                  <td className="right num">{circuit.pitLaneLoss.toFixed(1)}s</td>
                  <td style={{ minWidth: 150 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: 3,
                          background: 'var(--surface-3)',
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{
                            width: `${(degAt20 / maxDeg) * 100}%`,
                            height: '100%',
                            background: COMPOUND_COLOR.MEDIUM,
                          }}
                        />
                      </div>
                      <span className="num small" style={{ width: 40, textAlign: 'right' }}>
                        {degAt20.toFixed(2)}s
                      </span>
                    </div>
                  </td>
                  <td className="right num">{formatPercent(scPerRace)}</td>
                  <td className="right num">{circuit.racesObserved}</td>
                  <td>
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
                      {confidence.level}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div className="card-title">Compound offsets</div>
          <div className="card-sub">Pace difference between compounds on a fresh tyre, per circuit</div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th>Circuit</th>
                {DRY_COMPOUNDS.map((c) => (
                  <th key={c} className="right">
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: 2,
                        background: COMPOUND_COLOR[c],
                        marginRight: 5,
                      }}
                    />
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ circuit }) => (
                <tr key={circuit.key}>
                  <td>{circuit.name}</td>
                  {DRY_COMPOUNDS.map((c) => {
                    const curve = circuit.curves[c];
                    return (
                      <td key={c} className="right num">
                        {curve ? `${curve.alpha >= 0 ? '+' : ''}${curve.alpha.toFixed(2)}` : '—'}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="banner small" style={{ marginTop: 12 }}>
          Offsets are relative to MEDIUM, which is fixed at zero by construction. A large
          negative SOFT offset means a big one-lap advantage, which is what makes an
          aggressive short first stint viable.
        </div>
      </div>
    </div>
  );
}
