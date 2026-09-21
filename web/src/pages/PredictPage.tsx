import { useMemo, useState } from 'react';
import { AlertTriangle, Flag, Timer, TrendingDown } from 'lucide-react';
import { CALENDAR, TEAMS, ROUND_BY_NUMBER } from '@/models/context';
import { CIRCUIT_BY_KEY, modelConfidence } from '@/models/catalog';
import { usePlanner } from '@/sim/useSimulation';
import { buildCostTable, deterministicTime } from '@/sim/optimize';
import { buildCall, confidenceWord } from '@/predict/call';
import { applyInputs, DEFAULT_INPUTS, type RaceInputs } from '@/predict/inputs';
import { circuitInsights, signatureStrategy, teamPattern, teamRecords } from '@/predict/evidence';
import { Card, CardBody, CardHeader, Stripes } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Stat } from '@/components/ui/stat';
import { Select } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { StintRibbon, TyreDot } from '@/components/ui/tyre';
import type { Strategy } from '@/sim/types';
import { cn } from '@/lib/cn';

export function PredictPage({
  round,
  onRoundChange,
}: {
  round: number;
  onRoundChange: (round: number) => void;
}) {
  const [teamName, setTeamName] = useState(TEAMS[0]?.name ?? '');
  const team = TEAMS.find((t) => t.name === teamName) ?? TEAMS[0];
  const [driverNumber, setDriverNumber] = useState(team?.drivers[0]?.number ?? 1);
  const [tuning, setTuning] = useState(DEFAULT_INPUTS);

  const raceRound = ROUND_BY_NUMBER.get(round) ?? CALENDAR[0];
  const baseCircuit = raceRound.circuitKey ? CIRCUIT_BY_KEY.get(raceRound.circuitKey) ?? null : null;

  const driver =
    team?.drivers.find((d) => d.number === driverNumber) ?? team?.drivers[0] ?? null;

  const inputs: RaceInputs = {
    teamName,
    driverNumber: driver?.number ?? 1,
    round,
    ...tuning,
  };

  const { circuit, settings } = useMemo(() => {
    if (!baseCircuit) return { circuit: null, settings: null };
    return applyInputs(baseCircuit, team, inputs);
  }, [baseCircuit, team, tuning.gridPosition, tuning.rainChance, tuning.trackTemp]);

  const sim = usePlanner(circuit, settings ?? undefined);

  const call = useMemo(() => {
    if (!circuit || !sim.outcomes || sim.strategies.length === 0) return null;
    const table = buildCostTable(circuit);
    const cost = (strategy: Strategy, pitLaps: number[]) => {
      const compounds = strategy.stints.map((s) => s.compound);
      const stints = compounds.map((compound, i) => ({
        compound,
        startLap: i === 0 ? 1 : pitLaps[i - 1] + 1,
        endLap: i < pitLaps.length ? pitLaps[i] : circuit.raceLaps,
        startAge: 0,
      }));
      return deterministicTime(circuit, stints, table);
    };
    return buildCall(circuit, sim.strategies, sim.outcomes, cost);
  }, [circuit, sim.outcomes, sim.strategies]);

  const insights = useMemo(
    () => circuitInsights(baseCircuit, raceRound.circuitKey),
    [baseCircuit, raceRound.circuitKey],
  );
  const records = useMemo(
    () => teamRecords(raceRound.circuitKey, teamName),
    [raceRound.circuitKey, teamName],
  );
  const pattern = useMemo(() => teamPattern(records, teamName), [records, teamName]);
  const signature = useMemo(() => signatureStrategy(raceRound.circuitKey), [raceRound.circuitKey]);

  const busy = sim.planning || sim.running;

  return (
    <div className="flex flex-col gap-4">
      {/* ---------------- Inputs ---------------- */}
      <Card tone="raised">
        <CardBody className="pt-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
            <Select
              label="Your team"
              value={teamName}
              onChange={(v) => {
                setTeamName(v);
                const t = TEAMS.find((x) => x.name === v);
                if (t?.drivers[0]) setDriverNumber(t.drivers[0].number);
              }}
              options={TEAMS.map((t) => ({ value: t.name, label: t.name, swatch: t.colour }))}
              className="lg:col-span-2"
            />
            <Select
              label="Driver"
              value={String(driverNumber)}
              onChange={(v) => setDriverNumber(Number(v))}
              options={(team?.drivers ?? []).map((d) => ({
                value: String(d.number),
                label: d.name,
                hint: `#${d.number}`,
              }))}
            />
            <Select
              label="Race"
              value={String(round)}
              onChange={(v) => onRoundChange(Number(v))}
              options={CALENDAR.map((r) => ({
                value: String(r.round),
                label: `R${r.round} · ${r.shortName}`,
                hint: r.hasModel ? undefined : 'no data',
              }))}
              className="lg:col-span-2"
            />
            <Slider
              label="Grid slot"
              value={tuning.gridPosition}
              onChange={(v) => setTuning((s) => ({ ...s, gridPosition: v }))}
              min={1}
              max={20}
              display={`P${tuning.gridPosition}`}
            />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 border-t border-ink-800 pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <Slider
              label="Rain risk"
              value={Math.round(tuning.rainChance * 100)}
              onChange={(v) => setTuning((s) => ({ ...s, rainChance: v / 100 }))}
              min={0}
              max={100}
              step={5}
              display={`${Math.round(tuning.rainChance * 100)}%`}
            />
            <Slider
              label="Track temperature"
              value={tuning.trackTemp}
              onChange={(v) => setTuning((s) => ({ ...s, trackTemp: v }))}
              min={15}
              max={60}
              display={`${tuning.trackTemp}°C`}
            />
            <div className="flex items-end lg:col-span-2">
              <p className="text-[11.5px] leading-relaxed text-chalk-500">
                Grid slot models dirty air in the opening stint, and track temperature scales
                tyre wear — both genuinely change the call. Rain risk only widens the range of
                outcomes: the model prices the chance of a wet phase but never picks
                intermediates, so it will not hand you a wet strategy.
              </p>
            </div>
          </div>
        </CardBody>
      </Card>

      {!raceRound.hasModel ? (
        <Card tone="default" className="border-amber-500/30 bg-amber-500/5">
          <CardBody>
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-400" />
              <div>
                <h3 className="text-[13px] font-semibold text-amber-200">
                  No model for {raceRound.location}
                </h3>
                <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed text-chalk-400">
                  {raceRound.location} returns to the calendar in {2027} but has not been
                  raced since 2021, before the data this model is built from begins. Rather
                  than invent a prediction, RaceMind shows nothing here. Pick another round
                  — the other {CALENDAR.filter((r) => r.hasModel).length} all have real data
                  behind them.
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      ) : (
        <>
          {/* ---------------- The call ---------------- */}
          <TheCall
            call={call}
            busy={busy}
            teamColour={team?.colour ?? '#8b949e'}
            driverName={driver?.name ?? ''}
            raceName={raceRound.name}
            totalLaps={circuit?.raceLaps ?? 0}
          />

          {/* ---------------- Evidence ---------------- */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {insights.map((insight) => (
              <Card key={insight.id}>
                <CardBody>
                  <div
                    className={cn(
                      'mb-3',
                      insight.tone === 'mint' && 'text-mint-500',
                      insight.tone === 'warn' && 'text-amber-400',
                      insight.tone === 'neutral' && 'text-chalk-500',
                    )}
                  >
                    <Stripes />
                  </div>
                  <h3 className="text-[15px] font-semibold leading-snug tracking-tight">
                    {insight.headline}
                  </h3>
                  <p className="mt-2 text-[12px] leading-relaxed text-chalk-400">{insight.detail}</p>
                </CardBody>
              </Card>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <TeamRecordCard
              records={records}
              team={teamName}
              colour={team?.colour ?? '#8b949e'}
              pattern={pattern?.headline}
              patternDetail={pattern?.detail}
              location={raceRound.location}
            />
            <div className="flex flex-col gap-4">
              {signature && (
                <Card>
                  <CardHeader
                    title="The strategy everyone runs here"
                    hint={`Most common plan among dry finishers, ${Math.round(signature.share * 100)}% of the field`}
                  />
                  <CardBody>
                    <div className="flex flex-wrap items-center gap-2">
                      {signature.sequence.map((c, i) => (
                        <div key={i} className="flex items-center gap-2">
                          {i > 0 && <span className="text-chalk-600">→</span>}
                          <TyreDot compound={c} size="md" />
                        </div>
                      ))}
                    </div>
                  </CardBody>
                </Card>
              )}
              {baseCircuit && <ConfidenceCard circuitKey={raceRound.circuitKey} />}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TheCall({
  call,
  busy,
  teamColour,
  driverName,
  raceName,
  totalLaps,
}: {
  call: ReturnType<typeof buildCall>;
  busy: boolean;
  teamColour: string;
  driverName: string;
  raceName: string;
  totalLaps: number;
}) {
  if (!call) {
    return (
      <Card tone="accent" className="min-h-[15rem]">
        <CardBody className="flex h-full items-center justify-center py-16">
          <span className="flex items-center gap-2.5 text-[13px] text-chalk-400">
            <span className="size-3.5 animate-spin rounded-full border-2 border-ink-600 border-t-mint-500" />
            Simulating the race…
          </span>
        </CardBody>
      </Card>
    );
  }

  const { primary, alternatives, byStopCount, contested } = call;
  const verdict = confidenceWord(primary.confidence);
  const stints = primary.strategy.stints.map((s) => ({
    compound: s.compound,
    laps: s.endLap - s.startLap + 1,
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
      <Card tone="accent" className={cn('animate-fade-up', busy && 'opacity-60 transition-opacity')}>
        <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: teamColour }} />
        <CardBody className="pt-6">
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge tone={verdict.tone === 'mint' ? 'mint' : 'warn'}>{verdict.word}</Badge>
            <span className="text-[11.5px] text-chalk-400">
              {driverName} · {raceName}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-5">
            <div>
              <div className="eyebrow">Most likely strategy</div>
              <div className="mt-1.5 text-[3.25rem] font-bold leading-none tracking-tight text-mint-400">
                {primary.stopLabel}
              </div>
            </div>
            <div className="flex items-center gap-2.5 pb-1.5">
              {primary.strategy.stints.map((s, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  {i > 0 && <span className="text-chalk-600">→</span>}
                  <TyreDot compound={s.compound} size="lg" laps={s.endLap - s.startLap + 1} />
                </div>
              ))}
            </div>
            <Stat
              label="Confidence"
              value={`${Math.round(primary.confidence * 100)}`}
              unit="%"
              size="lg"
              className="pb-1"
            />
          </div>

          <div className="mt-6">
            <StintRibbon stints={stints} totalLaps={totalLaps} height={30} />
            <div className="mt-2 flex justify-between text-[10px] text-chalk-600">
              <span className="num">Lap 1</span>
              <span className="num">Lap {totalLaps}</span>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-x-7 gap-y-3 border-t border-mint-500/15 pt-4">
            {primary.windows.map((w) => (
              <div key={w.stop}>
                <div className="eyebrow">Stop {w.stop}</div>
                <div className="num mt-1 text-[17px] font-semibold">
                  lap {w.earliest}–{w.latest}
                </div>
                <div className="mt-0.5 text-[11px] text-chalk-500">
                  best around {w.centre}
                </div>
              </div>
            ))}
            {primary.windows.length === 0 && (
              <p className="text-[12px] text-chalk-400">No stop required under these conditions.</p>
            )}
          </div>

          {contested && (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-amber-500/10 p-3 text-[11.5px] leading-relaxed text-amber-200">
              <AlertTriangle className="mt-px size-4 shrink-0" />
              This one is genuinely close. No single plan wins more than 45% of simulated
              races, so treat the call as a lean rather than a prediction.
            </p>
          )}
        </CardBody>
      </Card>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="How many stops?" hint="Share of simulated races each wins" />
          <CardBody className="pt-3">
            <div className="flex flex-col gap-3">
              {byStopCount.map(({ stops, probability }) => (
                <div key={stops}>
                  <div className="mb-1.5 flex items-baseline justify-between">
                    <span className="text-[12.5px] font-semibold">
                      {stops} stop{stops === 1 ? '' : 's'}
                    </span>
                    <span className="num text-[12.5px] font-semibold text-chalk-200">
                      {Math.round(probability * 100)}%
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink-800">
                    <div
                      className="h-full rounded-full bg-mint-500 transition-[width] duration-300"
                      style={{ width: `${Math.max(1.5, probability * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="If not that, then" hint="Next most likely plans" />
          <CardBody className="pt-3">
            <div className="flex flex-col gap-2.5">
              {alternatives.slice(0, 3).map((alt) => (
                <div
                  key={alt.strategy.id}
                  className="flex items-center gap-3 rounded-xl border border-ink-800 px-3 py-2.5"
                >
                  <div className="flex items-center gap-1.5">
                    {alt.strategy.stints.map((s, i) => (
                      <TyreDot key={i} compound={s.compound} size="xs" />
                    ))}
                  </div>
                  <span className="text-[12px] font-medium text-chalk-200">{alt.stopLabel}</span>
                  <span className="num ml-auto text-[12px] font-semibold text-chalk-400">
                    {Math.round(alt.confidence * 100)}%
                  </span>
                </div>
              ))}
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function TeamRecordCard({
  records,
  team,
  colour,
  pattern,
  patternDetail,
  location,
}: {
  records: ReturnType<typeof teamRecords>;
  team: string;
  colour: string;
  pattern?: string;
  patternDetail?: string;
  location: string;
}) {
  return (
    <Card>
      <CardHeader
        title={`What ${team} actually did at ${location}`}
        hint={
          records.length
            ? 'Real stints and pit counts from past races — check the prediction against them'
            : undefined
        }
        action={<span className="h-5 w-[3px] rounded-full" style={{ background: colour }} />}
      />
      <CardBody className="pt-3">
        {pattern && (
          <div className="mb-4 rounded-xl border border-ink-800 bg-ink-850 px-4 py-3">
            <p className="text-[13px] font-semibold">{pattern}</p>
            {patternDetail && <p className="mt-1 text-[11.5px] text-chalk-500">{patternDetail}</p>}
          </div>
        )}

        {records.length === 0 ? (
          <p className="py-6 text-center text-[12px] text-chalk-500">
            No record of {team} racing here in the data (2023 onward).
          </p>
        ) : (
          <div className="flex flex-col gap-2.5">
            {records.slice(0, 8).map((r, i) => (
              <div key={`${r.year}-${r.acronym}-${i}`} className="flex items-center gap-3">
                <span className="num w-9 shrink-0 text-[11px] text-chalk-500">{r.year}</span>
                <span className="w-10 shrink-0 text-[11.5px] font-semibold">{r.acronym}</span>
                <div className="min-w-0 flex-1">
                  <StintRibbon
                    stints={r.compounds.map((c, k) => ({ compound: c, laps: r.stintLaps[k] ?? 0 }))}
                    totalLaps={r.totalLaps}
                    height={18}
                    showLaps={false}
                  />
                </div>
                <span className="num w-8 shrink-0 text-right text-[11px] text-chalk-400">
                  {r.stops} st
                </span>
                <span
                  className={cn(
                    'num w-9 shrink-0 text-right text-[11.5px] font-semibold',
                    r.position === 1 && 'text-mint-400',
                  )}
                >
                  {r.finished && r.position ? `P${r.position}` : 'DNF'}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function ConfidenceCard({ circuitKey }: { circuitKey: string | null }) {
  const circuit = circuitKey ? CIRCUIT_BY_KEY.get(circuitKey) : null;
  if (!circuit) return null;
  const conf = modelConfidence(circuit);

  return (
    <Card>
      <CardHeader title="How much to trust this" />
      <CardBody className="pt-3">
        <div className="flex items-start gap-4">
          <Flag className="mt-0.5 size-4 shrink-0 text-chalk-500" />
          <div>
            <Badge tone={conf.level === 'high' ? 'mint' : conf.level === 'medium' ? 'warn' : 'race'}>
              {conf.level} confidence
            </Badge>
            <p className="mt-2.5 text-[11.5px] leading-relaxed text-chalk-400">{conf.note}.</p>
          </div>
        </div>
        <div className="mt-4 flex gap-6 border-t border-ink-800 pt-4">
          <Stat
            label="Race laps"
            value={circuit.raceLaps}
            size="sm"
            sub={<span className="flex items-center gap-1"><Timer className="size-3" /> distance</span>}
          />
          <Stat
            label="Pit cost"
            value={circuit.pitLaneLoss.toFixed(0)}
            unit="s"
            size="sm"
            sub={<span className="flex items-center gap-1"><TrendingDown className="size-3" /> per stop</span>}
          />
        </div>
      </CardBody>
    </Card>
  );
}
