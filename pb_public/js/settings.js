// settings.js — the nutritionist's own settings. Saved as soon as a switch changes.
import { requireRole, update, signOut } from './api.js';
import { toast, offlineBanner } from './ui.js';

offlineBanner();
const me = await requireRole('nutritionists');
document.getElementById('who').textContent = me.name;
document.getElementById('sign-out').addEventListener('click', signOut);

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
