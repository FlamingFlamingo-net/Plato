// "Nuevo paciente" with optional weight and height (spec "Feature: Weight and height on Nuevo paciente").
// Usage: node tools/newpatient_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server)
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const api = async (path) => (await fetch(`${BASE}${path}`, { headers: { Authorization: t.nutritionist.token } })).json();
const today = new Date().toLocaleDateString('en-CA');

const browser = await launch({ port: 9354, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const nutri = await as('nutritionist', { width: 1366, height: 900 });
async function newPatient({ name, weight = '', height = '' }) {
  await nutri.goto(`${BASE}/patients.html`);
  await nutri.waitFor(`document.getElementById('tab-archived')?.textContent.includes('(')`);
  await nutri.click('#new-patient');
  await nutri.waitFor(`document.getElementById('patient-dialog').open`);
  await nutri.fill('#pf-name', name);
  await nutri.eval(`document.getElementById('pf-sex').value = 'female'`);
  await nutri.fill('#pf-birth', '1992-04-10');
  if (height) await nutri.fill('#pf-height', height);
  if (weight) await nutri.fill('#pf-weight', weight);
}
const idFromUrl = async () => new URL(await nutri.eval('location.href')).searchParams.get('id');

await step('N1', async () => {
  await newPatient({ name: 'Pruebas Con Peso', weight: '72.5', height: '168' });
  const f = await nutri.eval(`({ h: document.querySelector('label[for=pf-height]').textContent, w: document.querySelector('label[for=pf-weight]').textContent, req: document.getElementById('pf-weight').required || document.getElementById('pf-height').required,
    help: [...new Set(['pf-height', 'pf-weight'].map((id) => document.getElementById(document.getElementById(id).getAttribute('aria-describedby'))?.textContent))] })`);
  check('N1 the form has Estatura (cm) and Peso (kg), neither required; both point to "Estatura y peso son opcionales…"',
    f.h === 'Estatura (cm)' && f.w === 'Peso (kg)' && !f.req && f.help.length === 1 && f.help[0].startsWith('Estatura y peso son opcionales'), JSON.stringify(f));
  await nutri.screenshot(`${OUT}/dialog-desk.png`, { full: false });
  check('N1 Estatura and Peso boxes line up', await nutri.eval(`document.getElementById('pf-height').getBoundingClientRect().top === document.getElementById('pf-weight').getBoundingClientRect().top`));
  await nutri.click('#patient-form [type=submit]');
  await nutri.waitFor(`location.pathname === '/patient.html'`, 15000);
  const id = await idFromUrl();
  const m = (await api(`/api/collections/measurements/records?filter=${encodeURIComponent(`patient = "${id}"`)}`)).items || [];
  const p = await api(`/api/collections/patients/records/${id}`);
  check('N1 a typed weight becomes the first measurement, dated today', m.length === 1 && m[0].weight_kg === 72.5 && m[0].date.startsWith(today), JSON.stringify(m));
  check('N1 the height is saved on the patient', p.height_cm === 168, p.height_cm);
  await nutri.goto(`${BASE}/patient.html?id=${id}&tab=measurements`);
  await nutri.waitFor(`document.body.textContent.includes('72.5') || document.body.textContent.includes('72,5')`);
  check('N1 the patient page shows it under Mediciones', true);
});

await step('N2', async () => {
  await newPatient({ name: 'Pruebas Sin Peso' });
  await nutri.click('#patient-form [type=submit]');
  await nutri.waitFor(`location.pathname === '/patient.html'`, 15000);
  const id = await idFromUrl();
  const m = (await api(`/api/collections/measurements/records?filter=${encodeURIComponent(`patient = "${id}"`)}`)).items || [];
  const p = await api(`/api/collections/patients/records/${id}`);
  check('N2 both empty: the patient saves, with no measurement and no height', id && m.length === 0 && !p.height_cm, `${m.length} ${p.height_cm}`);
});

await step('N3', async () => {
  for (const bad of ['0', '401']) {
    await newPatient({ name: `Pruebas Peso ${bad}`, weight: bad });
    await nutri.click('#patient-form [type=submit]');
    await new Promise((r) => setTimeout(r, 800));
    const still = await nutri.eval(`location.pathname === '/patients.html' && document.getElementById('patient-dialog').open && !document.getElementById('pf-weight').validity.valid`);
    check(`N3 ${bad} kg is refused by the form before saving`, still);
  }
  const all = (await api(`/api/collections/patients/records?filter=${encodeURIComponent('name ~ "Pruebas Peso"')}`)).items || [];
  check('N3 …and no patient was created', all.length === 0, all.length);
});

await step('N4', async () => {
  const phone = await as('nutritionist', { width: 390, height: 844, mobile: true });
  await phone.goto(`${BASE}/patients.html`);
  await phone.waitFor(`document.getElementById('tab-archived')?.textContent.includes('(')`);
  await phone.click('#new-patient');
  await phone.waitFor(`document.getElementById('patient-dialog').open`);
  await new Promise((r) => setTimeout(r, 600));   // let the open animation finish before the picture
  check('N4 phone 390 px: the dialog fits, no sideways scroll, Estatura and Peso line up', await phone.eval(`document.getElementById('pf-height').getBoundingClientRect().top === document.getElementById('pf-weight').getBoundingClientRect().top`) && await phone.eval(`document.documentElement.scrollWidth <= innerWidth && document.querySelector('#patient-dialog > div').scrollWidth <= document.querySelector('#patient-dialog > div').clientWidth`));
  await phone.screenshot(`${OUT}/dialog-phone.png`, { full: false });
});

const errs = nutri.errors.join(' | ');
check('no console errors', !errs, errs);
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
