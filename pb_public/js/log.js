// log.js — the patient logs a meal: pick the meal, take a photo, optional note, send.
// A photo for a meal already checked on Hoy attaches to that check. "Comida extra": photo or note.
// ?date= may be yesterday (the checklist's "Ayer"); anything else means today.
// Photos are shrunk on the phone (max 1600 px JPEG) so they upload fast and stay under the 5 MB limit.
import { create, update, list, q, SLOTS, localDate, isoWeekday } from './api.js';
import { h, formError, busy, longDate } from './ui.js';
import { patientShell } from './shell.js';
import { photoPicker } from './photo.js';

const { me } = await patientShell('log');
const form = document.getElementById('log-form');
const slotsEl = document.getElementById('slots');
const photo = document.getElementById('photo');
const planned = document.getElementById('planned');

const yd = new Date(); yd.setDate(yd.getDate() - 1);
const params = new URL(location.href).searchParams;
const date = params.get('date') === localDate(yd) ? localDate(yd) : localDate();
const isYesterday = date !== localDate();
if (isYesterday) {
  const fd = document.getElementById('for-day');
  fd.textContent = `Para ayer, ${longDate(date)}.`;
  fd.hidden = false;
}

let todays = {};
try {
  const [diet] = await list('diets', { filter: `patient = ${q(me.id)}` });
  todays = diet?.meals?.[isoWeekday(new Date(`${date}T12:00:00`))] || {};
} catch { /* the form still works without the plan text */ }

// Default slot: ?slot=, else the meal closest to now.
const hour = new Date().getHours();
const guess = hour < 11 ? 'breakfast' : hour < 13 ? 'snack_am' : hour < 17 ? 'lunch' : hour < 19 ? 'snack_pm' : 'dinner';
const CHOICES = [...SLOTS, ['extra', 'Comida extra']];
const wanted = params.get('slot');
const initial = CHOICES.some(([k]) => k === wanted) ? wanted : guess;

for (const [key, label] of CHOICES) {
  const input = h('input', { type: 'radio', name: 'slot', value: key, required: true, checked: key === initial });
  input.addEventListener('change', showPlanned);
  slotsEl.append(h('label', {}, input, h('span', { class: 'plato-swatch', style: `--swatch: var(--slot-${key}, var(--muted-foreground))`, 'aria-hidden': 'true' }), label));
}
function showPlanned() {
  const k = form.slot.value;
  const extra = k === 'extra';
  planned.textContent = extra ? 'Algo que comiste fuera de tu plan. Una foto o una nota es suficiente.' : todays[k] ? `Tu plan: ${todays[k]}` : '';
  photo.required = !extra;
  document.getElementById('pick-title').textContent = extra ? 'Foto (opcional)' : 'Toma una foto de tu plato';
  document.getElementById('note-opt').textContent = extra ? '(o una foto)' : '(opcional)';
  form.note.placeholder = extra ? 'Ej. Un pan dulce en la oficina.' : 'Ej. Cambié el arroz por ensalada.';
}
showPlanned();

const getBlob = photoPicker({ input: photo, preview: document.getElementById('preview'), label: document.getElementById('pick-label') });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(form, '');
  const slot = form.slot.value;
  const note = form.note.value.trim();
  if (slot === 'extra') photo.setCustomValidity(getBlob() || note ? '' : 'Agrega una foto o una nota de lo que comiste.');
  else photo.setCustomValidity(getBlob() ? '' : 'Toma o elige una foto de tu comida.');
  if (!form.reportValidity()) return;
  const fd = new FormData();
  fd.set('note', note);
  if (getBlob()) fd.set('photo', getBlob(), 'comida.jpg');
  try {
    await busy(form.querySelector('[type=submit]'), async () => {
      // Already checked on Hoy without a photo: the photo goes on that check.
      const [check] = slot === 'extra' ? [] : await list('meal_logs', {
        filter: `patient = ${q(me.id)} && date = ${q(date)} && slot = ${q(slot)} && photo = ""`, perPage: 1 });
      if (check) return update('meal_logs', check.id, fd);
      fd.set('patient', me.id);
      fd.set('date', date);
      fd.set('slot', slot);
      return create('meal_logs', fd);
    });
  } catch (err) {
    // Typed text and the chosen photo stay on screen; the patient can just tap Enviar again.
    formError(form, err.status === 0 ? 'Sin conexión. Tu foto sigue aquí: toca Enviar cuando tengas internet.' : err.message);
    return;
  }
  location.href = `/today.html?logged=1${isYesterday ? '&day=yesterday' : ''}`;
});
