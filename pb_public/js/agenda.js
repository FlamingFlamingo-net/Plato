// agenda.js — the nutritionist's calendar (spec "Feature: Agenda — the nutritionist's own calendar", slice 1).
// Month grid (Monday first), dots on days with appointments, Hoy / Semana / Mes counts, and the selected day's list.
// ?day=YYYY-MM-DD opens a day; ?new=1&patient=ID opens "Nueva cita" for that patient.
import { requireRole, list, signOut, localDate } from './api.js';
import { h, icon, offlineBanner } from './ui.js';
import { mondayOf, addDays } from './goals.js';
import { loadRange, notesFor, appointmentDialog, cancelAppointment, deleteAppointment, timeRange, timeOf, dayKey } from './appointments.js';

offlineBanner();
const me = await requireRole('nutritionists');
document.getElementById('sign-out').addEventListener('click', signOut);

const params = new URL(location.href).searchParams;
const today = localDate();
let selected = /^\d{4}-\d{2}-\d{2}$/.test(params.get('day') || '') ? params.get('day') : today;
let month = selected.slice(0, 7);                   // YYYY-MM shown
let appts = [];                                      // the shown grid's range
let notes = {};
let patients = [];
const statusEl = document.getElementById('status');
const initials = (s) => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const monthName = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' });
const dayLong = new Intl.DateTimeFormat('es-MX', { weekday: 'long' });
const dayFull = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
const dayShort = new Intl.DateTimeFormat('es-MX', { weekday: 'short' });
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const asDate = (ymd) => new Date(`${ymd}T12:00:00`);

// Grid: Monday before (or on) the 1st, 6 weeks.
const gridStart = () => mondayOf(`${month}-01`);
const gridEnd = () => addDays(gridStart(), 41);

async function load() {
  try {
    [appts, patients] = await Promise.all([
      loadRange(gridStart(), gridEnd()),
      patients.length ? patients : list('patients', { filter: 'archived_at = ""', fields: 'id,name', sort: 'name', perPage: 500 }),
    ]);
    notes = await notesFor(appts.map((a) => a.id));
    statusEl.textContent = '';
  } catch (e) { statusEl.textContent = e.message; appts = []; }
  render();
}

const active = () => appts.filter((a) => !a.cancelled_at);
const byDay = () => active().reduce((m, a) => ((m[dayKey(a.starts_at)] ||= []).push(a), m), {});

function render() {
  document.getElementById('cal-title').textContent = cap(monthName.format(asDate(`${month}-15`)));
  const counts = byDay();
  const grid = document.getElementById('grid');
  const head = h('div', { role: 'row', class: 'plato-cal-row plato-cal-dow' },
    ...['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((d, i) => h('span', { role: 'columnheader', 'aria-label': ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'][i], text: d })));
  const rows = [];
  for (let w = 0; w < 6; w++) {
    rows.push(h('div', { role: 'row', class: 'plato-cal-row' }, ...Array.from({ length: 7 }, (_, i) => {
      const ymd = addDays(gridStart(), w * 7 + i);
      const n = (counts[ymd] || []).length;
      const label = `${cap(dayLong.format(asDate(ymd)))} ${dayFull.format(asDate(ymd))}${n ? `, ${n} ${n === 1 ? 'cita' : 'citas'}` : ', sin citas'}${ymd === today ? ', hoy' : ''}`;
      return h('button', {
        type: 'button', role: 'gridcell', class: `plato-cal-day${ymd.slice(0, 7) !== month ? ' is-out' : ''}${ymd === today ? ' is-today' : ''}`,
        'aria-selected': String(ymd === selected), tabindex: ymd === selected ? '0' : '-1', 'aria-label': label, dataset: { day: ymd },
        onclick: () => pick(ymd, false),
      }, h('span', { text: String(Number(ymd.slice(8))) }), n ? h('span', { class: 'plato-cal-dot', 'aria-hidden': 'true' }) : null);
    })));
  }
  grid.replaceChildren(head, ...rows);

  const wk = mondayOf(today), wkEnd = addDays(wk, 6);
  const c = { hoy: 0, semana: 0, mes: 0 };
  for (const a of active()) {
    const d = dayKey(a.starts_at);
    if (d === today) c.hoy++;
    if (d >= wk && d <= wkEnd) c.semana++;
    if (d.slice(0, 7) === today.slice(0, 7)) c.mes++;
  }
  const inRange = today >= gridStart() && today <= gridEnd();
  document.getElementById('counts').replaceChildren(...(inRange ? [['Hoy', c.hoy], ['Esta semana', c.semana], ['Este mes', c.mes]] : [])
    .map(([l, n]) => h('div', {}, h('strong', { text: String(n) }), h('span', { text: l }))));
  document.getElementById('counts').hidden = !inRange;
  renderDay();
}

