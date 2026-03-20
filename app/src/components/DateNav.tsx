import { formatDate } from '../utils';

interface Props {
  currentDate: string;
  canPrev: boolean;
  canNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}

export function DateNav({ currentDate, canPrev, canNext, onPrev, onNext }: Props) {
  return (
    <div className="date-nav">
      <button className="nav-btn" onClick={onPrev} disabled={!canPrev} aria-label="previous day">
        ‹
      </button>
      <button className="date-display">{formatDate(currentDate)}</button>
      <button className="nav-btn" onClick={onNext} disabled={!canNext} aria-label="next day">
        ›
      </button>
    </div>
  );
}
