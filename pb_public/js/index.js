// index.js — start page: sign in as patient or nutritionist (nutritionist accounts are made by the admin).
import { session, signIn } from './api.js';
import { wireTabs, formError, busy, offlineBanner } from './ui.js';

const s = session();
if (s?.collection === 'nutritionists') location.replace('/home.html');
else if (s?.collection === 'patients') location.replace('/today.html');

offlineBanner();
if (new URL(location.href).searchParams.has('ended')) {
  document.getElementById('ended').hidden = false;
  history.replaceState(null, '', '/');
}
wireTabs(document.getElementById('who'));

function onSubmit(form, action) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError(form, '');
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    try {
      await busy(form.querySelector('[type=submit]'), () => action(data));
    } catch (err) {
      formError(form, err.message);
    }
  });
}

onSubmit(document.getElementById('patient-signin'), async ({ email, password }) => {
  await signIn('patients', email.trim(), password);
  location.href = '/today.html';
});
onSubmit(document.getElementById('nutri-signin'), async ({ email, password }) => {
  await signIn('nutritionists', email.trim(), password);
  location.href = '/home.html';
});
