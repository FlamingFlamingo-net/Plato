// join.js — patient opens the invite link (/join.html#<token>), sets email + password, and is signed in.
import { checkInvite, join } from './api.js';
import { formError, busy, offlineBanner } from './ui.js';

offlineBanner();
const token = location.hash.slice(1);
const sub = document.getElementById('j-sub');
const form = document.getElementById('join-form');

function bad(message) {
  sub.textContent = '';
  form.hidden = true;
  document.getElementById('j-bad-text').textContent = message;
  document.getElementById('j-bad').hidden = false;
}

try {
  const info = await checkInvite(token || 'x');
  document.getElementById('j-title').textContent = `¡Hola, ${info.name}!`;
  sub.textContent = info.rejoin
    ? `${info.nutritionist} te mandó un acceso nuevo. Elige tu contraseña otra vez.`
    : `${info.nutritionist} te invitó a seguir tu plan en AHT Fitness.`;
  form.hidden = false;
  form.email.focus();
} catch (e) {
  bad(e.message);
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(form, '');
  form.password2.setCustomValidity(form.password2.value && form.password2.value !== form.password.value ? 'Las contraseñas no coinciden.' : '');
  if (!form.reportValidity()) return;
  try {
    await busy(form.querySelector('[type=submit]'), () => join(token, form.email.value.trim(), form.password.value));
  } catch (err) {
    formError(form, err.message);
    return;
  }
  history.replaceState(null, '', '/join.html'); // drop the used token from the address bar
  location.href = '/today.html?welcome=1';
});
form.password2.addEventListener('input', () => form.password2.setCustomValidity(''));
