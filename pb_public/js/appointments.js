// appointments.js — agenda helpers shared by the Agenda page, the patient page, Inicio and the patient's Hoy
// (spec "Feature: Agenda — the nutritionist's own calendar", slice 1).
// Times are stored in UTC and shown in the device's local time. The private note lives in appointment_notes,
// which patients can't read at all.
import { list, create, update, remove, q, localDate } from './api.js';
import { h, toast, formError, busy } from './ui.js';

// The client's consultation types; minutes = default duration (the longest he gave for each).
export const DEFAULT_TYPES = [
  { name: 'Consulta nutricional inicial', minutes: 60 },
  { name: 'Consulta nutricional seguimiento', minutes: 60 },
  { name: 'Consulta de entrenamiento', minutes: 60 },
  { name: 'Consulta de mediciones', minutes: 30 },
  { name: 'Consulta de alto rendimiento deportivo', minutes: 90 },
];
export const DEFAULT_MINUTES = 60;
// A nutritionist's list as [{ name, minutes }] (older plain names count as 60 minutes).
export const typesOf = (list) => (Array.isArray(list) && list.length ? list : DEFAULT_TYPES)
  .map((x) => (typeof x === 'string' ? { name: x, minutes: DEFAULT_MINUTES } : x)).filter((x) => x && x.name);

const tf = new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit' });
const df = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
export const toDate = (pb) => new Date(String(pb).replace(' ', 'T'));
export const timeOf = (pb) => tf.format(toDate(pb));
export const dayLabel = (pb) => { const s = df.format(toDate(pb)); return s[0].toUpperCase() + s.slice(1); };
export const dayKey = (pb) => localDate(toDate(pb));               // local YYYY-MM-DD of an appointment
export const toPb = (ymd, hhmm) => new Date(`${ymd}T${hhmm}:00`).toISOString().replace('T', ' ');
export const endOf = (a) => new Date(toDate(a.starts_at).getTime() + a.duration_min * 60000);
const pad = (n) => String(n).padStart(2, '0');
export const hhmmOf = (pb) => { const d = toDate(pb); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };

// Appointments starting in [fromYmd, toYmd] (local days, inclusive), sorted by time. Nutritionist view.
export async function loadRange(fromYmd, toYmdIncl, { patient = '' } = {}) {
  const from = new Date(`${fromYmd}T00:00:00`).toISOString().replace('T', ' ');
  const to = new Date(`${toYmdIncl}T23:59:59`).toISOString().replace('T', ' ');
  const f = `starts_at >= ${q(from)} && starts_at <= ${q(to)}${patient ? ` && patient = ${q(patient)}` : ''}`;
  return list('appointments', { filter: f, sort: 'starts_at', perPage: 500, expand: 'patient' });
}

export async function notesFor(ids) {
  if (!ids.length) return {};
  const rows = await list('appointment_notes', { filter: ids.map((id) => `appointment = ${q(id)}`).join(' || '), perPage: 500 });
  return Object.fromEntries(rows.map((n) => [n.appointment, n]));
}

// "4:00 p.m. – 5:00 p.m."
export const timeRange = (a) => `${timeOf(a.starts_at)} – ${tf.format(endOf(a))}`;

// Overlap warning (not a block): other non-cancelled appointments that cross [start, end).
export function overlaps(all, startPb, minutes, exceptId) {
  const s = toDate(startPb).getTime(), e = s + minutes * 60000;
  return all.filter((a) => a.id !== exceptId && !a.cancelled_at && toDate(a.starts_at).getTime() < e && endOf(a).getTime() > s);
}

