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
  const today = new Date(); today.setHours(0,0,0,0);
  const diffDays = Math.round((today - dt) / 86400000);
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays <= 6) return dt.toLocaleDateString('en-US', { weekday: 'long' });
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

// ── API config ──
const API_URL = 'https://api.foodz.trevor.fail';

// ── App state ──
let allDates = [];
let currentDateIndex = 0;
let weekDataCache = {};

async function fetchIndex() {
  const res = await fetch(`${API_URL}/dates`);
  return res.json();
}

async function fetchDay(dateStr) {
  if (weekDataCache[dateStr]) return weekDataCache[dateStr];
  try {
    const res = await fetch(`${API_URL}/day/${dateStr}`);
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
  const over = value > max;
  const diff = Math.abs(value - max);
  const diffLabel = over
    ? `${diff}g over`
    : value === max ? 'on target' : `${diff}g to go`;
  return `
    <div class="macro-block">
      <div class="macro-header">
        <span class="macro-name">${name}</span>
        <span class="macro-diff ${over ? 'over' : ''}">${diffLabel}</span>
      </div>
      <div class="macro-track">
        <div class="macro-fill ${className}${over ? ' over' : ''}" style="width: var(--macro-start, 0%)" data-target="${pct}"></div>
      </div>
      <div class="macro-footer">
        <span class="macro-actual">${value}g</span>
        <span class="macro-goal">/ ${max}g</span>
      </div>
    </div>
  `;
}

async function renderWeekChart(currentDate) {
  const container = document.getElementById('week-chart');
  // Past 7 complete days — always exclude today since it's still in progress
  const todayExcluded = allDates.filter(d => d !== todayStr());
  const idx = todayExcluded.indexOf(currentDate) >= 0 ? todayExcluded.indexOf(currentDate) : todayExcluded.length - 1;
  const rangeEnd = idx >= 0 ? idx : todayExcluded.length - 1;
  const rangeDates = todayExcluded.slice(Math.max(0, rangeEnd - 6), rangeEnd + 1);

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

  // Weekly totals — skip days likely missing logs (< 800 cal)
  const MIN_CAL_THRESHOLD = 800; // below this = probably an incomplete log day
  let weekCalIn = 0, weekBurned = 0, weekGoal = 0, weekProtein = 0, weekCarbs = 0, weekFat = 0, daysWithData = 0;
  rangeDates.forEach((d, i) => {
    const e = entries[i];
    if (!e) return;
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
      const avgCalGoal = weekGoal / daysWithData;
      const tgtP = Math.round(avgCalGoal * 0.25 / 4);
      const tgtC = Math.round(avgCalGoal * 0.50 / 4);
      const tgtF = Math.round(avgCalGoal * 0.25 / 9);
      const avgP = Math.round(weekProtein / daysWithData);
      const avgC = Math.round(weekCarbs / daysWithData);
      const avgF = Math.round(weekFat / daysWithData);
      function macroDiff(actual, target) {
        const d = actual - target;
        if (Math.abs(d) < 5) return '';
        return d > 0 ? `<span class="macro-over">+${d}</span>` : `<span class="macro-under">${d}</span>`;
      }
      summaryEl.innerHTML = `
        <div class="week-summary-row">
          <span class="week-summary-label">${daysWithData} day${daysWithData !== 1 ? 's' : ''}</span>
          <span class="week-summary-stats">${weekCalIn.toLocaleString()} in · ${weekBurned.toLocaleString()} burned · goal ${weekGoal.toLocaleString()}</span>
          <span class="week-summary-diff ${diffClass}">${diffLabel}</span>
        </div>
        <div class="week-macro-row">
          <span class="week-macro-label">avg/day</span>
          <span class="week-macro-stat protein-color">P ${avgP}g ${macroDiff(avgP, tgtP)}</span>
          <span class="week-macro-stat carbs-color">C ${avgC}g ${macroDiff(avgC, tgtC)}</span>
          <span class="week-macro-stat fat-color">F ${avgF}g ${macroDiff(avgF, tgtF)}</span>
        </div>
      `;
    } else {
      summaryEl.style.display = 'none';
    }
  }
}

function renderExercise(exercise, dateStr) {
  const section = document.getElementById('exercise-section');
  const list = document.getElementById('exercise-list');

  if (!exercise || exercise.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = '';
  list.innerHTML = exercise.map((ex, idx) => `
    <div class="exercise-item">
      <div>
        <div class="exercise-name">
          ${ex.activity}
          <button class="entry-delete-btn meal-title-delete" onclick="deleteExercise('${dateStr}', ${idx})" title="delete">×</button>
        </div>
        <div class="exercise-meta">${ex.duration_minutes} min${ex.notes ? ' · ' + ex.notes : ''}</div>
      </div>
      <div class="exercise-cal">-${ex.calories_burned} cal</div>
    </div>
  `).join('');
}

window.deleteExercise = async function(dateStr, idx) {
  if (!confirm('remove this exercise entry?')) return;
  try {
    const res = await fetch(`${API_URL}/day/${dateStr}/exercise/${idx}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed');
    delete weekDataCache[dateStr];
    renderDay(dateStr);
  } catch (err) {
    alert('error: ' + err.message);
  }
};

window.deleteMealEntry = async function(dateStr, idx) {
  if (!confirm('remove this meal entry?')) return;
  try {
    const res = await fetch(`${API_URL}/day/${dateStr}/entries/${idx}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed');
    delete weekDataCache[dateStr];
    renderDay(dateStr);
  } catch (err) {
    alert('error: ' + err.message);
  }
};

window.deleteMealItem = async function(dateStr, entryIdx, itemIdx) {
  if (!confirm('remove this item?')) return;
  try {
    const res = await fetch(`${API_URL}/day/${dateStr}/entries/${entryIdx}/items/${itemIdx}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('delete failed');
    delete weekDataCache[dateStr];
    renderDay(dateStr);
  } catch (err) {
    alert('error: ' + err.message);
  }
};

// Track current date for delete handlers
let currentDate = '';

function renderMeals(entries) {
  const container = document.getElementById('meals-list');
  container.innerHTML = entries.map((entry, idx) => {
    const emoji = getMealEmoji(entry.meal);
    const hasItems = entry.items && entry.items.length > 0;
    const itemsHtml = hasItems ? entry.items.map((item, itemIdx) => `
      <div class="meal-item-row">
        <div class="meal-item-name">
          ${item.name}
          <button class="item-delete-btn" onclick="deleteMealItem(currentDate, ${idx}, ${itemIdx})" title="remove item">×</button>
        </div>
        <div class="meal-item-right">
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
              <button class="entry-delete-btn meal-title-delete" onclick="deleteMealEntry(currentDate, ${idx})" title="delete">×</button>
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
    // Update nav buttons even when no data (fixes prev/next state being stale)
    const noDataIdx = allDates.indexOf(dateStr);
    document.getElementById('btn-prev').disabled = noDataIdx <= 0;
    document.getElementById('btn-next').disabled = noDataIdx >= allDates.length - 1 || dateStr >= todayStr();

    const isToday = dateStr === todayStr();
    const noDataEl = document.getElementById('no-data');
    noDataEl.querySelector('p').textContent = isToday ? 'nothing logged yet today' : 'no data for this day';
    noDataEl.querySelector('small').textContent = isToday ? 'log something in #foodz 🍜' : 'try another date';
    noDataEl.style.display = '';
    document.getElementById('btn-date').textContent = formatDate(dateStr);
    return;
  }

  document.getElementById('day-view').style.display = '';
  document.getElementById('btn-date').textContent = formatDate(dateStr);
  currentDate = dateStr;

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

  // Capture current macro widths before replacing HTML so we can animate from them
  const prevMacroWidths = {};
  document.querySelectorAll('.macro-fill[data-target]').forEach(el => {
    const cls = [...el.classList].find(c => ['protein','carbs','fat'].includes(c));
    if (cls) prevMacroWidths[cls] = el.getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width * 100;
  });

  const macroGrid = document.getElementById('macros-grid');
  macroGrid.innerHTML =
    renderMacroBar('protein', protein, proteinTarget, 'protein') +
    renderMacroBar('carbs', carbs, carbTarget, 'carbs') +
    renderMacroBar('fat', fat, fatTarget, 'fat');

  // Set starting width to previous value (or 0 on first load), then animate to target
  macroGrid.querySelectorAll('.macro-fill[data-target]').forEach(el => {
    const cls = [...el.classList].find(c => ['protein','carbs','fat'].includes(c));
    const startPct = prevMacroWidths[cls] ?? 0;
    el.style.width = startPct + '%';
    requestAnimationFrame(() => {
      el.style.width = el.dataset.target + '%';
    });
  });

  // Progress bar
  const pct = clamp(calories_in / goal_calories * 100, 0, 105);
  const bar = document.getElementById('progress-bar');
  bar.style.width = pct + '%';
  bar.className = `progress-bar${pct > 100 ? ' over-goal' : ''}`;
  document.getElementById('progress-label').textContent =
    calories_in <= goal_calories
      ? `${(goal_calories - calories_in).toLocaleString()} to go`
      : `${(calories_in - goal_calories).toLocaleString()} over`;
  document.getElementById('progress-cal-in').textContent = `${calories_in.toLocaleString()} cal`;
  document.getElementById('progress-cal-goal').textContent = `/ ${goal_calories.toLocaleString()}`;

  // Week chart
  await renderWeekChart(dateStr);

  // Exercise
  renderExercise(exercise, dateStr);

  // Meals
  renderMeals(entries);

  // Update nav buttons
  const idx = allDates.indexOf(dateStr);
  document.getElementById('btn-prev').disabled = idx <= 0;
  document.getElementById('btn-next').disabled = idx >= allDates.length - 1 || dateStr >= todayStr();
}

// ── Log Queue ──

let queueIdCounter = 0;

function addQueueItem(text) {
  const id = ++queueIdCounter;
  const queue = document.getElementById('log-queue');
  const truncated = text.length > 48 ? text.slice(0, 48) + '…' : text;
  const el = document.createElement('div');
  el.className = 'queue-item queue-item--processing';
  el.id = `qi-${id}`;
  el.innerHTML = `<div class="qi-spinner"></div><span class="qi-text">${truncated}</span>`;
  queue.appendChild(el);
  return id;
}

function resolveQueueItem(id, success, message) {
  const el = document.getElementById(`qi-${id}`);
  if (!el) return;
  el.className = `queue-item queue-item--${success ? 'success' : 'error'}`;
  el.innerHTML = `<span class="qi-icon">${success ? '✓' : '⚠'}</span><span class="qi-text">${message}</span>`;
  setTimeout(() => {
    el.classList.add('queue-item--fade');
    setTimeout(() => el.remove(), 400);
  }, 3000);
}

// ── Log Modal ──

function openLogModal() {
  const modal = document.getElementById('log-modal');
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => document.getElementById('log-textarea').focus(), 50);
}

function closeLogModal() {
  const modal = document.getElementById('log-modal');
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  setLogStatus('', '');
}

function setLogStatus(cls, text) {
  const el = document.getElementById('log-status');
  el.className = 'log-input-status' + (cls ? ' ' + cls : '');
  if (cls === 'processing') {
    el.innerHTML = `<div class="log-spinner"></div><span>${text}</span>`;
  } else {
    el.textContent = text;
  }
}

async function fetchDatesAndSync() {
  try {
    const index = await fetchIndex();
    index.dates.sort().forEach(d => {
      if (!allDates.includes(d)) allDates.push(d);
    });
    allDates.sort();
  } catch {}
}

function initLogInput() {
  const btn = document.getElementById('log-submit-btn');
  const textarea = document.getElementById('log-textarea');
  const openBtn = document.getElementById('btn-log-open');
  const closeBtn = document.getElementById('btn-log-close');
  const backdrop = document.getElementById('log-modal-backdrop');

  openBtn.addEventListener('click', openLogModal);
  closeBtn.addEventListener('click', closeLogModal);
  backdrop.addEventListener('click', closeLogModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLogModal();
  });

  btn.addEventListener('click', submitLog);
  textarea.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      submitLog();
    }
  });
}

