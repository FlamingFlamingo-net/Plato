// progress-photo.js — the patient sends a progress photo: pose, photo, optional note. Always dated today.
import { create, localDate, dateOnly } from './api.js';
import { h, formError, busy } from './ui.js';
import { patientShell } from './shell.js';
import { photoPicker } from './photo.js';
import { POSES } from './progress-photos.js';

const { me, minor } = await patientShell('log');
const form = document.getElementById('pp-form');
const posesEl = document.getElementById('poses');
const photo = document.getElementById('photo');
const getBlob = photoPicker({ input: photo, preview: document.getElementById('preview'), label: document.getElementById('pick-label') });

// Age limits: explain instead of showing a form the server would refuse.
if (minor) {
  form.hidden = true;
  document.getElementById('pp-minor').hidden = false;
  document.getElementById('pp-minor-text').textContent = dateOnly(me.birth_date)
    ? 'Por tu edad, Plato no guarda fotos de progreso. Puedes seguir registrando tus comidas y tu actividad.'
    : 'Tu nutrióloga o nutriólogo aún no registra tu fecha de nacimiento. Las fotos de progreso se activan cuando la agregue.';
}

posesEl.append(...POSES.map(([k, l], i) => h('label', {}, h('input', { type: 'radio', name: 'pose', value: k, required: true, checked: i === 0 }), l)));

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(form, '');
  photo.setCustomValidity(getBlob() ? '' : 'Toma o elige tu foto.');
  if (!form.reportValidity()) return;
  const fd = new FormData();
  fd.set('patient', me.id);
  fd.set('date', localDate());
  fd.set('pose', form.pose.value);
  fd.set('note', form.note.value.trim());
  fd.set('photo', getBlob(), 'progreso.jpg');
  try {
    await busy(form.querySelector('[type=submit]'), () => create('progress_photos', fd));
  } catch (err) {
    formError(form, err.status === 0 ? 'Sin conexión. Tu foto sigue aquí: toca Enviar cuando tengas internet.' : err.message);
    return;
  }
  location.href = '/progress.html?photo=1';
});
