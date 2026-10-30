// goals.js — weekly goals (spec "Feature: Weekly goals", slice 2), shared by Hoy, Progreso, the patient page,
// the patient list and Inicio. Weeks run Monday to Sunday by the log's date (the patient's local day).
// Meal goal: a day counts when ALL that day's planned meals are checked (photo or not; extras never count).
//   A day with nothing planned can't count and shows as "sin plan", never as a miss (spec "Snacks per diet").
//   Weeks from before that change keep their old rule: N meals a day (their history entry holds the number).
// Activity goal: a day counts when that day's minutes add up to the daily minutes.
// The goal of a past week is the one in force that Monday (goal_history); weeks before the first entry have none.
import { list, q, isoWeekday, localDate, plannedSlots } from './api.js';
import { h, num } from './ui.js';

export const SERVICE_LABEL = { nutrition: 'Nutrición', training: 'Entrenamiento', both: 'Nutrición + entrenamiento' };
export const hasNutrition = (s) => s === 'nutrition' || s === 'both';
export const hasTraining = (s) => s === 'training' || s === 'both';

const toDate = (ymd) => new Date(`${ymd}T12:00:00`);
export const addDays = (ymd, n) => { const d = toDate(ymd); d.setDate(d.getDate() + n); return localDate(d); };
export const mondayOf = (ymd = localDate()) => addDays(ymd, -(isoWeekday(toDate(ymd)) - 1));
export const weekDays = (monday) => Array.from({ length: 7 }, (_, i) => addDays(monday, i));
const DAY_LETTER = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
const DAY_NAME = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

// Goals in force on a week's Monday. null = no record yet for that week.
export function goalFor(patient, monday) {
  const hist = Array.isArray(patient.goal_history) ? patient.goal_history : [];
  let g = null;
  for (const e of hist) if (e && e.from <= monday) g = e;
  if (!g && monday >= mondayOf()) {   // this week, history not written yet: today's values
    g = { from: monday, service: patient.service, meal_days: patient.meal_goal_days, meal_per_day: 'all',
      act_days: patient.activity_goal_days, act_min: patient.activity_goal_min };
  }
  return g;
}

// What one patient did, per day: { meals: {ymd: Set(slots)}, minutes: {ymd: n}, sessions, km }.
export function indexLogs(meals, acts) {
  const m = {}, min = {};
  for (const l of meals) if (l.slot !== 'extra') (m[l.date] ||= new Set()).add(l.slot);
  for (const a of acts) min[a.date] = (min[a.date] || 0) + (Number(a.minutes) || 0);
  return { meals: m, minutes: min, acts };
}

const plannedOn = (diet, ymd) => plannedSlots(diet, diet?.meals?.[isoWeekday(toDate(ymd))]).map(([k]) => k);

// One week for one goal kind. Returns { goal: {days, per}|null, days: [{ymd, state, value, need}], met, total }.
export function weekOf(kind, patient, diet, idx, monday) {
  const g = goalFor(patient, monday);
  const goal = !g ? null : kind === 'meal'
    ? (g.meal_days > 0 ? { days: g.meal_days, per: g.meal_per_day } : null)
    : (g.act_days > 0 ? { days: g.act_days, per: g.act_min } : null);
  const days = weekDays(monday).map((ymd) => {
    if (kind === 'meal') {
      const planned = plannedOn(diet, ymd);
      const done = idx.meals[ymd] || new Set();
      const value = planned.length ? planned.filter((s) => done.has(s)).length : done.size;
      if (goal && typeof goal.per !== 'number') {   // "all planned meals"
        if (!planned.length) return { ymd, value, need: 0, planned: 0, state: 'noplan' };
        return { ymd, value, need: planned.length, planned: planned.length, state: value >= planned.length ? 'met' : value > 0 ? 'active' : 'none' };
      }
      const need = goal ? (planned.length ? Math.min(goal.per, planned.length) : goal.per) : 0;
      return { ymd, value, need, planned: planned.length, state: goal && value >= need ? 'met' : value > 0 ? 'active' : 'none' };
    }
    const value = idx.minutes[ymd] || 0;
    const need = goal ? goal.per : 0;
    return { ymd, value, need, state: goal && value >= need ? 'met' : value > 0 ? 'active' : 'none' };
  });
  const met = days.filter((d) => d.state === 'met').length;
  return { goal, days, met, total: days.reduce((n, d) => n + d.value, 0) };
}

// Fetch what the goals need for one patient: diet + meal and activity logs since `fromMonday`.
export async function loadGoalData(patientId, fromMonday) {
  const f = `patient = ${q(patientId)} && date >= ${q(fromMonday)}`;
  const [[diet], meals, acts] = await Promise.all([
    list('diets', { filter: `patient = ${q(patientId)}`, fields: 'meals,snacks' }),
    list('meal_logs', { filter: f, fields: 'date,slot', perPage: 500 }),
    list('activity_logs', { filter: f, fields: 'date,minutes,distance_km', perPage: 500 }),
  ]);
  return { diet, idx: indexLogs(meals, acts) };
}

