export interface FoodItem {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealEntry {
  meal: string;
  description: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  items: FoodItem[];
}

export interface ExerciseEntry {
  activity: string;
  calories_burned: number;
  duration_minutes?: number;
  notes?: string;
}

export interface DayTotals {
  calories_in: number;
  calories_burned: number;
  net: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface DayData {
  date: string;
  goal_calories: number;
  entries: MealEntry[];
  exercise: ExerciseEntry[];
  totals: DayTotals;
}

export interface LogResponse {
  ok: boolean;
  date: string;
  entries?: MealEntry[];
  exercise?: ExerciseEntry[];
  edits?: string[];
  totals?: DayTotals;
  goal_calories?: number;
  day?: DayData;
  error?: string;
}

export interface DatesResponse {
  dates: string[];
}
