import { useState, useEffect, useCallback } from 'react';
import { fetchDates } from '../api';
import { todayStr } from '../utils';

export function useDates() {
  const [dates, setDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDates = useCallback(async () => {
    try {
      const index = await fetchDates();
      const today = todayStr();
      const sorted = [...new Set([...index.dates, today])].sort();
      setDates(sorted);
    } catch {
      setDates([todayStr()]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDates();
  }, [loadDates]);

  const syncDates = useCallback(async () => {
    try {
      const index = await fetchDates();
      setDates(prev => {
        const merged = [...new Set([...prev, ...index.dates])].sort();
        return merged;
      });
    } catch {
      // ignore
    }
  }, []);

  return { dates, loading, syncDates };
}