async function submitLog() {
  const textarea = document.getElementById('log-textarea');
  const btn = document.getElementById('log-submit-btn');
  const text = textarea.value.trim();
  if (!text || btn.disabled) return;

  const queueId = addQueueItem(text);
  const date = allDates[currentDateIndex] || todayStr();

  // Close modal immediately — queue at top shows progress
  textarea.value = '';
  setLogStatus('', '');
  btn.disabled = false;
  closeLogModal();

  // Process in background
  try {
    const res = await fetch(`${API_URL}/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, date })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'failed');

    // Build a detailed summary from returned data
    const parts = [];
    if (data.edits && data.edits.length > 0) {
      parts.push('updated: ' + data.edits.join('; '));
    }
    if (data.entries && data.entries.length > 0) {
      parts.push(data.entries.map(e => {
        const itemList = e.items && e.items.length > 0
          ? e.items.map(i => `${i.name} ${i.calories}cal`).join(', ')
          : null;
        return `${e.meal}: ${e.calories} cal${itemList ? ' (' + itemList + ')' : ''}`;
      }).join(' · '));
    }
    if (data.exercise && data.exercise.length > 0) {
      parts.push(data.exercise.map(ex => `${ex.activity}: -${ex.calories_burned} cal`).join(' · '));
    }
    if (data.totals) {
      const goal = data.goal_calories || 2200;
      const net = data.totals.net || data.totals.calories_in || 0;
      const remaining = goal - net;
      parts.push(`${net} cal net · ${remaining >= 0 ? remaining + ' remaining' : Math.abs(remaining) + ' over'}`);
    }
    const summary = parts.join(' — ') || 'logged';

    resolveQueueItem(queueId, true, summary);
    delete weekDataCache[date];
    // Use returned day data to update cache if available, avoiding a re-fetch
    if (data.day) weekDataCache[date] = data.day;
    renderDay(date);
    fetchDatesAndSync();
  } catch (err) {
    resolveQueueItem(queueId, false, err.message);
  }
}

// ── Navigation ──
function goTo(dateStr) {
  currentDateIndex = allDates.indexOf(dateStr);
  history.pushState({ date: dateStr }, '', `?date=${dateStr}`);
  renderDay(dateStr);
}

window.addEventListener('popstate', (e) => {
  const date = (e.state && e.state.date) || todayStr();
  currentDateIndex = allDates.indexOf(date);
  if (currentDateIndex < 0 && allDates.length > 0) currentDateIndex = allDates.length - 1;
  renderDay(allDates[currentDateIndex] || date);
});

document.getElementById('btn-prev').addEventListener('click', () => {
  if (currentDateIndex > 0) {
    currentDateIndex--;
    goTo(allDates[currentDateIndex]);
  }
});

document.getElementById('btn-next').addEventListener('click', () => {
  if (currentDateIndex < allDates.length - 1 && allDates[currentDateIndex] < todayStr()) {
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

    // Check URL query string for a date (?date=YYYY-MM-DD)
    const params = new URLSearchParams(window.location.search);
    const queryDate = params.get('date');
    let startDate = today; // default: today
    if (queryDate && /^\d{4}-\d{2}-\d{2}$/.test(queryDate)) {
      startDate = queryDate;
      // include even if not in allDates (will show no-data state)
      if (!allDates.includes(startDate)) {
        allDates.push(startDate);
        allDates.sort();
      }
    }

    currentDateIndex = allDates.indexOf(startDate);
    // Seed the initial history state so popstate works on browser back
    history.replaceState({ date: startDate }, '', `?date=${startDate}`);
    await renderDay(startDate);
  } catch (err) {
    console.error('Failed to load data:', err);
    document.getElementById('loading').style.display = 'none';
    document.getElementById('no-data').style.display = '';
  }
}

init();
initLogInput();
