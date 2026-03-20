export function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today.getTime() - dt.getTime()) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays <= 6) return dt.toLocaleDateString('en-US', { weekday: 'long' });
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function dayLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short' });
}

export function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export const MEAL_EMOJIS: Record<string, string> = {
  breakfast: '🌅',
  lunch: '☀️',
  dinner: '🌙',
  snack: '🍎',
  'pre-gym snack': '⚡',
  'post-gym': '💪',
  afternoon: '☕',
  evening: '🌆',
};

export function getMealEmoji(meal: string): string {
  const lower = meal.toLowerCase();
  for (const [key, emoji] of Object.entries(MEAL_EMOJIS)) {
    if (lower.includes(key)) return emoji;
  }
  return '🍽️';
}

export function getStatusMessage(caloriesIn: number, goal: number): { text: string; cls: string } {
  const pct = caloriesIn / goal;
  if (pct < 0.5) return { text: 'light day — you good? 👀', cls: 'good' };
  if (pct < 0.85) return { text: 'crushing it 🔥', cls: 'good' };
  if (pct < 1.0) return { text: 'right on track 💪', cls: 'good' };
  if (pct < 1.1) return { text: 'a lil over — still solid ✨', cls: '' };
  if (pct < 1.25) return { text: 'indulgent day 🍕', cls: 'over' };
  return { text: 'treat yourself 🎉', cls: 'over' };
}
