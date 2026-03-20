import { useEffect, useState } from 'react';
import { fetchDay } from '../api';
import { dayCache } from '../cache';
import type { DayData } from '../types';
import { dayLabel, clamp, todayStr } from '../utils';

interface Props {
  currentDate: string;
  allDates: string[];
}

interface WeekEntry {
  date: string;
  data: DayData | null;
}

const BASE_GOAL = 2200;
const BAR_AREA = 80;
const LABEL_H = 16;
const GAP = 3;
const MIN_CAL_THRESHOLD = 800;

async function fetchCached(date: string): Promise<DayData | null> {
  if (date in dayCache) return dayCache[date];
  const data = await fetchDay(date);
  dayCache[date] = data;
  return data;
}

export function WeekChart({ currentDate, allDates }: Props) {
  const [entries, setEntries] = useState<WeekEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const today = todayStr();
    const todayExcluded = allDates.filter(d => d !== today);
    const idx = todayExcluded.indexOf(currentDate);
    const rangeEnd = idx >= 0 ? idx : todayExcluded.length - 1;
    const rangeDates = todayExcluded.slice(Math.max(0, rangeEnd - 6), rangeEnd + 1);

    async function load() {
      const results = await Promise.all(
        rangeDates.map(async d => {
          const data = await fetchCached(d);
          return { date: d, data };
        }),
      );
      if (!cancelled) setEntries(results);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [currentDate, allDates]);

  if (entries.length === 0) return null;

  // Find max cal for scale
  let maxCal = 0;
  entries.forEach(e => {
    if (e.data) {
      maxCal = Math.max(maxCal, e.data.totals.calories_in || 0, e.data.totals.net || 0);
    }
  });
  if (maxCal === 0) maxCal = BASE_GOAL;
  maxCal = Math.max(maxCal * 1.1, BASE_GOAL * 1.15);

  const goalFrac = BASE_GOAL / maxCal;
  const goalLineTop = Math.round(100 - LABEL_H - GAP - goalFrac * BAR_AREA);

  // Weekly summary
  let weekCalIn = 0,
    weekBurned = 0,
    weekGoal = 0,
    weekProtein = 0,
    weekCarbs = 0,
    weekFat = 0,
    daysWithData = 0;

  entries.forEach(e => {
    if (!e.data) return;
    if ((e.data.totals.calories_in || 0) < MIN_CAL_THRESHOLD) return;
    weekCalIn += e.data.totals.calories_in || 0;
    weekBurned += e.data.totals.calories_burned || 0;
    weekGoal += e.data.goal_calories || BASE_GOAL;
    weekProtein += e.data.totals.protein || 0;
    weekCarbs += e.data.totals.carbs || 0;
    weekFat += e.data.totals.fat || 0;
    daysWithData++;
  });

  function macroDiff(actual: number, target: number) {
    const d = actual - target;
    if (Math.abs(d) < 5) return null;
    return d > 0
      ? <span className="macro-over">+{d}</span>
      : <span className="macro-under">{d}</span>;
  }

  const diff = weekCalIn - weekGoal;
  const diffAbs = Math.abs(Math.round(diff));
  const isOver = diff > 50;
  const isUnder = diff < -50;
  const diffClass = isOver ? 'over' : isUnder ? 'under' : 'on-track';
  const diffLabel = isOver
    ? `+${diffAbs.toLocaleString()} over`
    : isUnder
    ? `${diffAbs.toLocaleString()} under`
    : 'on track';

  const avgCalGoal = daysWithData > 0 ? weekGoal / daysWithData : BASE_GOAL;
  const tgtP = Math.round((avgCalGoal * 0.25) / 4);
  const tgtC = Math.round((avgCalGoal * 0.5) / 4);
  const tgtF = Math.round((avgCalGoal * 0.25) / 9);
  const avgP = daysWithData > 0 ? Math.round(weekProtein / daysWithData) : 0;
  const avgC = daysWithData > 0 ? Math.round(weekCarbs / daysWithData) : 0;
  const avgF = daysWithData > 0 ? Math.round(weekFat / daysWithData) : 0;

  return (
    <div className="card">
      <div className="card-title">week</div>

      <div className="week-chart" style={{ position: 'relative', height: 100 }}>
        {entries.map(e => {
          const isActive = e.date === currentDate;
          const inH = e.data
            ? clamp((e.data.totals.calories_in / maxCal) * BAR_AREA, 2, BAR_AREA)
            : 0;
          const netH = e.data
            ? clamp((Math.max(0, e.data.totals.net) / maxCal) * BAR_AREA, 2, BAR_AREA)
            : 0;

          return (
            <div key={e.date} className={`week-col${isActive ? ' active-day' : ''}`}>
              <div className="week-bars">
                <div
                  className="week-bar bar-in"
                  style={{ height: inH }}
                  title={e.data ? `${e.data.totals.calories_in} cal in` : '—'}
                />
                <div
                  className="week-bar bar-net"
                  style={{ height: netH }}
                  title={e.data ? `${e.data.totals.net} net` : '—'}
                />
              </div>
              <div className="week-label">{dayLabel(e.date)}</div>
            </div>
          );
        })}
        <div className="goal-line" style={{ top: goalLineTop }}>
          <span className="goal-line-label">{BASE_GOAL.toLocaleString()}</span>
        </div>
      </div>

      {daysWithData > 0 && (
        <div className="week-summary">
          <div className="week-summary-row">
            <span className="week-summary-label">
              {daysWithData} day{daysWithData !== 1 ? 's' : ''}
            </span>
            <span className="week-summary-stats">
              {weekCalIn.toLocaleString()} in · {weekBurned.toLocaleString()} burned · goal{' '}
              {weekGoal.toLocaleString()}
            </span>
            <span className={`week-summary-diff ${diffClass}`}>{diffLabel}</span>
          </div>
          <div className="week-macro-row">
            <span className="week-macro-label">avg/day</span>
            <span className="week-macro-stat protein-color">
              P {avgP}g {macroDiff(avgP, tgtP)}
            </span>
            <span className="week-macro-stat carbs-color">
              C {avgC}g {macroDiff(avgC, tgtC)}
            </span>
            <span className="week-macro-stat fat-color">
              F {avgF}g {macroDiff(avgF, tgtF)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