// Which goal rows to show: a goal that is on, or a service that includes it (then totals only).
export const kindsFor = (p) => [
  ...(p.meal_goal_days > 0 || hasNutrition(p.service) ? ['meal'] : []),
  ...(p.activity_goal_days > 0 || hasTraining(p.service) ? ['act'] : []),
];

export function goalText(kind, goal) {
  if (!goal) return 'Sin meta';
  const d = `${goal.days} ${goal.days === 1 ? 'día' : 'días'} a la semana`;
  if (kind === 'meal' && typeof goal.per !== 'number') return `todas las de tu plan, ${d}`;
  return kind === 'meal'
    ? `${goal.per} ${goal.per === 1 ? 'comida' : 'comidas'} al día, ${goal.days} ${goal.days === 1 ? 'día' : 'días'} a la semana`
    : `${goal.per} min al día, ${goal.days} ${goal.days === 1 ? 'día' : 'días'} a la semana`;
}

function dots(kind, week, today) {
  return h('ol', { class: 'plato-week-dots', 'aria-hidden': 'true' }, ...week.days.map((d, i) =>
    h('li', { class: `is-${d.state}${d.ymd === today ? ' is-today' : ''}`, title: `${DAY_NAME[i]}: ${dayLabel(kind, d)}` },
      h('span', { class: 'plato-week-dot' }), h('span', { class: 'plato-week-letter', text: DAY_LETTER[i] }))));
}
const dayLabel = (kind, d) => d.state === 'noplan' ? 'sin plan ese día' : kind === 'meal'
  ? `${d.value}${d.need ? ` de ${d.need}` : ''} ${d.value === 1 && !d.need ? 'comida' : 'comidas'}`
  : `${d.value}${d.need ? ` de ${d.need}` : ''} min`;

// Neutral words, never guilt (spec: "Vas bien", "¡Meta de la semana cumplida!").
function mood(week, todayIdx) {
  if (!week.goal) return '';
  if (week.met >= week.goal.days) return '¡Meta de la semana cumplida!';
  const left = week.goal.days - week.met, daysLeft = 7 - todayIdx;
  if (week.met === 0 && todayIdx === 0) return 'La semana empieza hoy.';
  return left <= daysLeft ? 'Vas bien. Cada día cuenta.' : 'Esta semana va así; la próxima es nueva.';
}

// "Tu semana" rows for one patient (who = 'patient' words "tú"; 'nutri' words in third person).
export function weekCard(patient, data, { who = 'patient', today = localDate() } = {}) {
  const monday = mondayOf(today);
  const todayIdx = weekDays(monday).indexOf(today);
  const rows = kindsFor(patient).map((kind) => {
    const w = weekOf(kind, patient, data.diet, data.idx, monday);
    const t = w.days[todayIdx] || { value: 0, need: 0 };
    const title = kind === 'meal' ? 'Comidas' : 'Actividad';
    const head = w.goal ? `${w.met} de ${w.goal.days} ${w.goal.days === 1 ? 'día' : 'días'}` : 'Sin meta';
    const sr = w.goal
      ? `${title}: ${w.met} de ${w.goal.days} días cumplidos esta semana. ${w.days.map((d, i) => `${DAY_NAME[i]} ${d.state === 'met' ? 'cumplido' : d.state === 'active' ? 'activo' : d.state === 'noplan' ? 'sin plan' : 'sin registro'}`).join(', ')}.`
      : `${title}: sin meta.`;
    const actWeek = kind === 'act' ? data.idx.acts.filter((a) => a.date >= monday && a.date <= weekDays(monday)[6]) : [];
    const totals = kind === 'act'
      ? `Esta semana: ${num(w.total, 0)} min · ${actWeek.length} ${actWeek.length === 1 ? 'sesión' : 'sesiones'}`
      : `Esta semana: ${w.total} ${w.total === 1 ? 'comida marcada' : 'comidas marcadas'}`;
    const todayLine = w.goal
      ? (kind === 'meal' ? (t.state === 'noplan' ? 'Hoy: sin plan' : `Hoy: ${t.value} de ${t.need} ${t.need === 1 ? 'comida' : 'comidas'}`) : `Hoy: ${t.value} de ${t.need} min`)
      : (kind === 'meal' ? `Hoy: ${t.value} ${t.value === 1 ? 'comida' : 'comidas'}` : `Hoy: ${t.value} min`);
    return h('div', { class: `plato-week-row${w.goal && w.met >= w.goal.days ? ' is-done' : ''}`, dataset: { kind } },
      h('div', { class: 'plato-week-head' },
        h('strong', { text: title }),
        h('span', { class: 'plato-week-count', text: head })),
      h('p', { class: 'sr-only', text: sr }),
      dots(kind, w, today),
      h('p', { class: 'plato-week-line' }, h('span', { text: todayLine }), h('span', { class: 'plato-muted', text: totals })),
      w.goal ? h('p', { class: 'plato-week-mood', text: mood(w, todayIdx) }) : null,
      w.goal && who === 'patient' ? h('p', { class: 'plato-muted plato-small', style: 'margin:0', text: `Tu meta: ${goalText(kind, w.goal)}.` }) : null);
  });
  return rows;
}

