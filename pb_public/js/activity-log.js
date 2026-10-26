// activity-log.js — the patient logs physical activity: what, minutes, date, optional details. Speed is worked out.
import { create, localDate } from './api.js';
import { h, formError, busy } from './ui.js';
import { patientShell } from './shell.js';
import { KINDS, INTENSITY, TERRAIN, hasTerrain, hasDistance, speedOf } from './activity.js';

const { me } = await patientShell('log');
const form = document.getElementById('act-form');
const otherField = document.getElementById('other-field');
const terrainEl = document.getElementById('terrain');
const distanceField = document.getElementById('distance-field');
const speedEl = document.getElementById('speed');

const chip = (name, value, label, required = false) => h('label', {},
  h('input', { type: 'radio', name, value, required }), label);
document.getElementById('kinds').append(...KINDS.map(([k, l]) => chip('kind', k, l, true)));
document.getElementById('intensity').append(...INTENSITY.map(([k, l]) => chip('intensity', k, l)));
terrainEl.append(...TERRAIN.map(([k, l]) => chip('terrain', k, l)));

// Today by default; up to 7 days back (the server checks too).
const today = localDate();
const back = new Date(); back.setDate(back.getDate() - 7);
form.date.value = today;
form.date.max = today;
form.date.min = localDate(back);

function refresh() {
  const kind = form.kind.value;
  if (kind && form.querySelector('.plato-form-error')?.textContent.startsWith('Elige')) formError(form, '');
  otherField.hidden = kind !== 'other';
  form.kind_other.required = kind === 'other';
  terrainEl.hidden = !hasTerrain(kind);
  distanceField.hidden = !hasDistance(kind);
  const sp = hasDistance(kind) ? speedOf(kind, Number(form.minutes.value), Number(form.distance_km.value)) : null;
  speedEl.hidden = !sp;
  speedEl.textContent = sp ? `Velocidad: ${sp.kmh}${sp.pace ? ` · ritmo ${sp.pace}` : ''}` : '';
}
form.addEventListener('input', refresh);
form.addEventListener('change', refresh);
refresh();

// The radio group cannot show a message by itself; point the patient at it.
const kindsEl = document.getElementById('kinds');
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(form, '');
  if (!form.kind.value) {
    formError(form, 'Elige qué actividad hiciste.');
    kindsEl.querySelector('input').focus();
    return;
  }
  if (!form.reportValidity()) return;
  const kind = form.kind.value;
  const body = {
    patient: me.id,
    date: form.date.value,
    kind,
    kind_other: kind === 'other' ? form.kind_other.value.trim() : '',
    minutes: Number(form.minutes.value),
    intensity: form.intensity.value || '',
    terrain: hasTerrain(kind) ? form.terrain.value || '' : '',
    distance_km: hasDistance(kind) && form.distance_km.value ? Number(form.distance_km.value) : 0,
    note: form.note.value.trim(),
  };
  try {
    await busy(form.querySelector('[type=submit]'), () => create('activity_logs', body));
  } catch (err) {
    formError(form, err.status === 0 ? 'Sin conexión. Tus datos siguen aquí: toca Enviar cuando tengas internet.' : err.message);
    return;
  }
  location.href = '/today.html?activity=1';
});
