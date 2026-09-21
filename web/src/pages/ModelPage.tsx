import { useMemo, useState } from 'react';
import { CIRCUITS, MODEL_META, modelConfidence } from '@/models/catalog';
import { CALENDAR } from '@/models/context';
import { DegradationCurves } from '@/charts/DegradationCurves';
import { PitWindowHeatmap } from '@/charts/PitWindowHeatmap';
import { DRY_COMPOUNDS } from '@/sim/types';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Stat } from '@/components/ui/stat';
import { Select } from '@/components/ui/select';
import { TYRE } from '@/ui/tyres';
import backtest from '@/models/backtest.json';
import { cn } from '@/lib/cn';

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

const SECTIONS = [
  { id: 'how', label: 'How it works' },
  { id: 'curves', label: 'Tyre model' },
  { id: 'windows', label: 'Pit windows' },
  { id: 'backtest', label: 'Accuracy' },
  { id: 'limits', label: 'Limitations' },
] as const;

export function ModelPage() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('how');
  const [circuitKey, setCircuitKey] = useState(CIRCUITS[0]?.key ?? '');
  const circuit = CIRCUITS.find((c) => c.key === circuitKey) ?? CIRCUITS[0];

  const seasons = MODEL_META.seasons;
  const seasonRange = `${seasons[0]}–${seasons[seasons.length - 1]}`;

  if (!circuit) {
    return (
      <Card>
        <CardBody>No fitted models found. Run the ml/ pipeline.</CardBody>
      </Card>
    );
  }

  const conf = modelConfidence(circuit);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Under the hood</h1>
        <p className="mt-1.5 max-w-3xl text-[12.5px] leading-relaxed text-chalk-400">
          Every prediction on this site comes from a Monte Carlo race simulation running on
          a tyre-degradation model fitted to real timing data. This page is the full
          working — the maths, the numbers, and the places it falls down.
        </p>
      </div>

      <Card tone="raised">
        <CardBody className="pt-5">
          <div className="flex flex-wrap gap-x-10 gap-y-5">
            <Stat label="Clean laps fitted" value={MODEL_META.usableLaps.toLocaleString()} size="lg" />
            <Stat label="Races" value={MODEL_META.races} size="lg" />
            <Stat label="Circuits" value={CIRCUITS.length} size="lg" />
            <Stat label="Seasons" value={seasonRange} size="lg" />
            <Stat
              label="2027 rounds covered"
              value={`${CALENDAR.filter((r) => r.hasModel).length}/${CALENDAR.length}`}
              size="lg"
            />
          </div>
        </CardBody>
      </Card>

      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => setSection(s.id)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-[12px] font-semibold transition-colors',
              section === s.id
                ? 'border-mint-500/40 bg-mint-500/10 text-mint-400'
                : 'border-ink-700 text-chalk-500 hover:text-chalk-200',
            )}
          >
            {s.label}
          </button>
        ))}
      </div>

      {section === 'how' && <HowItWorks seasonRange={seasonRange} />}

      {section === 'curves' && (
        <Card>
          <CardHeader
            title="Fitted degradation curves"
            hint="Pace loss against tyre age. Shaded bands are one posterior standard deviation and widen with age, because extrapolation is genuinely less certain."
            action={
              <Select
                value={circuitKey}
                onChange={setCircuitKey}
                options={CIRCUITS.map((c) => ({ value: c.key, label: c.name }))}
                className="w-52"
              />
            }
          />
          <CardBody>
            <DegradationCurves circuit={circuit} />
            {circuit.gammaCalibration && circuit.gammaCalibration.gammaAdded > 0 && (
              <p className="mt-4 rounded-xl border border-ink-800 bg-ink-850 p-3 text-[11.5px] leading-relaxed text-chalk-400">
                γ here is <strong className="text-chalk-200">calibrated, not measured</strong>:{' '}
                {(circuit.gammaCalibration.gammaAdded).toFixed(5)} s/lap² of curvature was added so
                that the {circuit.gammaCalibration.observedModalStops}-stop teams actually ran here
                ({circuit.gammaCalibration.support} dry finishers) comes out optimal.
              </p>
            )}
            <div className="mt-4 rounded-xl border border-ink-800 bg-ink-850 p-4 text-[12px] leading-relaxed text-chalk-400">
              <Badge tone={conf.level === 'high' ? 'mint' : conf.level === 'medium' ? 'warn' : 'race'}>
                {conf.level} confidence
              </Badge>
              <p className="mt-2.5">
                <strong className="text-chalk-200">{circuit.name}</strong> — {conf.note}. Reference
                lap <span className="num">{circuit.baseLapTime.toFixed(2)}s</span>, pit lane loss{' '}
                <span className="num">{circuit.pitLaneLoss.toFixed(1)}s</span>, safety car{' '}
                <span className="num">
                  {Math.round(Math.min(1, circuit.safetyCar.perLapRate * circuit.raceLaps) * 100)}%
                </span>{' '}
                likely per race.
              </p>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-ink-700">
                    {['Compound', 'α offset (s)', 'β linear (s/lap)', 'γ quadratic (s/lap²)', 'Loss at 20 laps', 'Clean laps', 'Longest seen'].map(
                      (h, i) => (
                        <th
                          key={h}
                          className={cn(
                            'whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-chalk-500',
                            i === 0 ? 'text-left' : 'text-right',
                          )}
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {DRY_COMPOUNDS.map((c) => {
                    const curve = circuit.curves[c];
                    if (!curve) return null;
                    const at20 = curve.alpha + curve.beta * 20 + curve.gamma * 400;
                    return (
                      <tr key={c} className="border-b border-ink-850">
                        <td className="px-3 py-2">
                          <span className="flex items-center gap-2">
                            <span className="size-2.5 rounded-full" style={{ background: TYRE[c].hex }} />
                            {TYRE[c].label}
                          </span>
                        </td>
                        <td className="num px-3 py-2 text-right">
                          {curve.alpha >= 0 ? '+' : ''}
                          {curve.alpha.toFixed(3)}
                        </td>
                        <td className="num px-3 py-2 text-right">{curve.beta.toFixed(4)}</td>
                        <td className="num px-3 py-2 text-right">{curve.gamma.toFixed(5)}</td>
                        <td className="num px-3 py-2 text-right">{at20.toFixed(2)}s</td>
                        <td className="num px-3 py-2 text-right">{curve.sampleLaps.toLocaleString()}</td>
                        <td className="num px-3 py-2 text-right">{curve.observedMaxStint}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {section === 'windows' && (
        <Card>
          <CardHeader
            title="Pit window cost surface"
            hint="Expected race time for stopping on each lap, per compound pairing. A wide green band means the call is robust; a narrow one has to be hit precisely."
            action={
              <Select
                value={circuitKey}
                onChange={setCircuitKey}
                options={CIRCUITS.map((c) => ({ value: c.key, label: c.name }))}
                className="w-52"
              />
            }
          />
          <CardBody>
            <PitWindowHeatmap
              circuit={circuit}
              sequences={[
                ['MEDIUM', 'HARD'],
                ['HARD', 'MEDIUM'],
                ['SOFT', 'HARD'],
                ['SOFT', 'MEDIUM'],
                ['MEDIUM', 'SOFT'],
              ]}
            />
          </CardBody>
        </Card>
      )}

      {section === 'backtest' && <Backtest report={report} />}

      {section === 'limits' && <Limitations notes={report.notes} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function HowItWorks({ seasonRange }: { seasonRange: string }) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader title="1 · The lap-time model" />
        <CardBody className="pt-3">
          <pre className="overflow-x-auto rounded-xl border border-ink-800 bg-ink-950 p-4 text-[11.5px] leading-relaxed text-chalk-200">
{`t(lap) = base_pace
       + α_compound + β·age + γ·age²    tyre
       + φ·(race_laps − lap)            fuel burn-off
       + traffic(lap, grid)             dirty air
       + ε                              AR(1) noise`}
          </pre>
          <p className="mt-3 text-[12px] leading-relaxed text-chalk-400">
            Fuel makes the car <em>faster</em> as the race runs, since it is heaviest on lap 1.
            The noise term is autocorrelated rather than independent — consecutive laps share
            traffic, wind and driver rhythm, and treating them as independent makes the
            outcome distribution far too tight.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2 · Fitting" />
        <CardBody className="pt-3 text-[12px] leading-relaxed text-chalk-400">
          <p>
            Fitted on {MODEL_META.usableLaps.toLocaleString()} green-flag laps from{' '}
            {MODEL_META.races} races across {seasonRange}, after dropping in-laps, out-laps,
            safety-car laps and outliers — about 29% of all laps are excluded.
          </p>
          <p className="mt-3">
            A driver-race intercept is removed with a within transformation, so a slow car on
            hards is not mistaken for a degraded tyre. Circuits are partially pooled toward a
            global fit, letting thinly-observed tracks borrow strength.
          </p>
          <p className="mt-3">
            Seasons are <strong className="text-chalk-200">era-weighted</strong>: 2026 laps
            count fully, 2023 laps at 5%. The 2026 regulation change means an older lap says
            much less about 2027, but older seasons still inform the shape of degradation.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="3 · Simulation" />
        <CardBody className="pt-3 text-[12px] leading-relaxed text-chalk-400">
          <p>
            A lap-discretised Monte Carlo, 1,500 runs by default, sampling degradation
            coefficients from their posteriors, AR(1) lap noise, log-normal pit-stop
            durations, per-circuit safety-car hazards and optional rain.
          </p>
          <p className="mt-3">
            Every candidate plan is scored against the{' '}
            <strong className="text-chalk-200">same</strong> sampled race. That pairing is what
            makes the confidence figures usable at only 1,500 runs — comparing independently
            sampled plans would need orders of magnitude more.
          </p>
          <p className="mt-3">
            The confidence percentage is the share of simulated races a plan actually won, not
            a comparison of medians. Two plans half a second apart on median can still be a
            coin toss once safety cars are in play.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="4 · Recovering the tyre cliff" />
        <CardBody className="pt-3 text-[12px] leading-relaxed text-chalk-400">
          <p>
            Race lap times cannot identify the cliff: teams pit <em>before</em> it, so every
            high-age lap in the data belongs to a stint that was going well. Fitted honestly,
            the quadratic term collapses to zero and the model turns linear — and a linear
            model nearly always prefers one stop, because nothing punishes running long.
          </p>
          <p className="mt-3">
            So the cliff is recovered from <strong className="text-chalk-200">revealed
            preference</strong> instead. A pit wall with far better information decided, race
            after race, to stop twice at Sakhir and once at Monza. That choice encodes the
            cliff the lap times censor, so γ is set to the smallest value that makes the
            observed modal stop count optimal. Eleven of 25 circuits needed any adjustment;
            the other fourteen already agreed.
          </p>
          <p className="mt-3 rounded-xl border border-amber-500/25 bg-amber-500/5 p-3 text-amber-200/90">
            Be careful reading the stop-count accuracy below: γ was calibrated against modal
            stop count, so scoring stop counts is partly circular and flatters the model. The
            stint-length error is the cleaner signal, since stint lengths were never targeted.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="5 · Your inputs" />
        <CardBody className="pt-3 text-[12px] leading-relaxed text-chalk-400">
          <ul className="flex flex-col gap-2.5">
            <li>
              <strong className="text-chalk-200">Team</strong> — shifts base pace by that team's
              measured 2026 offset. A slower car pays the same fixed pit loss over a slower lap,
              so stopping costs it proportionally less. Backmarkers really do stop more.
            </li>
            <li>
              <strong className="text-chalk-200">Track temperature</strong> — scales degradation.
              The biggest lever a fan can actually observe before a race.
            </li>
            <li>
              <strong className="text-chalk-200">Grid slot</strong> — adds dirty air to the
              opening stint, decaying as the field strings out. This is what makes a short
              first stint attractive from a poor grid slot.
            </li>
            <li>
              <strong className="text-chalk-200">Rain risk</strong> — samples a wet phase during
              which dry tyres take a heavy per-lap penalty. It widens the spread of outcomes
              but rarely changes which dry plan wins, because intermediates are not fitted and
              never offered. A genuinely wet race is outside this model.
            </li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function Backtest({ report }: { report: BacktestReport }) {
  const scorable = useMemo(() => report.perCircuit.filter((r) => r.stintMae !== null), [report]);
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader
          title="Backtest"
          hint='The model replayed against every race in the dataset and scored on what teams actually did. Without this, "predictor" would be an unfalsifiable claim.'
          action={<span className="num text-[11px] text-chalk-500">{report.races} races</span>}
        />
        <CardBody className="pt-3">
          <div className="flex flex-wrap gap-x-10 gap-y-5">
            <Stat label="Stint length MAE" value={report.stintMae.toFixed(1)} unit="laps" size="lg" />
            <Stat
              label="Stop count exact"
              value={Math.round(report.stopCountAccuracy * 100)}
              unit="%"
              size="lg"
            />
            <Stat label="Median pace MAE" value={report.medianPaceMae.toFixed(2)} unit="s" size="lg" />
          </div>
          <p className="mt-5 max-w-3xl text-[12px] leading-relaxed text-chalk-400">
            These are not good numbers, and they are shown rather than hidden. Note that teams'
            own choices are not optimal either, so a model scoring 100% would itself be a red
            flag — it would mean it had learned to copy rather than to reason.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Reliability"
          hint="When the model says a plan wins X% of the time, how often does it actually win? Points on the diagonal mean the stated confidence is honest."
        />
        <CardBody className="flex flex-wrap items-center gap-8 pt-3">
          <ReliabilityPlot points={report.calibration} />
          <p className="max-w-sm text-[12px] leading-relaxed text-chalk-400">
            Each dot is a confidence bucket; its size is how many predictions landed in it.
            Dots above the line mean the model is under-confident, below means it is
            overclaiming. This is the plot to check before trusting any percentage elsewhere
            on the site.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Per circuit" hint="Circuits where no driver matched the predicted stop count have no comparable stint plan to score" />
        <CardBody className="pt-3">
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-ink-700">
                  {['Circuit', 'Races', 'Stint MAE (laps)', 'Stop count accuracy'].map((h, i) => (
                    <th
                      key={h}
                      className={cn(
                        'whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-chalk-500',
                        i === 0 ? 'text-left' : 'text-right',
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.perCircuit.map((row) => (
                  <tr key={row.circuit} className="border-b border-ink-850">
                    <td className="px-3 py-2">{row.circuit}</td>
                    <td className="num px-3 py-2 text-right">{row.races}</td>
                    <td className="num px-3 py-2 text-right">
                      {row.stintMae === null ? (
                        <span className="text-chalk-600" title="No driver matched the predicted stop count">
                          n/a
                        </span>
                      ) : (
                        row.stintMae.toFixed(1)
                      )}
                    </td>
                    <td className="num px-3 py-2 text-right">
                      {Math.round(row.stopAccuracy * 100)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-chalk-500">
            {scorable.length} of {report.perCircuit.length} circuits produced a scorable stint
            comparison.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

function Limitations({ notes }: { notes: string[] }) {
  const structural = [
    {
      title: 'The tyre cliff is not identifiable from race data',
      body: 'Fitted without constraints, the quadratic term comes out negative for all three compounds — the model would claim tyres stop degrading with age. The cause is survivorship: teams pit before the cliff, so laps observed at high tyre age are exactly the stints that were going well. Constraining γ ≥ 0 collapses it to near zero, so the shipped model is close to linear in tyre age. Identifying a real cliff needs practice long-run data, where teams deliberately run a set to destruction.',
    },
    {
      title: 'The compound ladder is imposed, not discovered',
      body: 'Tyre age and lap number are perfectly collinear within a stint, so degradation and fuel separate only across stints. The unconstrained fit loads its misspecification onto whichever compound runs the longest stints — the hard — which then appears to degrade faster than the soft. Since a softer Pirelli compound is softer precisely because it wears faster, SOFT ≥ MEDIUM ≥ HARD is encoded as a constraint.',
    },
    {
      title: 'No track position',
      body: 'The simulator races a stopwatch, not other cars. Grid slot is modelled as opening-stint dirty air, but there is no overtaking, no defending and no rival reacting to your stop. This is the largest gap, and it is why the optimiser prefers cleaner plans than real pit walls choose.',
    },
    {
      title: '2027 is predicted from 2026 and earlier',
      body: 'The 2026 regulation change means older seasons describe different cars on different tyres. Seasons are era-weighted to compensate, but 2026 provides only 14 races of fully-relevant data, and no 2027 car has turned a wheel. Treat early-season calls as the weakest.',
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {structural.map((item) => (
          <Card key={item.title}>
            <CardBody>
              <h3 className="text-[14px] font-semibold leading-snug tracking-tight text-amber-200">
                {item.title}
              </h3>
              <p className="mt-2.5 text-[12px] leading-relaxed text-chalk-400">{item.body}</p>
            </CardBody>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader title="Backtest caveats" />
        <CardBody className="pt-3">
          <ul className="flex list-disc flex-col gap-2 pl-5 text-[12px] leading-relaxed text-chalk-400">
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function ReliabilityPlot({ points }: { points: BacktestReport['calibration'] }) {
  const size = 230;
  const pad = 30;
  const inner = size - pad * 2;
  const x = (v: number) => pad + v * inner;
  const y = (v: number) => pad + (1 - v) * inner;

  return (
    <svg width={size} height={size} className="shrink-0">
      <rect x={pad} y={pad} width={inner} height={inner} rx={8} className="fill-ink-850 stroke-ink-700" />
      <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} className="stroke-ink-600" strokeDasharray="3 3" />
      {points.map((p) => (
        <circle
          key={p.bucket}
          cx={x(p.predicted)}
          cy={y(p.observed)}
          r={Math.max(3, Math.min(8, Math.sqrt(p.n) / 3))}
          className="fill-mint-500"
          opacity={0.8}
        />
      ))}
      {[0, 0.5, 1].map((t) => (
        <g key={t} className="fill-chalk-500 text-[9px]">
          <text x={x(t)} y={size - 10} textAnchor="middle" className="num">{t}</text>
          <text x={pad - 7} y={y(t)} textAnchor="end" dominantBaseline="middle" className="num">{t}</text>
        </g>
      ))}
    </svg>
  );
}
