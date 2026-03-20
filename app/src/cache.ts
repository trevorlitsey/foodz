import type { DayData } from './types';

// Shared module-level day cache — used by useDay hook and WeekChart
export const dayCache: Record<string, DayData | null> = {};
