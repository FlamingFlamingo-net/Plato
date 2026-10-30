// next-appt.js — the patient's view of their appointments (spec "Feature: Agenda", slice 1). Read-only:
// "Tu próxima cita …" (marked Nueva when created or changed since this phone last showed it) and a
// "Cancelada" notice until the day of a cancelled appointment passes. The private note never reaches the patient
// (it lives in a collection they cannot read).
import { list, q, localDate } from './api.js';
import { h, icon } from './ui.js';
import { lastSeen, markSeen } from './feedback.js';
import { dayLabel, timeOf, dayKey, endOf } from './appointments.js';

const startOfToday = () => new Date(`${localDate()}T00:00:00`).toISOString().replace('T', ' ');

// Appointments from today on (cancelled ones included, for the notice).
export const loadMine = (me) => list('appointments', { filter: `patient = ${q(me.id)} && starts_at >= ${q(startOfToday())}`, sort: 'starts_at', perPage: 50 });

// Anything new for the bottom-nav dot: created/changed since last shown, and still relevant.
export async function hasNewAppointment(me) {
  const since = lastSeen('appointment');
  try {
    const rows = await loadMine(me);
    return rows.some((a) => (!since || a.changed_at > since) && (a.cancelled_at || endOf(a) > new Date()));
  } catch { return false; }
}

export async function mountNextAppointment(el, me) {
  let rows = [];
  try { rows = await loadMine(me); } catch { el.hidden = true; return; }
  const since = lastSeen('appointment');
  const isNew = (a) => !since || a.changed_at > since;
  const next = rows.find((a) => !a.cancelled_at && endOf(a) > new Date());
  const cancelled = rows.filter((a) => a.cancelled_at && dayKey(a.starts_at) >= localDate());
  const parts = [];
  if (next) {
    const when = `${dayLabel(next.starts_at)}${dayKey(next.starts_at) === localDate() ? ' (hoy)' : ''}, ${timeOf(next.starts_at)}`;
    parts.push(h('div', { class: 'plato-next-appt', id: 'next-appt-card' },
      h('span', { class: 'plato-next-appt-icon' }, icon('calendar', 20)),
      h('div', {},
        h('p', { class: 'plato-next-appt-label' }, 'Tu próxima cita', isNew(next) ? h('span', { class: 'badge plato-new-badge', text: 'Nueva' }) : null),
        h('strong', { text: when }),
        h('p', { class: 'plato-muted plato-small', text: `${next.type} · ${next.duration_min} min` }))));
  }
  for (const c of cancelled) {
    parts.push(h('div', { class: 'plato-next-appt is-cancelled' },
      h('span', { class: 'plato-next-appt-icon' }, icon('alert', 20)),
      h('div', {},
        h('p', { class: 'plato-next-appt-label' }, 'Cita cancelada', isNew(c) ? h('span', { class: 'badge plato-new-badge', text: 'Nueva' }) : null),
        h('strong', { text: `Tu cita del ${dayLabel(c.starts_at).toLowerCase()}, ${timeOf(c.starts_at)}` }),
        h('p', { class: 'plato-muted plato-small', text: 'Se canceló. Si necesitas otra fecha, habla con quien lleva tu plan.' }))));
  }
  el.replaceChildren(...parts);
  el.hidden = !parts.length;
  if (parts.length) markSeen('appointment');
}
