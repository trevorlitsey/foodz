import { useRef, useEffect } from 'react';
import { clamp, getStatusMessage } from '../utils';
import type { DayData } from '../types';

interface MacroBarProps {
  name: string;
  value: number;
  max: number;
  colorClass: string;
}

function MacroBar({ name, value, max, colorClass }: MacroBarProps) {
  const pct = max > 0 ? clamp((value / max) * 100, 0, 100) : 0;
  const over = value > max;
  const diff = Math.abs(value - max);
  const diffLabel = over ? `${diff}g over` : value === max ? 'on target' : `${diff}g to go`;
  const fillRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = fillRef.current;
    if (!el) return;
    el.style.width = '0%';
    const raf = requestAnimationFrame(() => {
      el.style.width = pct + '%';
    });
    return () => cancelAnimationFrame(raf);
  }, [pct]);

  return (
    <div className="macro-block">
      <div className="macro-header">
        <span className="macro-name">{name}</span>
        <span className={`macro-diff${over ? ' over' : ''}`}>{diffLabel}</span>
      </div>
      <div className="macro-track">
        <div
          ref={fillRef}
          className={`macro-fill ${colorClass}${over ? ' over' : ''}`}
          style={{ width: '0%' }}
        />
      </div>
      <div className="macro-footer">
        <span className="macro-actual">{value}g</span>
        <span className="macro-goal">/ {max}g</span>
      </div>
    </div>
  );
}

interface Props {
  data: DayData;
}

export function DaySummary({ data }: Props) {
  const { totals, goal_calories } = data;
  const { calories_in, calories_burned, net, protein, carbs, fat } = totals;

  const status = getStatusMessage(calories_in, goal_calories);
  const proteinTarget = Math.round((goal_calories * 0.25) / 4);
  const carbTarget = Math.round((goal_calories * 0.5) / 4);
  const fatTarget = Math.round((goal_calories * 0.25) / 9);

  const pct = clamp((calories_in / goal_calories) * 100, 0, 105);
  const progressRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;
    el.style.width = '0%';
    const raf = requestAnimationFrame(() => {
      el.style.width = pct + '%';
    });
    return () => cancelAnimationFrame(raf);
  }, [pct]);

  return (
    <>
      <div className={`status-banner${status.cls ? ' ' + status.cls : ''}`}>{status.text}</div>

      <div className="summary-row">
        <div className="summary-card">
          <div className="summary-label">calories in</div>
          <div className="summary-value">{calories_in.toLocaleString()}</div>
          <div className="summary-sub">goal: {goal_calories.toLocaleString()}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">burned</div>
          <div className="summary-value">{calories_burned.toLocaleString()}</div>
          <div className="summary-sub">net: {net.toLocaleString()}</div>
        </div>
        <div className="summary-card">
          <div className="summary-label">protein</div>
          <div className="summary-value">{protein}</div>
          <div className="summary-sub">grams</div>
        </div>
      </div>

      <div className="card">
        <div className="progress-header">
          <div className="card-title">progress</div>
          <div className="progress-label-right">
            {calories_in <= goal_calories
              ? `${(goal_calories - calories_in).toLocaleString()} to go`
              : `${(calories_in - goal_calories).toLocaleString()} over`}
          </div>
        </div>
        <div className="progress-track">
          <div
            ref={progressRef}
            className={`progress-bar${pct > 100 ? ' over-goal' : ''}`}
            style={{ width: '0%' }}
          />
        </div>
        <div className="progress-cal-row">
          <span className="progress-cal-in">{calories_in.toLocaleString()} cal</span>
          <span className="progress-cal-goal">/ {goal_calories.toLocaleString()}</span>
        </div>
      </div>

      <div className="card">
        <div className="card-title">macros</div>
        <div className="macros-grid">
          <MacroBar name="protein" value={protein} max={proteinTarget} colorClass="protein" />
          <MacroBar name="carbs" value={carbs} max={carbTarget} colorClass="carbs" />
          <MacroBar name="fat" value={fat} max={fatTarget} colorClass="fat" />
        </div>
      </div>
    </>
  );
}
