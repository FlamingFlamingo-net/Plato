// week.js — the weekly diet, written once. Used by the print sheet (table), the patient export and template previews (list).
import { SLOTS, WEEKDAYS, slotsFor } from './api.js';
import { h } from './ui.js';

const swatch = (slot) => h('span', { class: 'plato-swatch', style: `--swatch: var(--slot-${slot})`, 'aria-hidden': 'true' });
const text = (meals, day, slot) => (meals?.[day]?.[slot] || '').trim();

// snacks = the diet's snacks a day (0-4): only those rows count and show.
export const hasDiet = (meals, snacks) => WEEKDAYS.some((_, i) => slotsFor(snacks).some(([k]) => text(meals, i + 1, k)));
export const daysFilled = (meals, snacks) => WEEKDAYS.filter((_, i) => slotsFor(snacks).some(([k]) => text(meals, i + 1, k))).length;

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
export function weekTable(meals, snacks) {
  const table = h('table', { class: 'week-table' },
    h('caption', { class: 'sr-only', text: 'Dieta de la semana' }),
    h('colgroup', {}, h('col', { class: 'week-col-slot' }), ...WEEKDAYS.map(() => h('col', { class: 'week-col-day' }))),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Comida' })),
      ...WEEKDAYS.map((d) => h('th', { scope: 'col', text: d })))),
    h('tbody', {}, ...slotsFor(snacks).map(([key, label]) => h('tr', { dataset: { slot: key } },
      h('th', { scope: 'row' }, swatch(key), h('span', { text: label })),
      ...WEEKDAYS.map((_, i) => {
        const t = text(meals, i + 1, key);
        return h('td', { class: t ? '' : 'is-empty', text: t || '—' });
      })))));
  return table;
}

// Portrait list: one block per day, planned meals only.
export function weekList(meals, snacks) {
  return h('div', { class: 'week-list' }, ...WEEKDAYS.map((d, i) => {
    const rows = slotsFor(snacks).filter(([k]) => text(meals, i + 1, k));
    return h('section', { class: 'week-day' },
      h('h3', { text: d }),
      rows.length
        ? h('dl', {}, ...rows.flatMap(([k, label]) => [h('dt', {}, swatch(k), label), h('dd', { text: text(meals, i + 1, k) })]))
        : h('p', { class: 'plato-muted', text: 'Sin comidas en el plan.' }));
  }));
}
