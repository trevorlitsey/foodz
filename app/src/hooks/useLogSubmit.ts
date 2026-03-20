import { useState, useCallback } from 'react';
import { postLog } from '../api';
import { setCacheDay, invalidateDayCache } from './useDay';

export interface QueueItem {
  id: number;
  text: string;
  status: 'processing' | 'success' | 'error';
  message: string;
  fading?: boolean;
}

let queueIdCounter = 0;

export function useLogSubmit(
  onDayRefresh: (date: string) => void,
  onDatesSync: () => void,
) {
  const [queue, setQueue] = useState<QueueItem[]>([]);

  const submit = useCallback(async (text: string, date: string) => {
    const id = ++queueIdCounter;
    const truncated = text.length > 48 ? text.slice(0, 48) + '…' : text;

    setQueue(q => [...q, { id, text: truncated, status: 'processing', message: truncated }]);

    try {
      const data = await postLog(text, date);

      const parts: string[] = [];
      if (data.edits && data.edits.length > 0) {
        parts.push('updated: ' + data.edits.join('; '));
      }
      if (data.entries && data.entries.length > 0) {
        parts.push(
          data.entries
            .map(e => {
              const itemList =
                e.items?.length
                  ? e.items.map(i => `${i.name} ${i.calories}cal`).join(', ')
                  : null;
              return `${e.meal}: ${e.calories} cal${itemList ? ' (' + itemList + ')' : ''}`;
            })
            .join(' · '),
        );
      }
      if (data.exercise && data.exercise.length > 0) {
        parts.push(
          data.exercise.map(ex => `${ex.activity}: -${ex.calories_burned} cal`).join(' · '),
        );
      }
      if (data.totals) {
        const goal = data.goal_calories || 2200;
        const net = data.totals.net || data.totals.calories_in || 0;
        const remaining = goal - net;
        parts.push(
          `${net} cal net · ${remaining >= 0 ? remaining + ' remaining' : Math.abs(remaining) + ' over'}`,
        );
      }
      const summary = parts.join(' — ') || 'logged';

      invalidateDayCache(date);
      if (data.day) setCacheDay(date, data.day);

      setQueue(q =>
        q.map(item => (item.id === id ? { ...item, status: 'success', message: summary } : item)),
      );

      onDayRefresh(date);
      onDatesSync();

      setTimeout(() => {
        setQueue(q => q.map(item => (item.id === id ? { ...item, fading: true } : item)));
        setTimeout(() => {
          setQueue(q => q.filter(item => item.id !== id));
        }, 400);
      }, 3000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'error';
      setQueue(q =>
        q.map(item => (item.id === id ? { ...item, status: 'error', message: msg } : item)),
      );
      setTimeout(() => {
        setQueue(q => q.map(item => (item.id === id ? { ...item, fading: true } : item)));
        setTimeout(() => {
          setQueue(q => q.filter(item => item.id !== id));
        }, 400);
      }, 4000);
    }
  }, [onDayRefresh, onDatesSync]);

  return { queue, submit };
}
