import { useState } from 'react';
import { getMealEmoji } from '../utils';
import type { MealEntry } from '../types';

interface Props {
  entry: MealEntry;
  entryIdx: number;
  onDeleteEntry: (idx: number) => void;
  onDeleteItem: (entryIdx: number, itemIdx: number) => void;
}

export function MealCard({ entry, entryIdx, onDeleteEntry, onDeleteItem }: Props) {
  const [itemsOpen, setItemsOpen] = useState(false);
  const emoji = getMealEmoji(entry.meal);
  const hasItems = entry.items && entry.items.length > 0;

  return (
    <div className="meal-card">
      <div className="meal-header">
        <div className="meal-name-wrap">
          <div className="meal-name">
            <span className="meal-emoji">{emoji}</span>
            {entry.meal}
            <button
              className="entry-delete-btn meal-title-delete"
              onClick={() => onDeleteEntry(entryIdx)}
              title="delete"
            >
              ×
            </button>
          </div>
          {entry.description && (
            <div className="meal-description">{entry.description}</div>
          )}
        </div>
        <div className="meal-cal-badge">{entry.calories} cal</div>
      </div>

      <div className="meal-macros">
        <div className="meal-macro">
          P <span>{entry.protein}g</span>
        </div>
        <div className="meal-macro">
          C <span>{entry.carbs}g</span>
        </div>
        <div className="meal-macro">
          F <span>{entry.fat}g</span>
        </div>
      </div>

      {hasItems && (
        <>
          <button
            className="meal-toggle"
            onClick={() => setItemsOpen(o => !o)}
          >
            {itemsOpen
              ? '▾ hide items'
              : `▸ show ${entry.items.length} item${entry.items.length > 1 ? 's' : ''}`}
          </button>
          {itemsOpen && (
            <div className="meal-items open">
              {entry.items.map((item, itemIdx) => (
                <div key={itemIdx} className="meal-item-row">
                  <div className="meal-item-name">
                    {item.name}
                    <button
                      className="item-delete-btn"
                      onClick={() => onDeleteItem(entryIdx, itemIdx)}
                      title="remove item"
                    >
                      ×
                    </button>
                  </div>
                  <div className="meal-item-right">
                    <div className="meal-item-cal">{item.calories} cal</div>
                    <div className="meal-item-macros">
                      P:{item.protein}g C:{item.carbs}g F:{item.fat}g
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
