// index.js — start page: sign in as patient or nutritionist, or create a nutritionist account.
import { session, signIn, signUpNutritionist } from './api.js';
import { wireTabs, formError, busy, offlineBanner } from './ui.js';

const s = session();
if (s?.collection === 'nutritionists') location.replace('/patients.html');
else if (s?.collection === 'patients') location.replace('/today.html');

offlineBanner();
if (new URL(location.href).searchParams.has('ended')) {
  document.getElementById('ended').hidden = false;
  history.replaceState(null, '', '/');
}
wireTabs(document.getElementById('who'));

const signinForm = document.getElementById('nutri-signin');
const signupForm = document.getElementById('nutri-signup');
document.getElementById('to-signup').addEventListener('click', () => {
  signinForm.hidden = true; signupForm.hidden = false; signupForm.querySelector('input').focus();
});
document.getElementById('to-signin').addEventListener('click', () => {
  signupForm.hidden = true; signinForm.hidden = false; signinForm.querySelector('input').focus();
});

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
onSubmit(signinForm, async ({ email, password }) => {
  await signIn('nutritionists', email.trim(), password);
  location.href = '/patients.html';
});
onSubmit(signupForm, async (d) => {
  await signUpNutritionist({ ...d, email: d.email.trim(), name: d.name.trim() });
  location.href = '/patients.html';
});