// 8-week bars (days met per week) with each week's goal as a line, plus the same data as a table.
export function weeklyChart(kind, patient, data, { weeks = 8, today = localDate() } = {}) {
  const last = mondayOf(today);
  const list8 = Array.from({ length: weeks }, (_, i) => addDays(last, -7 * (weeks - 1 - i)))
    .map((m) => ({ monday: m, ...weekOf(kind, patient, data.diet, data.idx, m) }));
  const W = 320, Hh = 150, pad = { l: 22, r: 6, t: 8, b: 22 }, bw = (W - pad.l - pad.r) / weeks;
  const y = (v) => pad.t + (Hh - pad.t - pad.b) * (1 - v / 7);
  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  const title = kind === 'meal' ? 'Comidas: días cumplidos por semana' : 'Actividad: días cumplidos por semana';
  const svg = s('svg', { viewBox: `0 0 ${W} ${Hh}`, class: 'plato-week-chart', role: 'img', 'aria-label': `${title}, últimas ${weeks} semanas. Los datos están en la tabla.` });
  for (const v of [0, 7]) {
    svg.append(s('line', { x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v), class: 'grid' }));
    const tx = s('text', { x: pad.l - 5, y: y(v) + 3, 'text-anchor': 'end', class: 'axis' }); tx.textContent = String(v); svg.append(tx);
  }
  list8.forEach((w, i) => {
    const x = pad.l + i * bw;
    const met = w.goal && w.met >= w.goal.days;
    svg.append(s('rect', { x: x + bw * 0.18, width: bw * 0.64, y: y(w.met), height: Math.max(0, y(0) - y(w.met)), rx: 2, class: met ? 'bar is-met' : 'bar' }));
    if (w.goal) svg.append(s('line', { x1: x + 2, x2: x + bw - 2, y1: y(w.goal.days), y2: y(w.goal.days), class: 'goal' }));
    const tx = s('text', { x: x + bw / 2, y: Hh - 6, 'text-anchor': 'middle', class: 'axis' });
    tx.textContent = w.monday.slice(8, 10) + '/' + w.monday.slice(5, 7); svg.append(tx);
  });
  const unit = kind === 'meal' ? 'Comidas marcadas' : 'Minutos';
  const table = h('table', { class: 'table plato-week-table' },
    h('caption', { class: 'sr-only', text: title }),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col', text: 'Semana' }), h('th', { scope: 'col', text: 'Días cumplidos' }), h('th', { scope: 'col', text: 'Meta' }), h('th', { scope: 'col', text: unit }))),
    h('tbody', {}, ...list8.slice().reverse().map((w) => h('tr', {},
      h('td', { text: `${w.monday.slice(8, 10)}/${w.monday.slice(5, 7)}` }),
      h('td', { text: w.goal ? `${w.met} de ${w.goal.days}` : String(w.met) }),
      h('td', { text: w.goal ? goalText(kind, w.goal) : 'Sin meta' }),
      h('td', { text: num(w.total, 0) })))));
  return { svg, table, weeks: list8 };
}

// Two side-by-side toggle cards (spec: Nutrición left, preselected; Entrenamiento right; at least one stays on).
export function serviceCards(name, service = 'nutrition') {
  const card = (key, label, line, on) => {
    const input = h('input', { type: 'checkbox', name, value: key, checked: on, class: 'plato-service-input' });
    return h('label', { class: 'plato-service-card' }, input,
      h('span', { class: 'plato-service-body' }, h('strong', { text: label }), h('small', { text: line })),
      h('span', { class: 'plato-service-tick', 'aria-hidden': 'true' }));
  };
  const hint = h('p', { class: 'plato-muted plato-small plato-service-hint', 'aria-live': 'polite' });
  const box = h('fieldset', { class: 'plato-service' },
    h('legend', { text: 'Servicio' }),
    h('div', { class: 'plato-service-cards' },
      card('nutrition', 'Nutrición', 'Dieta semanal y registro de comidas', hasNutrition(service)),
      card('training', 'Entrenamiento', 'Actividad física y metas de ejercicio', hasTraining(service))),
    hint);
  const inputs = [...box.querySelectorAll('input')];
  for (const i of inputs) {
    i.addEventListener('change', () => {
      if (!inputs.some((x) => x.checked)) {
        i.checked = true;
        hint.textContent = 'Elige al menos un servicio.';
      } else hint.textContent = '';
      box.dispatchEvent(new Event('servicechange', { bubbles: true }));
    });
  }
  box.value = () => (inputs[0].checked && inputs[1].checked ? 'both' : inputs[1].checked ? 'training' : 'nutrition');
  return box;
}
