// week.js — the weekly diet, written once. Used by the print sheet (table), the patient export and template previews (list).
import { SLOTS, WEEKDAYS, slotsFor } from './api.js';
import { h } from './ui.js';
import { lineText, slotLines, slotNumbers, dayNumbers, kcalText, macrosText } from './plan-math.js';

const swatch = (slot) => h('span', { class: 'plato-swatch', style: `--swatch: var(--slot-${slot})`, 'aria-hidden': 'true' });
const text = (meals, day, slot) => (meals?.[day]?.[slot] || '').trim();
// What one meal holds: its dishes ("3 × Taco de lomo", from the diet's plan) and the free text.
const has = (meals, plan, day, slot) => !!text(meals, day, slot) || slotLines(plan, day, slot).length > 0;
const content = (meals, plan, day, slot, calc) => {
  const n = slotNumbers(calc, day, slot);
  return [...slotLines(plan, day, slot).map((l) => h('div', { class: 'week-dish', text: lineText(l) })),
    text(meals, day, slot) ? h('div', { class: 'week-text', text: text(meals, day, slot) }) : null,
    n ? h('div', { class: 'week-kcal', text: kcalText(n) }) : null].filter(Boolean);
};
// What one meal holds, for any screen: dishes, free text and (only with calc) its calories.
export const slotContent = (meals, plan, calc, day, slot) => content(meals, plan, day, slot, calc);
export const dayTotalEl = (calc, day) => {
  const t = dayNumbers(calc, day);
  return t ? h('div', { class: 'week-day-total' }, h('strong', { text: 'Total del día' }), h('span', { text: `${kcalText({ kcal: t.total.kcal, free_text: t.free_text })} · ${macrosText(t.total)}` })) : null;
};

// snacks = the diet's snacks a day (0-4): only those rows count and show.
export const hasDiet = (meals, snacks, plan) => WEEKDAYS.some((_, i) => slotsFor(snacks).some(([k]) => has(meals, plan, i + 1, k)));
export const daysFilled = (meals, snacks, plan) => WEEKDAYS.filter((_, i) => slotsFor(snacks).some(([k]) => has(meals, plan, i + 1, k))).length;

// Trim and drop empty meals (what gets saved, and what a template stores). Hidden snack rows keep their text.
export function cleanMeals(meals) {
  const clean = {};
  for (let d = 1; d <= 7; d++) {
    for (const [k] of SLOTS) {
      const v = text(meals, d, k);
      if (v) (clean[d] ||= {})[k] = v;
    }
  }
  return clean;
}

// Landscape sheet: days are columns, meals are rows. Header repeats on every printed page.
export function weekTable(meals, snacks, plan, calc) {
  const table = h('table', { class: 'week-table' },
    h('caption', { class: 'sr-only', text: 'Dieta de la semana' }),
    h('colgroup', {}, h('col', { class: 'week-col-slot' }), ...WEEKDAYS.map(() => h('col', { class: 'week-col-day' }))),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Comida' })),
      ...WEEKDAYS.map((d) => h('th', { scope: 'col', text: d })))),
    h('tbody', {}, ...slotsFor(snacks).map(([key, label]) => h('tr', { dataset: { slot: key } },
      h('th', { scope: 'row' }, swatch(key), h('span', { text: label })),
      ...WEEKDAYS.map((_, i) => {
        const c = content(meals, plan, i + 1, key, calc);
        return h('td', { class: c.length ? '' : 'is-empty' }, ...(c.length ? c : ['—']));
      })))),
    calc && Object.keys(calc.days || {}).length ? h('tfoot', {}, h('tr', { class: 'week-total' }, h('th', { scope: 'row' }, h('span', { text: 'Total del día' })),
      ...WEEKDAYS.map((_, i) => { const t = dayNumbers(calc, i + 1); return h('td', { class: t ? '' : 'is-empty' }, ...(t ? [h('div', { class: 'week-dish', text: kcalText({ kcal: t.total.kcal, free_text: t.free_text }) }), h('div', { class: 'week-macros', text: macrosText(t.total) })] : ['—'])); }))) : null);
  return table;
}

// Portrait list: one block per day, planned meals only.
export function weekList(meals, snacks, plan, calc) {
  return h('div', { class: 'week-list' }, ...WEEKDAYS.map((d, i) => {
    const rows = slotsFor(snacks).filter(([k]) => has(meals, plan, i + 1, k));
    return h('section', { class: 'week-day' },
      h('h3', { text: d }),
      rows.length
        ? h('div', {}, h('dl', {}, ...rows.flatMap(([k, label]) => [h('dt', {}, swatch(k), label), h('dd', {}, ...content(meals, plan, i + 1, k, calc))])), dayTotalEl(calc, i + 1))
        : h('p', { class: 'plato-muted', text: 'Sin comidas en el plan.' }));
  }));
}
