// tools/e2e.mjs — runs the spec's v1 demo (steps 1–12) and acceptance checks in headless Chrome.
// Use a THROWAWAY server: node tools/e2e.mjs http://127.0.0.1:8091 <outDir>
// Step 6 of acceptance (offline) needs the server stopped: pass --offline-after "<command that stops it>".
import { launch } from './cdp.mjs';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const BASE = process.argv[2] || 'http://127.0.0.1:8091';
const OUT = process.argv[3] || './e2e-out';
const stopCmd = process.argv.includes('--offline-after') ? process.argv[process.argv.indexOf('--offline-after') + 1] : null;
mkdirSync(OUT, { recursive: true });

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`);
};
const step = async (name, fn) => {
  try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); }
};
const pw = () => randomBytes(12).toString('base64url'); // throwaway test passwords, never printed
const shot = (p, name) => p.screenshot(`${OUT}/${name}.png`);
const yes = (p) => p.eval('window.confirm = () => true');

const browser = await launch({ profileDir: `${OUT}/chrome-profile` });
const nutri = await browser.newPage({ width: 1280, height: 900 });
const phone = await browser.newPage({ width: 390, height: 844, mobile: true });

const tag = randomBytes(3).toString('hex');
const nEmail = `zz-nutri-${tag}@test.local`;
let patientUrl = '';
let invite = '';
const pEmail = `zz-pac-${tag}@test.local`;

// 1. Nutritionist signs up
await step('1 nutritionist signs up', async () => {
  await nutri.goto(`${BASE}/`);
  await nutri.click('#tab-nutri');
  await nutri.click('#to-signup');
  await nutri.fill('#s-name', 'Dra. Prueba E2E');
  await nutri.fill('#s-clinic', 'Consultorio E2E');
  await nutri.fill('#s-email', nEmail);
  await nutri.fill('#s-password', pw());
  await nutri.click('#nutri-signup [type=submit]');
  await nutri.waitUrl('/patients.html');
  await nutri.waitFor(`document.querySelector('.plato-empty-state')`);
  check('1 nutritionist signs up and sees an empty patient list', true);
  await shot(nutri, '01-patients-empty');
});

// 2. New patient
await step('2 new patient', async () => {
  await nutri.click('#new-patient');
  await nutri.fill('#pf-name', 'Mariana Torres Gil');
  await nutri.fill('#pf-sex', 'female');
  await nutri.fill('#pf-birth', '1994-06-21');
  await nutri.fill('#pf-height', '158');
  await shot(nutri, '02-new-patient-dialog');
  await nutri.click('#patient-form [type=submit]');
  await nutri.waitUrl('/patient.html?id=');
  await nutri.waitFor(`document.getElementById('p-name').textContent === 'Mariana Torres Gil'`);
  patientUrl = await nutri.eval('location.href.split("&")[0]');
  check('2 new patient saved; patient page opens', true);
});

// 3. Measurement
await step('3 measurement', async () => {
  await nutri.waitFor(`document.querySelector('#m-rows td')`);
  await nutri.fill('#m-weight', '68.4');
  await nutri.fill('#m-fat', '29.5');
  await nutri.fill('#m-waist', '81');
  await nutri.click('#m-form [type=submit]');
  await nutri.waitFor(`[...document.querySelectorAll('#m-rows td')].some(td => td.textContent === '68.4')`);
  const stat = await nutri.text('#stats .plato-stat strong');
  check('3 measurement saved; stats show 68.4 kg', stat === '68.4 kg', stat);
  await shot(nutri, '03-overview');
});

// 4. Weekly diet
await step('4 diet', async () => {
  await nutri.click('#t-diet');
  await nutri.waitFor(`document.getElementById('meal-breakfast')`);
  await nutri.fill('#d-title', 'Plan E2E');
  await nutri.fill('#meal-breakfast', 'Avena con manzana');
  await nutri.fill('#meal-lunch', 'Pollo con arroz y ensalada');
  await nutri.fill('#meal-dinner', 'Quesadilla de panela');
  await yes(nutri);
  await nutri.click('#copy-day');
  const dots = await nutri.eval(`document.querySelectorAll('#days .plato-day-dot').length`);
  await nutri.click('#diet-form [type=submit]');
  await nutri.waitFor(`document.getElementById('diet-state').textContent.startsWith('Guardada')`);
  check('4 diet typed, copied to 7 days, saved', dots === 7, `dots=${dots}`);
  await shot(nutri, '04-diet');
});

// 5. Invite link
await step('5 invite link', async () => {
  await nutri.click('#t-access');
  await nutri.click('#make-link');
  invite = await nutri.waitFor(`document.getElementById('invite-link').value`);
  check('5 invite link created', /\/join\.html#[A-Za-z0-9]{40}$/.test(invite), invite.replace(/#.*/, '#…'));
  await shot(nutri, '05-access');
});

// 6. Patient opens link on the phone, sets a password
await step('6 patient joins', async () => {
  await phone.goto(invite);
  await phone.waitFor(`!document.getElementById('join-form').hidden`);
  const hello = await phone.text('#j-title');
  await shot(phone, '06-join');
  const p = pw();
  await phone.fill('#j-email', pEmail);
  await phone.fill('#j-password', p);
  await phone.fill('#j-password2', p);
  await phone.click('#join-form [type=submit]');
  await phone.waitUrl('/today.html');
  check('6 patient greeted by name, joins, lands on Today', hello === '¡Hola, Mariana!', hello);
});

// 7. Today shows today's meals
await step('7 today', async () => {
  await phone.waitFor(`document.querySelectorAll('#meals .plato-meal').length === 3`);
  const welcome = await phone.eval(`!document.getElementById('welcome').hidden`);
  const plateTxt = await phone.text('.plate-count');
  check('7 Today shows 3 planned meals, plate 0/3, welcome note', welcome && plateTxt === '0/3', `${welcome} ${plateTxt}`);
  check('7 install button exists in the patient app', await phone.eval(`!!document.getElementById('install-app')`));
  await shot(phone, '07-today-empty');
});

// 8–9. Log lunch with a photo; plate fills a slice
await step('8 log lunch', async () => {
  await phone.click('a[href="/log.html?slot=lunch"]');
  await phone.waitUrl('/log.html');
  await phone.waitFor(`document.querySelector('input[name=slot][value=lunch]')?.checked`);
  await phone.setFile('#photo', process.env.PHOTO);
  await phone.waitFor(`!document.getElementById('preview').hidden`);
  await phone.fill('#note', 'Sin tortilla hoy');
  await shot(phone, '08-log');
  await phone.click('#log-form [type=submit]');
  await phone.waitUrl('/today.html');
  await phone.waitFor(`document.querySelector('.plate-count')?.textContent === '1/3'`);
  const status = await phone.eval(`[...document.querySelectorAll('.plato-meal')].find(li => li.querySelector('h3').textContent === 'Comida').querySelector('.plato-meal-status')?.textContent`);
  check('8–9 lunch logged with photo; plate shows 1/3; lunch says Registrada', status === 'Registrada', status);
  await phone.waitFor(`[...document.querySelectorAll('.plato-meal-thumbs img')].every(i => i.complete && i.naturalWidth > 0)`);
  await shot(phone, '09-today-logged');
});

// 10–11. Nutritionist sees the photo, marks it seen
await step('10 nutritionist sees photo', async () => {
  await nutri.goto(`${patientUrl}&tab=log`);
  await nutri.waitFor(`document.querySelector('.plato-log-card img')?.naturalWidth > 0`);
  const badge = await nutri.text('#log-count');
  const note = await nutri.text('.plato-log-note');
  check('10 meal log tab shows the photo, note and a "1" badge', badge === '1' && note === 'Sin tortilla hoy', `${badge} ${note}`);
  await shot(nutri, '10-meal-log');
  await nutri.eval(`[...document.querySelectorAll('.plato-log-card button')].find(b => b.textContent.includes('Marcar vista')).click()`);
  await nutri.waitFor(`document.querySelector('.plato-log-card .badge')?.textContent.includes('Vista')`);
  check('11 nutritionist marks it seen', true);
});
await step('11 patient sees seen', async () => {
  await phone.goto(`${BASE}/today.html`);
  await phone.waitFor(`document.querySelector('.plato-meal-status.is-seen')`);
  const t = await phone.text('.plato-meal-status.is-seen');
  check('11 after refresh the patient sees "Vista por tu nutrióloga/o"', t === 'Vista por tu nutrióloga/o', t);
});

// 12. Progress chart
await step('12 progress', async () => {
  await phone.goto(`${BASE}/progress.html`);
  await phone.waitFor(`document.querySelectorAll('.chart-dot').length === 1`);
  const cap = await phone.text('.plato-chart figcaption');
  check('12 Progress shows the first weight point', cap.includes('68.4 kg'), cap);
  await shot(phone, '12-progress');
});

// Acceptance 2: refresh both — data still there
await step('A2 refresh', async () => {
  await nutri.goto(`${patientUrl}&tab=overview`);
  await nutri.waitFor(`[...document.querySelectorAll('#m-rows td')].some(td => td.textContent === '68.4')`);
  await nutri.goto(`${patientUrl}&tab=diet`);
  await nutri.waitFor(`document.getElementById('meal-lunch')?.value === 'Pollo con arroz y ensalada'`);
  check('A2 after refresh measurement and diet are still there', true);
});

// Acceptance 3: a second nutritionist cannot see the first one's patient
await step('A3 second nutritionist', async () => {
  const other = await browser.newPage({ width: 1280, height: 900 });
  await other.goto(`${BASE}/`);
  await other.click('#tab-nutri'); await other.click('#to-signup');
  await other.fill('#s-name', 'Otro Nutri'); await other.fill('#s-email', `zz-other-${tag}@test.local`); await other.fill('#s-password', pw());
  await other.click('#nutri-signup [type=submit]');
  await other.waitUrl('/patients.html');
  await other.waitFor(`document.querySelector('.plato-empty-state')`);
  await other.goto(patientUrl);
  await other.waitFor(`document.getElementById('status').textContent.startsWith('No encontrado')`);
  check('A3 second nutritionist: empty list; first patient page says "No encontrado"', true);
  await shot(other, 'A3-not-found');
  const pageErrors = other.errors.filter((e) => !/404|Not Found/i.test(e));
  check('A3 no unexpected console errors for the second nutritionist', pageErrors.length === 0, pageErrors.join(' | '));
});

// Acceptance 4: the patient cannot open private notes (UI has no route; check the API with the patient's own session)
await step('A4 notes', async () => {
  const r = await phone.eval(`(async () => {
    const s = JSON.parse(localStorage.getItem('plato.auth'));
    const pid = s.record.id;
    const list = await fetch('/api/collections/patient_notes/records?filter=' + encodeURIComponent("patient='" + pid + "'"), { headers: { Authorization: s.token } }).then(r => r.json());
    const page = await fetch('/patient.html?id=' + pid).then(r => r.status);
    return { n: list.items?.length, page };
  })()`);
  await phone.goto(`${BASE}/patient.html?id=x`);
  await phone.waitFor(`location.pathname === '/' || location.pathname === '/today.html'`);
  check('A4 patient gets no notes and is sent away from the nutritionist screen', r.n === 0, JSON.stringify(r));
});

// Acceptance 5: the invite link a second time
await step('A5 link reuse', async () => {
  const fresh = await browser.newPage({ width: 390, height: 844, mobile: true });
  await fresh.goto(invite);
  await fresh.waitFor(`!document.getElementById('j-bad').hidden`);
  const msg = await fresh.text('#j-bad-text');
  check('A5 second use of the link is refused', msg.includes('ya se usó'), msg);
  await shot(fresh, 'A5-link-used');
});

check('no console errors on the nutritionist screens', nutri.errors.length === 0, nutri.errors.join(' | '));
check('no console errors on the phone screens', phone.errors.filter((e) => !/plato-x|patient\.html\?id=x|404/.test(e)).length === 0, phone.errors.join(' | '));

// Acceptance 6: server unreachable → installed shell still opens from the service worker cache
await step('A6 offline', async () => {
  const sw = await phone.eval(`navigator.serviceWorker.getRegistration().then(r => !!r?.active)`);
  check('A6 service worker is active', sw, sw);
  if (!stopCmd) { check('A6 offline shell (skipped: no --offline-after)', false, 'not run'); return; }
  execSync(stopCmd, { stdio: 'ignore' });
  await phone.goto(`${BASE}/today.html`);
  await phone.waitFor(`document.querySelector('.plato-bottom-nav')`);
  await phone.waitFor(`document.getElementById('status').textContent.includes('Sin conexión')`);
  check('A6 with the server gone, Today still opens and says "Sin conexión"', true);
  await shot(phone, 'A6-offline');
});

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
