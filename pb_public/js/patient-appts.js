// patient-appts.js — the appointments strip on the nutritionist's patient page (spec "Feature: Agenda", slice 1):
// next appointment, "Agendar cita", and every appointment of this patient (newest first, with the private note).
import { list, q, localDate } from './api.js';
import { h, icon } from './ui.js';
import { appointmentDialog, cancelAppointment, notesFor, dayLabel, timeOf, timeRange, dayKey } from './appointments.js';

export function mountPatientAppointments(el, { me, patient, closed }) {
  let all = [], notes = {};
  const load = async () => {
    try {
      all = await list('appointments', { filter: `patient = ${q(patient.id)}`, sort: '-starts_at', perPage: 200 });
      notes = await notesFor(all.map((a) => a.id));
    } catch { all = []; }
    render();
  };
  const open = (appt = null) => appointmentDialog({ me, patients: [{ id: patient.id, name: patient.name }], types: me.appointment_types,
    patientId: patient.id, appt, note: appt ? notes[appt.id] : null, onSaved: load });
  const upcomingOf = () => all.filter((a) => !a.cancelled_at && new Date(a.starts_at.replace(' ', 'T')).getTime() + a.duration_min * 60000 > Date.now())
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  function render() {
    const next = upcomingOf()[0];
    const head = h('div', { class: 'plato-p-appt-head' },
      icon('calendar', 18),
      next
        ? h('p', {}, h('span', { text: 'Próxima cita: ' }), h('strong', { text: `${dayLabel(next.starts_at)}, ${timeOf(next.starts_at)}` }), h('span', { class: 'plato-muted', text: ` · ${next.type}` }))
        : h('p', { class: 'plato-muted', text: closed ? 'Sin citas próximas.' : 'Sin citas próximas.' }),
      closed ? null : h('button', { class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', type: 'button', id: 'p-new-appt', onclick: () => open() }, 'Agendar cita'));
    const rows = all.map((a) => {
      const past = dayKey(a.starts_at) < localDate();
      return h('li', { class: a.cancelled_at ? 'is-cancelled' : past ? 'is-past' : '' },
        h('span', { class: 'plato-p-appt-when' }, h('strong', { text: dayLabel(a.starts_at) }), h('span', { text: timeRange(a) })),
        h('span', { class: 'badge plato-appt-type', text: a.type }),
        a.cancelled_at ? h('span', { class: 'badge', 'data-variant': 'destructive', text: 'Cancelada' }) : null,
        notes[a.id]?.text ? h('p', { class: 'plato-appt-note' }, icon('lock', 13), h('span', { text: notes[a.id].text })) : null,
        closed || a.cancelled_at || past ? null : h('span', { class: 'plato-row' },
          h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', onclick: () => open(a) }, 'Editar'),
          h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', onclick: () => cancelAppointment(a, load) }, 'Cancelar')));
    });
    // replaceChildren() would print a null as the text "null": pass only real nodes.
    el.replaceChildren(head, ...(all.length
      ? [h('details', { class: 'plato-p-appt-all' }, h('summary', { text: `Todas sus citas (${all.length})` }), h('ul', {}, ...rows),
          h('a', { class: 'btn', 'data-variant': 'link', 'data-size': 'sm', href: '/agenda.html' }, 'Abrir mi agenda'))]
      : []));
  }
  load();
}
