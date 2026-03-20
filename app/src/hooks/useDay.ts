import { useState, useEffect, useRef, useCallback } from 'react';
import { fetchDay } from '../api';
import { dayCache } from '../cache';
import type { DayData } from '../types';

export function invalidateDayCache(date: string) {
  delete dayCache[date];
}

export function setCacheDay(date: string, data: DayData) {
  dayCache[date] = data;
}

// undefined = still loading, null = loaded but no data, DayData = loaded with data
export function useDay(date: string) {
  const [data, setData] = useState<DayData | null | undefined>(undefined);
  const activeRef = useRef<string>('');

  const load = useCallback(async (d: string) => {
    // Check cache first
    if (d in dayCache && dayCache[d] !== undefined) {
      setData(dayCache[d]);
      return;
    }
    setData(undefined); // trigger loading state
    const result = await fetchDay(d);
    dayCache[d] = result;
    // Only update state if this date is still active
    if (activeRef.current === d) {
      setData(result);
    }
  }, []);

  useEffect(() => {
    activeRef.current = date;
    load(date);
  }, [date, load]);

  const refresh = useCallback(() => {
    invalidateDayCache(date);
    load(date);
  }, [date, load]);

  return { data, loading: data === undefined, refresh };
}
