import type { ExerciseEntry } from '../types';

interface Props {
  exercise: ExerciseEntry[];
  onDelete: (idx: number) => void;
}

export function ExerciseCard({ exercise, onDelete }: Props) {
  if (exercise.length === 0) return null;

  return (
    <div className="card exercise-card">
      <div className="card-title">exercise</div>
      {exercise.map((ex, idx) => (
        <div key={idx} className="exercise-item">
          <div>
            <div className="exercise-name">
              {ex.activity}
              <button
                className="entry-delete-btn meal-title-delete"
                onClick={() => onDelete(idx)}
                title="delete"
              >
                ×
              </button>
            </div>
            <div className="exercise-meta">
              {ex.duration_minutes != null ? `${ex.duration_minutes} min` : ''}
              {ex.notes ? ` · ${ex.notes}` : ''}
            </div>
          </div>
          <div className="exercise-cal">-{ex.calories_burned} cal</div>
        </div>
      ))}
    </div>
  );
}
