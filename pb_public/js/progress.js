// progress.js — the patient's measurements and weight chart (read-only).
import { list, q, dateOnly } from './api.js';
import { h, shortDate, num } from './ui.js';
import { weightChart } from './charts.js';
import { patientShell } from './shell.js';

const { me } = await patientShell('progress');
const statusEl = document.getElementById('status');

try {
  const ms = await list('measurements', { filter: `patient = ${q(me.id)}`, sort: 'date,created' });
  statusEl.textContent = ms.length ? '' : 'Aún no hay mediciones. Tu nutrióloga o nutriólogo las agrega en tu consulta.';
  const first = ms[0], last = ms.at(-1);
  const stat = (label, value) => h('div', { class: 'plato-stat' }, h('span', { text: label }), h('strong', { text: value }));
  const diff = last && first !== last ? last.weight_kg - first.weight_kg : null;
  document.getElementById('stats').replaceChildren(
    stat('Peso actual', last ? `${num(last.weight_kg)} kg` : '—'),
    stat('Desde el inicio', diff != null ? `${diff > 0 ? '+' : ''}${num(diff)} kg` : '—'),
    stat('Cintura', last?.waist_cm ? `${num(last.waist_cm)} cm` : '—'),
  );
  document.getElementById('chart').replaceChildren(weightChart(ms, { width: 480, height: 220 }));
  document.getElementById('rows').replaceChildren(...[...ms].reverse().map((m) => h('tr', {},
    h('td', { text: shortDate(dateOnly(m.date)) }),
    h('td', { class: 'num', text: `${num(m.weight_kg)} kg` }),
    h('td', { class: 'num', text: m.body_fat_pct ? `${num(m.body_fat_pct)} %` : '—' }),
    h('td', { class: 'num', text: m.waist_cm ? `${num(m.waist_cm)} cm` : '—' }))));
} catch (e) {
  statusEl.textContent = e.message;
}