let dlg;
// Nueva cita / Editar cita. patients: active patients [{id,name}]; types: list; appt: existing (edit) or null.
export function appointmentDialog({ me, patients, types, appt = null, note = null, patientId = '', day = localDate(), onSaved }) {
  dlg?.remove();
  const editing = !!appt;
  const typeList = typesOf(types);
  if (appt && !typeList.some((x) => x.name === appt.type)) typeList.push({ name: appt.type, minutes: appt.duration_min });   // renamed or removed since
  const pSel = h('select', { class: 'select', id: 'ap-patient', required: true, disabled: editing ? null : !!patientId },
    h('option', { value: '' }, 'Elige a tu paciente…'),
    ...patients.map((p) => h('option', { value: p.id, selected: (appt?.patient || patientId) === p.id }, p.name)));
  const dIn = h('input', { class: 'input', type: 'date', id: 'ap-date', required: true, value: appt ? dayKey(appt.starts_at) : day });
  const tIn = h('input', { class: 'input', type: 'time', id: 'ap-time', required: true, step: 300, value: appt ? hhmmOf(appt.starts_at) : '' });
  const mIn = h('input', { class: 'input', type: 'number', id: 'ap-min', required: true, min: 15, max: 240, step: 5, inputmode: 'numeric', value: appt?.duration_min || typeList[0]?.minutes || DEFAULT_MINUTES });
  const tySel = h('select', { class: 'select', id: 'ap-type', required: true }, ...typeList.map((t) => h('option', { value: t.name, selected: appt?.type === t.name }, `${t.name} · ${t.minutes} min`)));
  // Picking a type fills in its usual duration (still editable for this appointment).
  tySel.addEventListener('change', () => { const ty = typeList.find((x) => x.name === tySel.value); if (ty) { mIn.value = ty.minutes; mIn.dispatchEvent(new Event('change')); } });
  const nIn = h('textarea', { class: 'textarea', id: 'ap-note', rows: 2, maxlength: 1000, placeholder: 'Solo tú la ves. Ej. Revisar dolor de rodilla.' });
  nIn.value = note?.text || '';
  const warn = h('p', { class: 'plato-ap-warn', id: 'ap-warn', role: 'status', hidden: true });
  const form = h('form', { class: 'plato-form', novalidate: true },
    h('section', { class: 'plato-form' },
      h('div', { class: 'field' }, h('label', { for: 'ap-patient', text: 'Paciente' }), pSel),
      h('div', { class: 'field' }, h('label', { for: 'ap-type', text: 'Tipo de consulta' }), tySel),
      h('div', { class: 'plato-row plato-row--fields' },
        h('div', { class: 'field' }, h('label', { for: 'ap-date', text: 'Día' }), dIn),
        h('div', { class: 'field' }, h('label', { for: 'ap-time', text: 'Hora' }), tIn),
        h('div', { class: 'field' }, h('label', { for: 'ap-min', text: 'Duración (min)' }), mIn)),
      h('div', { class: 'field' }, h('label', { for: 'ap-note' }, 'Nota privada ', h('span', { class: 'plato-muted', text: '(opcional; tu paciente no la ve)' })), nIn),
      warn),
    h('footer', { class: 'plato-actions' },
      h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', onclick: () => dlg.close() }, 'Cancelar'),
      h('button', { class: 'btn', type: 'submit', id: 'ap-save' }, editing ? 'Guardar cambios' : 'Agendar cita')));
  dlg = h('dialog', { class: 'dialog plato-ap-dialog', id: 'ap-dialog', 'aria-labelledby': 'ap-title' },
    h('div', {}, h('header', {}, h('h2', { id: 'ap-title', text: editing ? 'Editar cita' : 'Nueva cita' }),
      h('p', { text: 'Tu paciente la verá en su app (sin tu nota).' })), form));
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => dlg.remove());

  let dayAppts = [];
  const checkOverlap = async () => {
    if (!dIn.value || !tIn.value || !mIn.value) { warn.hidden = true; return; }
    try { dayAppts = await loadRange(dIn.value, dIn.value); } catch { return; }
    const o = overlaps(dayAppts, toPb(dIn.value, tIn.value), Number(mIn.value), appt?.id);
    warn.hidden = !o.length;
    warn.textContent = o.length ? `Se cruza con ${o.map((a) => `${timeRange(a)} (${a.expand?.patient?.name || 'otra cita'})`).join(', ')}. Puedes guardarla de todos modos.` : '';
  };
  for (const el of [dIn, tIn, mIn]) el.addEventListener('change', checkOverlap);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError(form, '');
    if (!form.reportValidity()) return;
    if (Number(mIn.value) % 5) { formError(form, 'La duración va de 5 en 5 minutos.'); mIn.focus(); return; }
    const body = { patient: pSel.value, starts_at: toPb(dIn.value, tIn.value), duration_min: Number(mIn.value), type: tySel.value };
    let saved;
    try {
      saved = await busy(document.getElementById('ap-save'), async () => {
        const r = editing ? await update('appointments', appt.id, body) : await create('appointments', { ...body, nutritionist: me.id });
        const text = nIn.value.trim();
        if (note) { if (text !== note.text) await update('appointment_notes', note.id, { text }); }
        else if (text) await create('appointment_notes', { appointment: r.id, nutritionist: me.id, text });
        return r;
      });
    } catch (err) { formError(form, err.status === 0 ? 'Sin conexión. No se guardó.' : err.message); return; }
    dlg.close();
    toast(editing ? 'Cita actualizada. Tu paciente ve el cambio.' : 'Cita agendada. Tu paciente la ve en su app.');
    await onSaved?.(saved);
  });
  dlg.showModal();
  (editing || patientId ? tIn : pSel).focus();
  if (editing) checkOverlap();
}

export async function cancelAppointment(a, onDone) {
  if (!confirm(`¿Cancelar la cita de ${a.expand?.patient?.name || 'tu paciente'} (${dayLabel(a.starts_at)}, ${timeOf(a.starts_at)})? Tu paciente verá que se canceló.`)) return;
  try { await update('appointments', a.id, { cancelled_at: new Date().toISOString().replace('T', ' ') }); } catch (e) { toast(e.message, 'error'); return; }
  toast('Cita cancelada. Tu paciente lo verá en su app.');
  await onDone?.();
}

export async function deleteAppointment(a, onDone) {
  if (!confirm('¿Borrar esta cita cancelada? Desaparece de tu agenda.')) return;
  try { await remove('appointments', a.id); } catch (e) { toast(e.message, 'error'); return; }
  toast('Cita borrada.');
  await onDone?.();
}
