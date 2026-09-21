import { useMemo, useState } from 'react';
import {
  AVAILABLE_SEASONS,
  getDrivers,
  getLaps,
  getPitStops,
  getRaceControl,
  getRaces,
  getStints,
  getWeather,
} from '../data/openf1';
import { analyseRace, summariseWeather, type DriverRaceView } from '../data/raceAnalysis';
import { useAsync } from '../data/useAsync';
import { formatDelta, formatLapTime, formatRaceTime } from '../lib/format';
import { COMPOUND_COLOR, COMPOUND_SHORT } from '../ui/tokens';
import type { Compound } from '../sim/types';

export function RacePage() {
  const [season, setSeason] = useState<number>(2026);
  const [sessionKey, setSessionKey] = useState<number | null>(null);

  const races = useAsync(() => getRaces(season), [season]);

  const activeKey = sessionKey ?? races.data?.[races.data.length - 1]?.session_key ?? null;
  const activeRace = races.data?.find((r) => r.session_key === activeKey) ?? null;

  const detail = useAsync(async () => {
    if (!activeKey) return null;
    const [laps, stints, pits, drivers, control, weather] = await Promise.all([
      getLaps(activeKey),
      getStints(activeKey),
      getPitStops(activeKey),
      getDrivers(activeKey),
      getRaceControl(activeKey),
      getWeather(activeKey),
    ]);
    return {
      views: analyseRace(laps, stints, pits, drivers, control),
      weather: summariseWeather(weather),
      totalLaps: laps.reduce((m, l) => Math.max(m, l.lap_number), 0),
    };
  }, [activeKey]);

  const leader = detail.data?.views[0] ?? null;

  return (
    <div className="page grid" style={{ gap: 14 }}>
      <div className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Race archive</div>
            <div className="card-sub">
              Live from OpenF1. Only 2023 onward exists — earlier seasons are not offered
              because the API has no data for them.
            </div>
          </div>
        </div>

        <div className="chips" style={{ marginBottom: 10 }}>
          {AVAILABLE_SEASONS.map((y) => (
            <button
              key={y}
              className="chip"
              aria-pressed={season === y}
              onClick={() => {
                setSeason(y);
                setSessionKey(null);
              }}
            >
              {y}
            </button>
          ))}
        </div>

        {races.loading && <span className="small faint"><span className="spinner" /> loading calendar…</span>}
        {races.error && <div className="banner bad">{races.error}</div>}
        <div className="chips">
          {races.data?.map((r) => (
            <button
              key={r.session_key}
              className="chip"
              aria-pressed={activeKey === r.session_key}
              onClick={() => setSessionKey(r.session_key)}
            >
              {r.circuit_short_name}
            </button>
          ))}
        </div>
      </div>

      {detail.loading && (
        <div className="card small faint">
          <span className="spinner" /> loading race — laps, stints, pit stops, race control…
        </div>
      )}
      {detail.error && <div className="banner bad">{detail.error}</div>}

      {detail.data && activeRace && (
        <>
          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">
                  {activeRace.location} — {activeRace.country_name}
                </div>
                <div className="card-sub">
                  {new Date(activeRace.date_start).toLocaleDateString(undefined, {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}{' '}
                  · {detail.data.totalLaps} laps · {detail.data.views.length} classified
                </div>
              </div>
            </div>
            <div className="stat-row">
              <div className="stat">
                <span className="k">Air temp</span>
                <span className="v num">{detail.data.weather.airTemp?.toFixed(1) ?? '—'}°C</span>
              </div>
              <div className="stat">
                <span className="k">Track temp</span>
                <span className="v num">{detail.data.weather.trackTemp?.toFixed(1) ?? '—'}°C</span>
              </div>
              <div className="stat">
                <span className="k">Humidity</span>
                <span className="v num">{detail.data.weather.humidity?.toFixed(0) ?? '—'}%</span>
              </div>
              <div className="stat">
                <span className="k">Rain</span>
                <span className="v">{detail.data.weather.rainfall ? 'Yes' : 'No'}</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Tyre strategies</div>
                <div className="card-sub">
                  Actual compounds and stint lengths from /stints — the ground truth the
                  strategy model is fitted against.
                </div>
              </div>
            </div>
            <div className="grid" style={{ gap: 6 }}>
              {detail.data.views.slice(0, 20).map((view, i) => (
                <StrategyRow
                  key={view.driverNumber}
                  view={view}
                  position={i + 1}
                  totalLaps={detail.data!.totalLaps}
                  leaderTime={leader?.totalTime ?? null}
                />
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <div>
                <div className="card-title">Classification</div>
                <div className="card-sub">
                  Stop counts come from /pit, not guessed from slow laps. Pace figures exclude
                  in-laps, out-laps and safety-car laps.
                </div>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Pos</th>
                    <th>Driver</th>
                    <th>Team</th>
                    <th className="right">Laps</th>
                    <th className="right">Gap</th>
                    <th className="right">Best lap</th>
                    <th className="right">Median pace</th>
                    <th className="right">Stops</th>
                    <th>Tyres</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.data.views.map((v, i) => (
                    <tr key={v.driverNumber}>
                      <td className="num">{i + 1}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-block',
                            width: 3,
                            height: 12,
                            background: v.teamColour,
                            marginRight: 8,
                            verticalAlign: -1,
                            borderRadius: 1,
                          }}
                        />
                        {v.name}
                      </td>
                      <td className="muted">{v.team}</td>
                      <td className="right num">{v.lapsCompleted}</td>
                      <td className="right num">
                        {i === 0
                          ? formatRaceTime(v.totalTime ?? NaN)
                          : v.totalTime && leader?.totalTime && v.lapsCompleted === leader.lapsCompleted
                            ? `${formatDelta(v.totalTime - leader.totalTime, 1)}`
                            : `+${(leader?.lapsCompleted ?? 0) - v.lapsCompleted} lap`}
                      </td>
                      <td className="right num">{v.bestLap ? formatLapTime(v.bestLap) : '—'}</td>
                      <td className="right num">{v.medianLap ? formatLapTime(v.medianLap) : '—'}</td>
                      <td className="right num">{v.stops}</td>
                      <td>
                        <span style={{ display: 'flex', gap: 3 }}>
                          {v.stints.map((s) => (
                            <span
                              key={s.stintNumber}
                              title={`${s.compound} · ${s.laps} laps`}
                              style={{
                                width: 15,
                                height: 15,
                                borderRadius: 3,
                                fontSize: 9,
                                fontWeight: 700,
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                background: COMPOUND_COLOR[s.compound as Compound] ?? '#555',
                                color: s.compound === 'SOFT' ? '#fff' : '#1a1a1a',
                              }}
                            >
                              {COMPOUND_SHORT[s.compound as Compound] ?? '?'}
                            </span>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StrategyRow({
  view,
  position,
  totalLaps,
  leaderTime,
}: {
  view: DriverRaceView;
  position: number;
  totalLaps: number;
  leaderTime: number | null;
}) {
  const gap = useMemo(() => {
    if (position === 1 || !view.totalTime || !leaderTime) return null;
    return view.totalTime - leaderTime;
  }, [view.totalTime, leaderTime, position]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <span className="num faint" style={{ width: 18, textAlign: 'right', fontSize: 11 }}>
        {position}
      </span>
      <span style={{ width: 42, fontSize: 11.5, fontWeight: 600 }}>{view.acronym}</span>
      <div
        style={{
          flex: 1,
          display: 'flex',
          height: 18,
          borderRadius: 4,
          overflow: 'hidden',
          background: 'var(--surface-2)',
        }}
      >
        {view.stints.map((s) => (
          <div
            key={s.stintNumber}
            title={`${s.compound} — laps ${s.lapStart}–${s.lapEnd} (${s.laps}), started at ${s.ageAtStart} laps old${
              s.degradation != null ? `, ${s.degradation >= 0 ? '+' : ''}${s.degradation.toFixed(3)} s/lap` : ''
            }`}
            style={{
              flex: s.laps,
              background: COMPOUND_COLOR[s.compound as Compound] ?? '#555',
              borderRight: '1px solid var(--bg)',
            }}
          />
        ))}
        {/* Retirements leave the bar short, which is the honest rendering. */}
        {view.stints.length > 0 &&
          totalLaps - view.stints[view.stints.length - 1].lapEnd > 0 && (
            <div
              style={{
                flex: totalLaps - view.stints[view.stints.length - 1].lapEnd,
                background: 'repeating-linear-gradient(45deg, #2a2f3a, #2a2f3a 4px, #1d212a 4px, #1d212a 8px)',
              }}
              title="Did not complete"
            />
          )}
      </div>
      <span className="num faint" style={{ width: 62, textAlign: 'right', fontSize: 11 }}>
        {gap != null ? `${formatDelta(gap, 1)}s` : position === 1 ? 'leader' : '—'}
      </span>
    </div>
  );
}