function renderDay() {
  const d = asDate(selected);
  const badge = document.getElementById('day-badge');
  badge.querySelector('small').textContent = dayShort.format(d).replace('.', '').toUpperCase();
  badge.querySelector('strong').textContent = String(d.getDate());
  badge.classList.toggle('is-today', selected === today);
  document.getElementById('day-title').textContent = cap(dayLong.format(d));
  document.getElementById('day-sub').textContent = dayFull.format(d);
  const items = appts.filter((a) => dayKey(a.starts_at) === selected);
  const listEl = document.getElementById('day-list');
  if (!items.length) {
    listEl.replaceChildren(h('li', { class: 'plato-appts-empty' },
      h('span', { text: selected < today ? 'No hubo citas este día.' : 'No hay citas este día.' }),
      selected >= today ? h('button', { class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', type: 'button', onclick: () => openNew({ day: selected }) }, 'Agendar una cita') : null));
    return;
  }
  listEl.replaceChildren(...items.map((a) => {
    const p = a.expand?.patient;
    const n = notes[a.id];
    return h('li', { class: `plato-appt${a.cancelled_at ? ' is-cancelled' : ''}`, dataset: { id: a.id } },
      h('div', { class: 'plato-appt-time' }, h('strong', { text: timeOf(a.starts_at) }), h('small', { text: `${a.duration_min} min` })),
      h('span', { class: 'plato-avatar plato-avatar--sm', 'aria-hidden': 'true', text: initials(p?.name) }),
      h('div', { class: 'plato-appt-body' },
        h('p', { class: 'plato-appt-line' }, 'Cita ', h('span', { class: 'sr-only', text: `de ${timeRange(a)} ` }), 'con ',
          p ? h('a', { href: `/patient.html?id=${encodeURIComponent(p.id)}`, text: p.name }) : h('span', { text: 'paciente' })),
        h('div', { class: 'plato-row' },
          h('span', { class: 'badge plato-appt-type', text: a.type }),
          a.cancelled_at ? h('span', { class: 'badge', 'data-variant': 'destructive', text: 'Cancelada' }) : null),
        n?.text ? h('p', { class: 'plato-appt-note' }, icon('lock', 13), h('span', { text: n.text })) : null),
      h('div', { class: 'plato-appt-actions' },
        a.cancelled_at
          ? h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', 'aria-label': `Borrar la cita cancelada de ${p?.name || 'tu paciente'}`, onclick: () => deleteAppointment(a, load) }, 'Borrar')
          : [h('button', { class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', type: 'button', 'aria-label': `Editar la cita de ${p?.name || 'tu paciente'}`, onclick: () => openEdit(a) }, 'Editar'),
            h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', 'aria-label': `Cancelar la cita de ${p?.name || 'tu paciente'}`, onclick: () => cancelAppointment(a, load) }, 'Cancelar')]));
  }));
}

function pick(ymd, focus) {
  selected = ymd;
  const u = new URL(location.href); u.searchParams.set('day', ymd); u.searchParams.delete('new'); u.searchParams.delete('patient');
  history.replaceState(null, '', u);
  if (ymd.slice(0, 7) !== month && (ymd < gridStart() || ymd > gridEnd())) { month = ymd.slice(0, 7); load().then(() => focus && focusDay()); return; }
  render();
  if (focus) focusDay();
}
const focusDay = () => document.querySelector(`.plato-cal-day[data-day="${selected}"]`)?.focus();

document.getElementById('grid').addEventListener('keydown', (e) => {
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
  if (step) { e.preventDefault(); pick(addDays(selected, step), true); }
  else if (e.key === 'Home') { e.preventDefault(); pick(mondayOf(selected), true); }
  else if (e.key === 'End') { e.preventDefault(); pick(addDays(mondayOf(selected), 6), true); }
});
const shiftMonth = (n) => { const d = asDate(`${month}-15`); d.setMonth(d.getMonth() + n); month = localDate(d).slice(0, 7); selected = `${month}-01`; load(); };
document.getElementById('prev').addEventListener('click', () => shiftMonth(-1));
document.getElementById('next').addEventListener('click', () => shiftMonth(1));
document.getElementById('today-btn').addEventListener('click', () => { month = today.slice(0, 7); pick(today, true); load(); });

const openNew = ({ day = selected, patientId = '' } = {}) => appointmentDialog({ me, patients, types: me.appointment_types, day, patientId,
  onSaved: (a) => { selected = dayKey(a.starts_at); month = selected.slice(0, 7); return load(); } });
const openEdit = (a) => appointmentDialog({ me, patients: patients.some((p) => p.id === a.patient) ? patients : [...patients, a.expand?.patient].filter(Boolean),
  types: me.appointment_types, appt: a, note: notes[a.id], onSaved: (s) => { selected = dayKey(s.starts_at); month = selected.slice(0, 7); return load(); } });
document.getElementById('new-appt').addEventListener('click', () => openNew({ day: selected >= today ? selected : today }));

await load();
if (params.get('new') === '1') openNew({ day: selected >= today ? selected : today, patientId: params.get('patient') || '' });
