// week.js — the weekly diet, written once. Used by the print sheet (table) and the patient export (list).
import { SLOTS, WEEKDAYS } from './api.js';
import { h } from './ui.js';

const swatch = (slot) => h('span', { class: 'plato-swatch', style: `--swatch: var(--slot-${slot})`, 'aria-hidden': 'true' });
const text = (meals, day, slot) => (meals?.[day]?.[slot] || '').trim();

export const hasDiet = (meals) => WEEKDAYS.some((_, i) => SLOTS.some(([k]) => text(meals, i + 1, k)));

// Landscape sheet: days are columns, meals are rows. Header repeats on every printed page.
export function weekTable(meals) {
  const table = h('table', { class: 'week-table' },
    h('caption', { class: 'sr-only', text: 'Dieta de la semana' }),
    h('colgroup', {}, h('col', { class: 'week-col-slot' }), ...WEEKDAYS.map(() => h('col', { class: 'week-col-day' }))),
    h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, h('span', { class: 'sr-only', text: 'Comida' })),
      ...WEEKDAYS.map((d) => h('th', { scope: 'col', text: d })))),
    h('tbody', {}, ...SLOTS.map(([key, label]) => h('tr', { dataset: { slot: key } },
      h('th', { scope: 'row' }, swatch(key), h('span', { text: label })),
      ...WEEKDAYS.map((_, i) => {
        const t = text(meals, i + 1, key);
        return h('td', { class: t ? '' : 'is-empty', text: t || '—' });
      })))));
  return table;
}
