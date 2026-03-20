import { useState, useEffect, useCallback } from 'react';
import { useDates } from './hooks/useDates';
import { useDay, invalidateDayCache } from './hooks/useDay';
import { useLogSubmit } from './hooks/useLogSubmit';
import { todayStr } from './utils';
import { DateNav } from './components/DateNav';
import { DaySummary } from './components/DaySummary';
import { WeekChart } from './components/WeekChart';
import { MealCard } from './components/MealCard';
import { ExerciseCard } from './components/ExerciseCard';
import { LogModal } from './components/LogModal';
import { QueueToast } from './components/QueueToast';
import { deleteExerciseEntry, deleteMealEntry, deleteMealItem } from './api';

function getInitialDate(): string {
  const params = new URLSearchParams(window.location.search);
  const q = params.get('date');
  if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return q;
  return todayStr();
}

export default function App() {
  const { dates, syncDates } = useDates();
  const [currentDate, setCurrentDate] = useState(getInitialDate);
  const [modalOpen, setModalOpen] = useState(false);

  const { data, loading, refresh } = useDay(currentDate);

  // Ensure currentDate is always in the list (even if no data yet)
  const allDates = dates.includes(currentDate)
    ? dates
    : [...dates, currentDate].sort();

  const currentIdx = allDates.indexOf(currentDate);
  const today = todayStr();

  const handleDayRefresh = useCallback(
    (date: string) => {
      if (date === currentDate) refresh();
    },
    [currentDate, refresh],
  );

  const { queue, submit } = useLogSubmit(handleDayRefresh, syncDates);

  // Keep URL in sync with currentDate
  useEffect(() => {
    history.replaceState({ date: currentDate }, '', `?date=${currentDate}`);
  }, [currentDate]);

  // Handle browser back/forward
  useEffect(() => {
    const handler = (e: PopStateEvent) => {
      const date = (e.state as { date?: string } | null)?.date || todayStr();
      setCurrentDate(date);
    };
    window.addEventListener('popstate', handler);
    return () => window.removeEventListener('popstate', handler);
  }, []);

  const goTo = (date: string) => {
    history.pushState({ date }, '', `?date=${date}`);
    setCurrentDate(date);
  };

  const goPrev = () => {
    if (currentIdx > 0) goTo(allDates[currentIdx - 1]);
  };

  const goNext = () => {
    if (currentIdx < allDates.length - 1 && currentDate < today) {
      goTo(allDates[currentIdx + 1]);
    }
  };

  const handleSubmit = (text: string) => {
    submit(text, currentDate);
  };

  const handleDeleteExercise = async (idx: number) => {
    if (!confirm('remove this exercise entry?')) return;
    try {
      await deleteExerciseEntry(currentDate, idx);
      invalidateDayCache(currentDate);
      refresh();
    } catch (err) {
      alert('error: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  };

  const handleDeleteMealEntry = async (idx: number) => {
    if (!confirm('remove this meal entry?')) return;
    try {
      await deleteMealEntry(currentDate, idx);
      invalidateDayCache(currentDate);
      refresh();
    } catch (err) {
      alert('error: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  };

  const handleDeleteMealItem = async (entryIdx: number, itemIdx: number) => {
    if (!confirm('remove this item?')) return;
    try {
      await deleteMealItem(currentDate, entryIdx, itemIdx);
      invalidateDayCache(currentDate);
      refresh();
    } catch (err) {
      alert('error: ' + (err instanceof Error ? err.message : 'unknown'));
    }
  };

  const isToday = currentDate === today;

  return (
    <>
      <header className="app-header">
        <div className="header-inner">
          <div>
            <span className="logo">
              <span className="logo-emoji">🥗</span> foodz
            </span>
          </div>
          <DateNav
            currentDate={currentDate}
            canPrev={currentIdx > 0}
            canNext={currentIdx < allDates.length - 1 && currentDate < today}
            onPrev={goPrev}
            onNext={goNext}
          />
          <div className="header-right">
            <button className="log-open-btn" onClick={() => setModalOpen(true)}>
              + log
            </button>
          </div>
        </div>
      </header>

      <QueueToast items={queue} />

      <main className="main-content">
        {loading ? (
          <div className="loading-state">
            <div className="spinner" />
            <p>loading...</p>
          </div>
        ) : !data ? (
          <div className="empty-state">
            <div className="empty-emoji">🍽️</div>
            <p>{isToday ? 'nothing logged yet today' : 'no data for this day'}</p>
            <small>{isToday ? 'log something in #foodz 🍜' : 'try another date'}</small>
          </div>
        ) : (
          <div>
            <DaySummary data={data} />
            <WeekChart currentDate={currentDate} allDates={allDates} />
            {data.exercise.length > 0 && (
              <ExerciseCard exercise={data.exercise} onDelete={handleDeleteExercise} />
            )}
            {data.entries.length > 0 && (
              <>
                <p className="section-title">meals</p>
                {data.entries.map((entry, idx) => (
                  <MealCard
                    key={idx}
                    entry={entry}
                    entryIdx={idx}
                    onDeleteEntry={handleDeleteMealEntry}
                    onDeleteItem={handleDeleteMealItem}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </main>

      <LogModal open={modalOpen} onClose={() => setModalOpen(false)} onSubmit={handleSubmit} />
    </>
  );
}
