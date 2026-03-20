import type { DayData, DatesResponse, LogResponse } from './types';

const API_URL = 'https://api.foodz.trevor.fail';

export async function fetchDates(): Promise<DatesResponse> {
  const res = await fetch(`${API_URL}/dates`);
  return res.json();
}

export async function fetchDay(date: string): Promise<DayData | null> {
  try {
    const res = await fetch(`${API_URL}/day/${date}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function postLog(text: string, date: string): Promise<LogResponse> {
  const res = await fetch(`${API_URL}/log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, date }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'failed');
  return data;
}

export async function deleteExerciseEntry(date: string, idx: number): Promise<void> {
  const res = await fetch(`${API_URL}/day/${date}/exercise/${idx}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('delete failed');
}

export async function deleteMealEntry(date: string, idx: number): Promise<void> {
  const res = await fetch(`${API_URL}/day/${date}/entries/${idx}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('delete failed');
}

export async function deleteMealItem(date: string, entryIdx: number, itemIdx: number): Promise<void> {
  const res = await fetch(`${API_URL}/day/${date}/entries/${entryIdx}/items/${itemIdx}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('delete failed');
}
