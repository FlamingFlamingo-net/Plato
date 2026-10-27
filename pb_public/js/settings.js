// settings.js — the nutritionist's own settings. Saved as soon as a switch changes.
import { requireRole, update, signOut, photoUrl } from './api.js';
import { toast, offlineBanner, formError, busy } from './ui.js';
import { shrink } from './photo.js';

offlineBanner();
let me = await requireRole('nutritionists');
document.getElementById('who').textContent = me.name;
document.getElementById('sign-out').addEventListener('click', signOut);

// ---- Profile + cover (the home banner) ----
const pf = document.getElementById('profile-form');
const coverIn = document.getElementById('cover');
const coverImg = document.getElementById('cover-preview');
const coverEmpty = document.getElementById('cover-empty');
const fields = { name: 'pr-name', clinic_name: 'pr-clinic', whatsapp: 'pr-whatsapp', instagram: 'pr-instagram' };
for (const [k, id] of Object.entries(fields)) document.getElementById(id).value = me[k] || '';
async function showCover() {
  if (!me.cover) return;
  coverImg.src = await photoUrl(me, '1600x0', 'cover');
  coverImg.hidden = false;
  coverEmpty.hidden = true;
}
showCover().catch(() => {});
let coverBlob = null;
coverIn.addEventListener('change', async () => {
  const f = coverIn.files[0];
  coverBlob = null;
  if (!f) return;
  try { coverBlob = await shrink(f, 2000); } catch { coverBlob = f; }
  coverImg.src = URL.createObjectURL(coverBlob);
  coverImg.hidden = false;
  coverEmpty.hidden = true;
});
pf.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(pf, '');
  if (!pf.reportValidity()) return;
  const fd = new FormData();
  for (const [k, id] of Object.entries(fields)) fd.set(k, document.getElementById(id).value.trim());
  if (coverBlob) fd.set('cover', coverBlob, 'portada.jpg');
  try {
    me = await busy(document.getElementById('profile-save'), () => update('nutritionists', me.id, fd));
  } catch (err) { formError(pf, err.status === 0 ? 'Sin conexión. No se guardó.' : err.message); return; }
  coverBlob = null;
  coverIn.value = '';
  document.getElementById('who').textContent = me.name;
  toast('Perfil guardado. Así se ve en tu inicio.');
});

const allow = document.getElementById('allow-delete');
const help = document.getElementById('allow-help');
const HELP = {
  on: 'Encendido: tus pacientes pueden borrar sus fotos de progreso en cualquier momento.',
  off: 'Apagado: solo tú puedes borrarlas. Tus pacientes ven “Pídeselo a tu nutrióloga o nutriólogo”.',
};
const show = (on) => { allow.checked = on; help.textContent = on ? HELP.on : HELP.off; };
show(!!me.allow_progress_delete);
allow.disabled = false;

allow.addEventListener('change', async () => {
  const on = allow.checked;
  allow.disabled = true;
  try {
    await update('nutritionists', me.id, { allow_progress_delete: on });
    show(on);
    toast(on ? 'Listo: tus pacientes pueden borrar sus fotos de progreso.' : 'Listo: solo tú puedes borrar las fotos de progreso.');
  } catch (e) {
    show(!on);
    toast(e.status === 0 ? 'Sin conexión. No se guardó el cambio.' : e.message, 'error');
  } finally {
    allow.disabled = false;
  }
});
