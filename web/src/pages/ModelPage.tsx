import { useState } from 'react';
import { CIRCUITS, MODEL_META, modelConfidence } from '../models/catalog';
import { DegradationCurves } from '../charts/DegradationCurves';
import { DRY_COMPOUNDS } from '../sim/types';
import { formatPercent } from '../lib/format';
import { COMPOUND_COLOR } from '../ui/tokens';
import backtest from '../models/backtest.json';

interface BacktestReport {
  generatedAt: string;
  races: number;
  stintMae: number;
  stopCountAccuracy: number;
  medianPaceMae: number;
  calibration: { bucket: number; predicted: number; observed: number; n: number }[];
  perCircuit: { circuit: string; races: number; stintMae: number | null; stopAccuracy: number }[];
  notes: string[];
}

const report = backtest as unknown as BacktestReport;

export function ModelPage() {
  const [circuitKey, setCircuitKey] = useState(CIRCUITS[0]?.key ?? '');
  const circuit = CIRCUITS.find((c) => c.key === circuitKey) ?? CIRCUITS[0];

  if (!circuit) {
    return <div className="page"><div className="banner bad">No fitted models. Run ml/fit.py.</div></div>;
  }

  const confidence = modelConfidence(circuit);

  return (
    <div className="page grid" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Fitted model</div>
            <div className="card-sub">
              Hierarchical quadratic degradation with partial pooling across circuits,
              fitted offline and shipped as static coefficients.
            </div>
          </div>
          <span className="small faint num">
            v{MODEL_META.version} · {new Date(MODEL_META.fittedAt).toLocaleDateString()}
          </span>
        </div>
        <div className="stat-row">
          <div className="stat">
            <span className="k">Clean laps</span>
            <span className="v num">{MODEL_META.usableLaps.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="k">Races</span>
            <span className="v num">{MODEL_META.races}</span>
          </div>
          <div className="stat">
            <span className="k">Circuits</span>
            <span className="v num">{CIRCUITS.length}</span>
          </div>
          <div className="stat">
            <span className="k">Seasons</span>
            <span className="v num">
              {MODEL_META.seasons[0]}–{MODEL_META.seasons[MODEL_META.seasons.length - 1]}
            </span>
          </div>
          <div className="stat">
            <span className="k">Fuel effect</span>
            <span className="v num">{MODEL_META.global.fuelEffect.toFixed(3)} s/lap</span>
          </div>
          <div className="stat">
            <span className="k">Median pit stop</span>
            <span className="v num">{Math.exp(MODEL_META.global.pitStopMu).toFixed(2)}s</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Degradation curves</div>
            <div className="card-sub">
              Pace loss against tyre age. Shaded bands are one posterior standard
              deviation — they widen with age because extrapolation is genuinely less certain.
            </div>
          </div>
          <select value={circuitKey} onChange={(e) => setCircuitKey(e.target.value)}>
            {CIRCUITS.map((c) => (
              <option key={c.key} value={c.key}>{c.name}</option>
            ))}
          </select>
        </div>
        <DegradationCurves circuit={circuit} />

        <div className="banner small" style={{ marginTop: 12 }}>
          <strong>{circuit.name}</strong> — {confidence.note}. Reference lap{' '}
          <span className="num">{circuit.baseLapTime.toFixed(2)}s</span>, pit lane loss{' '}
          <span className="num">{circuit.pitLaneLoss.toFixed(1)}s</span>, safety car{' '}
          <span className="num">{formatPercent(circuit.safetyCar.perLapRate * circuit.raceLaps)}</span>{' '}
          likely per race.
        </div>

        <div style={{ overflowX: 'auto', marginTop: 12 }}>
          <table>
            <thead>
              <tr>
                <th>Compound</th>
                <th className="right">α offset (s)</th>
                <th className="right">β linear (s/lap)</th>
                <th className="right">γ quadratic (s/lap²)</th>
                <th className="right">Loss at 20 laps</th>
                <th className="right">Clean laps</th>
                <th className="right">Longest seen</th>
              </tr>
            </thead>
            <tbody>
              {DRY_COMPOUNDS.map((c) => {
                const curve = circuit.curves[c];
                if (!curve) return null;
                const at20 = curve.alpha + curve.beta * 20 + curve.gamma * 400;
                return (
                  <tr key={c}>
                    <td>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 9,
                          height: 9,
                          borderRadius: 2,
                          background: COMPOUND_COLOR[c],
                          marginRight: 7,
                        }}
                      />
                      {c}
                    </td>
                    <td className="right num">{curve.alpha >= 0 ? '+' : ''}{curve.alpha.toFixed(3)}</td>
                    <td className="right num">{curve.beta.toFixed(4)}</td>
                    <td className="right num">{curve.gamma.toFixed(5)}</td>
                    <td className="right num">{at20.toFixed(2)}s</td>
                    <td className="right num">{curve.sampleLaps.toLocaleString()}</td>
                    <td className="right num">{curve.observedMaxStint}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Backtest</div>
            <div className="card-sub">
              The model replayed against every race in the dataset, scored on what teams
              actually did. Without this, "predictor" would be an unfalsifiable claim.
            </div>
          </div>
          <span className="small faint num">
            {report.races} races · {new Date(report.generatedAt).toLocaleDateString()}
          </span>
        </div>

        <div className="stat-row" style={{ marginBottom: 16 }}>
          <div className="stat">
            <span className="k">Stint length MAE</span>
            <span className="v num">{report.stintMae.toFixed(1)} laps</span>
          </div>
          <div className="stat">
            <span className="k">Stop count exact</span>
            <span className="v num">{formatPercent(report.stopCountAccuracy)}</span>
          </div>
          <div className="stat">
            <span className="k">Median pace MAE</span>
            <span className="v num">{report.medianPaceMae.toFixed(3)}s</span>
          </div>
        </div>

        <div className="card-title" style={{ marginBottom: 8, fontSize: 12 }}>Reliability</div>
        <div className="small faint" style={{ marginBottom: 8 }}>
          When the model says a plan wins X% of the time, how often does it actually win?
          Points on the diagonal mean the probabilities are honest.
        </div>
        <ReliabilityPlot points={report.calibration} />

        <div style={{ overflowX: 'auto', marginTop: 18 }}>
          <table>
            <thead>
              <tr>
                <th>Circuit</th>
                <th className="right">Races</th>
                <th className="right">Stint MAE (laps)</th>
                <th className="right">Stop count accuracy</th>
              </tr>
            </thead>
            <tbody>
              {report.perCircuit.map((row) => (
                <tr key={row.circuit}>
                  <td>{row.circuit}</td>
                  <td className="right num">{row.races}</td>
                  <td className="right num">
                    {row.stintMae === null ? (
                      <span className="faint" title="No driver matched the predicted stop count, so there is no comparable stint plan to score against">
                        n/a
                      </span>
                    ) : (
                      row.stintMae.toFixed(1)
                    )}
                  </td>
                  <td className="right num">{formatPercent(row.stopAccuracy)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {report.notes.length > 0 && (
          <div className="banner small" style={{ marginTop: 14 }}>
            <strong>Known limitations</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.7 }}>
              {report.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function ReliabilityPlot({
  points,
}: {
  points: { bucket: number; predicted: number; observed: number; n: number }[];
}) {
  const size = 220;
  const pad = 28;
  const inner = size - pad * 2;
  const x = (v: number) => pad + v * inner;
  const y = (v: number) => pad + (1 - v) * inner;

  return (
    <svg width={size} height={size} style={{ display: 'block' }}>
      <rect x={pad} y={pad} width={inner} height={inner} fill="var(--surface-2)" stroke="var(--border)" />
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="var(--border-strong)" strokeDasharray="3 3" />
      {points.map((p) => (
        <circle
          key={p.bucket}
          cx={x(p.predicted)}
          cy={y(p.observed)}
          r={Math.max(2.5, Math.min(7, Math.sqrt(p.n) / 3))}
          fill="var(--accent)"
          opacity={0.75}
        />
      ))}
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <text x={x(t)} y={size - 8} textAnchor="middle" fontSize={9} fill="var(--text-faint)" className="num">
            {t}
          </text>
          <text x={pad - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="var(--text-faint)" className="num">
            {t}
          </text>
        </g>
      ))}
      <text x={size / 2} y={14} textAnchor="middle" fontSize={9.5} fill="var(--text-faint)">
        predicted → observed
      </text>
    </svg>
  );
}
