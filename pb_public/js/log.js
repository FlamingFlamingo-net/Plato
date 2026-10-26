// log.js — the patient logs a meal: pick the meal, take a photo, optional note, send.
// Photos are shrunk on the phone (max 1600 px JPEG) so they upload fast and stay under the 5 MB limit.
import { create, list, q, SLOTS, localDate, isoWeekday } from './api.js';
import { h, formError, busy } from './ui.js';
import { patientShell } from './shell.js';
import { photoPicker } from './photo.js';

const { me } = await patientShell('log');
const form = document.getElementById('log-form');
const slotsEl = document.getElementById('slots');
const photo = document.getElementById('photo');
const planned = document.getElementById('planned');

let todays = {};
try {
  const [diet] = await list('diets', { filter: `patient = ${q(me.id)}` });
  todays = diet?.meals?.[isoWeekday()] || {};
} catch { /* the form still works without the plan text */ }

// Default slot: ?slot=, else the meal closest to now.
const hour = new Date().getHours();
const guess = hour < 11 ? 'breakfast' : hour < 13 ? 'snack_am' : hour < 17 ? 'lunch' : hour < 19 ? 'snack_pm' : 'dinner';
const wanted = new URL(location.href).searchParams.get('slot');
const initial = SLOTS.some(([k]) => k === wanted) ? wanted : guess;

for (const [key, label] of SLOTS) {
  const input = h('input', { type: 'radio', name: 'slot', value: key, required: true, checked: key === initial });
  input.addEventListener('change', showPlanned);
  slotsEl.append(h('label', {}, input, h('span', { class: 'plato-swatch', style: `--swatch: var(--slot-${key})`, 'aria-hidden': 'true' }), label));
}
function showPlanned() {
  const k = form.slot.value;
  planned.textContent = todays[k] ? `Tu plan: ${todays[k]}` : '';
}
showPlanned();

const getBlob = photoPicker({ input: photo, preview: document.getElementById('preview'), label: document.getElementById('pick-label') });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(form, '');
  photo.setCustomValidity(getBlob() ? '' : 'Toma o elige una foto de tu comida.');
  if (!form.reportValidity()) return;
  const fd = new FormData();
  fd.set('patient', me.id);
  fd.set('date', localDate());
  fd.set('slot', form.slot.value);
  fd.set('note', form.note.value.trim());
  fd.set('photo', getBlob(), 'comida.jpg');
  try {
    await busy(form.querySelector('[type=submit]'), () => create('meal_logs', fd));
  } catch (err) {
    // Typed text and the chosen photo stay on screen; the patient can just tap Enviar again.
    formError(form, err.status === 0 ? 'Sin conexión. Tu foto sigue aquí: toca Enviar cuando tengas internet.' : err.message);
    return;
  }
  location.href = '/today.html?logged=1';
});
