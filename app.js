/* foodz app — vanilla JS */

const MEAL_EMOJIS = {
  breakfast: '🌅',
  lunch: '☀️',
  dinner: '🌙',
  snack: '🍎',
  'pre-gym snack': '⚡',
  'post-gym': '💪',
  afternoon: '☕',
  evening: '🌆',
};

function getMealEmoji(meal) {
  const lower = meal.toLowerCase();
  for (const [key, emoji] of Object.entries(MEAL_EMOJIS)) {
    if (lower.includes(key)) return emoji;
  }
  return '🍽️';
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function shortDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function dayLabel(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', { weekday: 'short' });
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

// ── App state ──
let allDates = [];
let currentDateIndex = 0;
let weekDataCache = {};

async function fetchIndex() {
  const res = await fetch('data/index.json');
  return res.json();
}

async function fetchDay(dateStr) {
  if (weekDataCache[dateStr]) return weekDataCache[dateStr];
  try {
    const res = await fetch(`data/${dateStr}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    weekDataCache[dateStr] = data;
    return data;
  } catch {
    return null;
  }
}

function getStatusMessage(caloriesIn, goal, netCalories) {
  const diff = caloriesIn - goal;
  const pct = caloriesIn / goal;

  if (pct < 0.5) return { text: 'light day — you good? 👀', cls: 'good' };
  if (pct < 0.85) return { text: 'crushing it 🔥', cls: 'good' };
  if (pct < 1.0)  return { text: 'right on track 💪', cls: 'good' };
  if (pct < 1.1)  return { text: 'a lil over — still solid ✨', cls: '' };
  if (pct < 1.25) return { text: 'indulgent day 🍕', cls: 'over' };
  return { text: 'treat yourself 🎉', cls: 'over' };
}

function renderMacroBar(name, value, max, className) {
  const pct = max > 0 ? clamp(value / max * 100, 0, 100) : 0;
  return `
    <div class="macro-row">
      <div class="macro-name">${name}</div>
      <div class="macro-track">
        <div class="macro-fill ${className}" style="width: ${pct}%"></div>
      </div>
      <div class="macro-val">${value}g</div>
    </div>
  `;
}

async function renderWeekChart(currentDate) {
  const container = document.getElementById('week-chart');
  // Get last 7 dates from allDates up to and including current
  const idx = allDates.indexOf(currentDate);
  const rangeEnd = idx >= 0 ? idx : allDates.length - 1;
  const rangeDates = allDates.slice(Math.max(0, rangeEnd - 6), rangeEnd + 1);

  // Fetch all needed data
  const entries = await Promise.all(rangeDates.map(d => fetchDay(d)));

  // Find max calories for scale
  let maxCal = 0;
  entries.forEach(e => {
    if (e) {
      maxCal = Math.max(maxCal, e.totals.calories_in || 0, e.totals.net || 0);
    }
  });
  const BASE_GOAL = 2200;
  if (maxCal === 0) maxCal = BASE_GOAL;
  maxCal = Math.max(maxCal * 1.1, BASE_GOAL * 1.15); // always show goal line with headroom

  const BAR_AREA = 80;    // px height of the bars area
  const LABEL_H = 16;     // approx label height
  const GAP = 3;          // gap between bars and label
  // Goal line top offset: chart is 100px, bars area sits above label
  // bottom of bars area = ~(LABEL_H + GAP) px from bottom of chart
  // goal line is at (BASE_GOAL / maxCal) fraction up the bars area
  const goalFrac = BASE_GOAL / maxCal;
  const goalLineTop = Math.round(100 - LABEL_H - GAP - goalFrac * BAR_AREA);

  // Weekly totals — exclude today unless dinner is logged; skip days likely missing logs (< 800 cal)
  const todayDateStr = todayStr();
  const MIN_CAL_THRESHOLD = 800; // below this = probably an incomplete log day
  let weekCalIn = 0, weekBurned = 0, weekGoal = 0, weekProtein = 0, weekCarbs = 0, weekFat = 0, daysWithData = 0;
  rangeDates.forEach((d, i) => {
    const e = entries[i];
    if (!e) return;
    if (d === todayDateStr) {
      // only include today if dinner has been logged
      const hasDinner = (e.entries || []).some(entry => entry.meal && entry.meal.toLowerCase().includes('dinner'));
      if (!hasDinner) return;
    }
    if ((e.totals.calories_in || 0) < MIN_CAL_THRESHOLD) return; // likely missed logging
    weekCalIn += e.totals.calories_in || 0;
    weekBurned += e.totals.calories_burned || 0;
    weekGoal += e.goal_calories || BASE_GOAL;
    weekProtein += e.totals.protein || 0;
    weekCarbs += e.totals.carbs || 0;
    weekFat += e.totals.fat || 0;
    daysWithData++;
  });

  let html = '';
  for (let i = 0; i < rangeDates.length; i++) {
    const d = rangeDates[i];
    const data = entries[i];
    const isActive = d === currentDate;
    const inH = data ? clamp(data.totals.calories_in / maxCal * BAR_AREA, 2, BAR_AREA) : 0;
    const netH = data ? clamp(Math.max(0, data.totals.net) / maxCal * BAR_AREA, 2, BAR_AREA) : 0;
    const label = dayLabel(d);

    html += `
      <div class="week-col ${isActive ? 'active-day' : ''}">
        <div class="week-bars">
          <div class="week-bar bar-in" style="height: ${inH}px" title="${data ? data.totals.calories_in + ' cal in' : '—'}"></div>
          <div class="week-bar bar-net" style="height: ${netH}px" title="${data ? data.totals.net + ' net' : '—'}"></div>
        </div>
        <div class="week-label">${label}</div>
      </div>
    `;
  }

  // Goal line overlay
  html += `<div class="goal-line" style="top: ${goalLineTop}px"><span class="goal-line-label">${BASE_GOAL.toLocaleString()}</span></div>`;

  container.innerHTML = html;

  // Weekly summary
  const summaryEl = document.getElementById('week-summary');
  if (summaryEl) {
    if (daysWithData > 0) {
      const diff = weekCalIn - weekGoal;
      const diffAbs = Math.abs(Math.round(diff));
      const isOver = diff > 50;
      const isUnder = diff < -50;
      const diffClass = isOver ? 'over' : isUnder ? 'under' : 'on-track';
      const diffLabel = isOver ? `+${diffAbs.toLocaleString()} over` : isUnder ? `${diffAbs.toLocaleString()} under` : 'on track';
      summaryEl.style.display = '';
      const avgP = Math.round(weekProtein / daysWithData);
      const avgC = Math.round(weekCarbs / daysWithData);
      const avgF = Math.round(weekFat / daysWithData);
      summaryEl.innerHTML = `
        <div class="week-summary-row">
          <span class="week-summary-label">${daysWithData} day${daysWithData !== 1 ? 's' : ''}</span>
          <span class="week-summary-stats">${weekCalIn.toLocaleString()} in · ${weekBurned.toLocaleString()} burned · goal ${weekGoal.toLocaleString()}</span>
          <span class="week-summary-diff ${diffClass}">${diffLabel}</span>
        </div>
        <div class="week-macro-row">
          <span class="week-macro-label">avg/day</span>
          <span class="week-macro-stat protein-color">P ${avgP}g</span>
          <span class="week-macro-stat carbs-color">C ${avgC}g</span>
          <span class="week-macro-stat fat-color">F ${avgF}g</span>
        </div>
      `;
    } else {
      summaryEl.style.display = 'none';
    }
  }
}

function renderExercise(exercise) {
  const section = document.getElementById('exercise-section');
  const list = document.getElementById('exercise-list');

  if (!exercise || exercise.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  list.innerHTML = exercise.map(ex => `
    <div class="exercise-item">
      <div>
        <div class="exercise-name">${ex.activity}</div>
        <div class="exercise-meta">${ex.duration_minutes} min${ex.notes ? ' · ' + ex.notes : ''}</div>
      </div>
      <div class="exercise-cal">-${ex.calories_burned} cal</div>
    </div>
  `).join('');
}

function renderMeals(entries) {
  const container = document.getElementById('meals-list');
  container.innerHTML = entries.map((entry, idx) => {
    const emoji = getMealEmoji(entry.meal);
    const hasItems = entry.items && entry.items.length > 0;
    const itemsHtml = hasItems ? entry.items.map(item => `
      <div class="meal-item-row">
        <div class="meal-item-name">${item.name}</div>
        <div>
          <div class="meal-item-cal">${item.calories} cal</div>
          <div class="meal-item-macros">P:${item.protein}g C:${item.carbs}g F:${item.fat}g</div>
        </div>
      </div>
    `).join('') : '';

    return `
      <div class="meal-card">
        <div class="meal-header">
          <div class="meal-name-wrap">
            <div class="meal-name">
              <span class="meal-emoji">${emoji}</span>
              ${entry.meal}
            </div>
            ${entry.description ? `<div class="meal-description">${entry.description}</div>` : ''}
          </div>
          <div class="meal-cal-badge">${entry.calories} cal</div>
        </div>
        <div class="meal-macros">
          <div class="meal-macro">P <span>${entry.protein}g</span></div>
          <div class="meal-macro">C <span>${entry.carbs}g</span></div>
          <div class="meal-macro">F <span>${entry.fat}g</span></div>
        </div>
        ${hasItems ? `
          <button class="meal-toggle" data-idx="${idx}" onclick="toggleItems(this)">
            ▸ show ${entry.items.length} item${entry.items.length > 1 ? 's' : ''}
          </button>
          <div class="meal-items" id="items-${idx}">
            ${itemsHtml}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

window.toggleItems = function(btn) {
  const idx = btn.dataset.idx;
  const items = document.getElementById(`items-${idx}`);
  const open = items.classList.toggle('open');
  btn.textContent = open
    ? `▾ hide items`
    : `▸ show ${items.querySelectorAll('.meal-item-row').length} item${items.querySelectorAll('.meal-item-row').length > 1 ? 's' : ''}`;
};

async function renderDay(dateStr) {
  // Show loading
  document.getElementById('loading').style.display = '';
  document.getElementById('day-view').style.display = 'none';
  document.getElementById('no-data').style.display = 'none';

  const data = await fetchDay(dateStr);

  document.getElementById('loading').style.display = 'none';

  if (!data) {
    document.getElementById('no-data').style.display = '';
    document.getElementById('btn-date').textContent = formatDate(dateStr);
    return;
  }

  document.getElementById('day-view').style.display = '';
  document.getElementById('btn-date').textContent = formatDate(dateStr);

  const { totals, goal_calories, entries, exercise } = data;
  const { calories_in, calories_burned, net, protein, carbs, fat } = totals;

  // Summary cards
  document.getElementById('val-calories-in').textContent = calories_in.toLocaleString();
  document.getElementById('val-goal').textContent = `goal: ${goal_calories.toLocaleString()}`;
  document.getElementById('val-burned').textContent = calories_burned.toLocaleString();
  document.getElementById('val-net').textContent = `net: ${net.toLocaleString()}`;
  document.getElementById('val-protein').textContent = protein;

  // Status banner
  const status = getStatusMessage(calories_in, goal_calories, net);
  const banner = document.getElementById('status-banner');
  banner.textContent = status.text;
  banner.className = `status-banner ${status.cls}`;

  // Macro bars — estimate rough targets
  const proteinTarget = Math.round(goal_calories * 0.25 / 4);  // 25% protein
  const carbTarget    = Math.round(goal_calories * 0.50 / 4);  // 50% carbs
  const fatTarget     = Math.round(goal_calories * 0.25 / 9);  // 25% fat

  document.getElementById('macros-grid').innerHTML =
    renderMacroBar('protein', protein, proteinTarget, 'protein') +
    renderMacroBar('carbs', carbs, carbTarget, 'carbs') +
    renderMacroBar('fat', fat, fatTarget, 'fat');

  // Progress bar
  const pct = clamp(calories_in / goal_calories * 100, 0, 105);
  const bar = document.getElementById('progress-bar');
  bar.style.width = pct + '%';
  bar.className = `progress-bar${pct > 100 ? ' over-goal' : ''}`;
  document.getElementById('progress-label').textContent =
    calories_in <= goal_calories
      ? `${(goal_calories - calories_in).toLocaleString()} to go`
      : `${(calories_in - goal_calories).toLocaleString()} over`;

  // Week chart
  await renderWeekChart(dateStr);

  // Exercise
  renderExercise(exercise);

  // Meals
  renderMeals(entries);

  // Update nav buttons
  const idx = allDates.indexOf(dateStr);
  document.getElementById('btn-prev').disabled = idx <= 0;
  document.getElementById('btn-next').disabled = idx >= allDates.length - 1;
}

// ── Navigation ──
function goTo(dateStr) {
  currentDateIndex = allDates.indexOf(dateStr);
  history.replaceState({}, '', `#${dateStr}`);
  renderDay(dateStr);
}

document.getElementById('btn-prev').addEventListener('click', () => {
  if (currentDateIndex > 0) {
    currentDateIndex--;
    goTo(allDates[currentDateIndex]);
  }
});

document.getElementById('btn-next').addEventListener('click', () => {
  if (currentDateIndex < allDates.length - 1) {
    currentDateIndex++;
    goTo(allDates[currentDateIndex]);
  }
});

// ── Today's date string (local, YYYY-MM-DD) ──
function todayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ── Init ──
async function init() {
  try {
    const index = await fetchIndex();
    allDates = index.dates.sort();

    const today = todayStr();

    // Always include today so nav works even if no data yet
    if (!allDates.includes(today)) {
      allDates.push(today);
      allDates.sort();
    }

    // Check URL hash for a date
    const hash = window.location.hash.replace('#', '');
    let startDate = today; // default: today
    if (hash && allDates.includes(hash)) {
      startDate = hash;
    }

    currentDateIndex = allDates.indexOf(startDate);
    await renderDay(startDate);
  } catch (err) {
    console.error('Failed to load data:', err);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('no-data').style.display = '';
  }
}

init();
