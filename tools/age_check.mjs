// tools/age_check.mjs — screen acceptance for age limits (spec "Feature: Age limits").
// THROWAWAY server seeded with tools/seed.py (Ana is 35). PB_CONTAINER = the throwaway container's name
// (used once, to blank a birth date as the admin, like a patient created before the rule):
//   PB_CONTAINER=pb-check node tools/age_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
const BOX = process.env.PB_CONTAINER;
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };

const browser = await launch({ port: 9342, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const nutri = await as('nutritionist', { width: 1280, height: 900 });
const ana = await as('ana', { width: 390, height: 844, mobile: true });
const anaId = t.ana_id;
const ymdYearsAgo = (n) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toLocaleDateString('en-CA'); };
const openAna = async () => {
  await nutri.goto(`${BASE}/patient.html?id=${anaId}`);
  await nutri.waitFor(`document.getElementById('edit-birth')`);
};
const setBirth = async (ymd) => {
  await openAna();
  await nutri.click('#edit-birth');
  await nutri.waitFor(`document.getElementById('bd-dialog').open`);
  await nutri.eval(`document.getElementById('bd-date').value = ${JSON.stringify(ymd)}`);
  await nutri.click('#bd-save');
};

await step('E4', async () => {
  await nutri.goto(`${BASE}/patients.html`);
  await nutri.waitFor(`document.getElementById('new-patient')`);
  await nutri.click('#new-patient');
  await nutri.waitFor(`document.getElementById('patient-dialog').open`);
  await nutri.fill('#pf-name', 'ZZ Sin Fecha');
  await nutri.fill('#pf-sex', 'male');
  await nutri.click('#patient-dialog [type=submit]');
  check('E4 "Nuevo paciente" cannot be saved without a birth date', await nutri.eval(`document.getElementById('patient-dialog').open && document.getElementById('pf-birth').validationMessage !== ''`));
});

await step('E0', async () => {
  await openAna();
  check('E0 an adult has no badge, only "Cambiar fecha de nacimiento"', await nutri.eval(`!document.querySelector('#p-age .badge') && document.getElementById('edit-birth').textContent === 'Cambiar fecha de nacimiento'`));
  await ana.goto(`${BASE}/log.html`);
  await ana.waitFor(`document.querySelectorAll('.plato-log-type a').length === 3`);
  check('E0 an adult sees Comida | Actividad | Progreso', true);
});

await step('E3', async () => {
  await openAna();
  await nutri.click('#edit-birth');
  await nutri.waitFor(`document.getElementById('bd-dialog').open`);
  await nutri.eval(`document.getElementById('bd-date').value = '2999-01-01'`);
  await nutri.click('#bd-save');
  const err = await nutri.eval(`document.querySelector('#bd-form .plato-form-error:not([hidden])')?.textContent || ''`);
  check('E3 a future birth date is refused', err === 'La fecha no puede ser en el futuro.', err);
  await nutri.eval(`document.getElementById('bd-date').value = ${JSON.stringify(ymdYearsAgo(17))}`);
  await nutri.click('#bd-save');
  await nutri.waitFor(`document.querySelector('#p-age .badge')?.textContent.includes('Menor de edad')`);
  const meta = await nutri.text('#p-meta');
  check('E6 17 years old: badge "Menor de edad: sin fotos de progreso", age shown as 17', meta.includes('17 años'), meta);
  await nutri.screenshot(`${OUT}/minor-badge.png`, { full: false });
});

await step('E1', async () => {
  await ana.goto(`${BASE}/log.html`);
  await ana.waitFor(`document.querySelector('.plato-log-type a[href="/activity.html"]')`);
  const links = await ana.eval(`[...document.querySelectorAll('.plato-log-type a')].map(a => a.textContent).join('|')`);
  check('E1 minor: Registrar shows Comida | Actividad (no Progreso); meal photo form still there', links === 'Comida|Actividad' &&
    await ana.eval(`!!document.getElementById('photo')`), links);
  await ana.goto(`${BASE}/progress.html`);
  await ana.waitFor(`document.getElementById('pp-status').textContent`);
  check('E1 minor: Progreso has no "Agregar foto" and says why', await ana.eval(`!document.getElementById('add-photo') && document.getElementById('pp-status').textContent === 'Por tu edad, AHT Fitness no guarda fotos de progreso.'`));
  await ana.goto(`${BASE}/progress-photo.html`);
  await ana.waitFor(`!document.getElementById('pp-minor').hidden`);
  check('E1 minor: opening the progress form directly explains instead of showing it', await ana.eval(`document.getElementById('pp-form').hidden && document.getElementById('pp-minor-text').textContent.startsWith('Por tu edad')`));
  await ana.screenshot(`${OUT}/minor-progress-form.png`, { full: false });
});

await step('E2', async () => {
  await setBirth(ymdYearsAgo(18));
  await nutri.waitFor(`!document.querySelector('#p-age .badge')`);
  await ana.goto(`${BASE}/log.html`);
  await ana.waitFor(`document.querySelectorAll('.plato-log-type a').length === 3`);
  check('E2 18th birthday today: badge gone, Progreso is back on the phone', true);
});

await step('E4b', async () => {
  if (!BOX) { console.log('SKIP E4b (set PB_CONTAINER)'); return; }
  const email = `zz-su-${randomBytes(3).toString('hex')}@test.local`, pw = `Zz${randomBytes(12).toString('hex')}`; // never starts with '-' (CLI flag)
  execFileSync('docker', ['exec', BOX, '/pb/pocketbase', 'superuser', 'upsert', email, pw]);
  const su = await (await fetch(`${BASE}/api/collections/_superusers/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: pw }) })).json();
  await fetch(`${BASE}/api/collections/patients/records/${anaId}`, { method: 'PATCH', headers: { Authorization: su.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ birth_date: '' }) });
  await openAna();
  await nutri.waitFor(`document.querySelector('#p-age .badge')`);
  check('E6 no birth date: "Falta la fecha de nacimiento" and "Agregar fecha de nacimiento"',
    await nutri.eval(`document.querySelector('#p-age .badge').textContent.includes('Falta la fecha de nacimiento') && document.getElementById('edit-birth').textContent === 'Agregar fecha de nacimiento'`));
  await nutri.screenshot(`${OUT}/missing-birth.png`, { full: false });
  await ana.goto(`${BASE}/progress.html`);
  await ana.waitFor(`document.getElementById('pp-status').textContent`);
  check('E4 no birth date: treated as a minor on the phone, with the reason', (await ana.text('#pp-status')).startsWith('Las fotos de progreso se activan cuando'));
  await setBirth('1991-03-14');
  await nutri.waitFor(`!document.querySelector('#p-age .badge')`);
  check('E4 adding the birth date unlocks again', true);
});

const errs = [...nutri.errors, ...ana.errors];
check('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
