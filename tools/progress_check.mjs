// tools/progress_check.mjs — screen acceptance for progress photos (slice 2 of the activity dashboard).
// THROWAWAY server seeded with tools/seed.py; PHOTO = any local JPEG:
//   PHOTO=path/to/photo.jpg node tools/progress_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
const PHOTO = process.env.PHOTO;
if (!PHOTO) { console.error('Set PHOTO to a local JPEG.'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launch({ port: 9339, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const ana = await as('ana', { width: 390, height: 844, mobile: true });
const nutri = await as('nutritionist', { width: 1280, height: 900 });
const anaId = t.ana_id;

async function upload(pose) {
  await ana.goto(`${BASE}/progress-photo.html`);
  await ana.waitFor(`document.querySelectorAll('#poses input').length === 4`);
  await ana.click(`input[name=pose][value=${pose}]`);
  await ana.setFile('#photo', PHOTO);
  await ana.waitFor(`!document.getElementById('preview').hidden`);
  await ana.click('#pp-form [type=submit]');
  await ana.waitUrl('/progress.html');
  await ana.waitFor(`document.querySelector('.plato-progress-item img')?.complete && document.querySelector('.plato-progress-item img').naturalWidth > 0`);
}

await step('P1', async () => {
  await ana.goto(`${BASE}/log.html`);
  await ana.waitFor(`document.querySelectorAll('.plato-log-type a').length === 3`);
  await ana.click('.plato-log-type a[href="/progress-photo.html"]');
  await ana.waitUrl('/progress-photo.html');
  await ana.waitFor(`document.querySelectorAll('#poses input').length === 4`);
  const first = await ana.eval(`document.querySelector('#poses input:checked').value`);
  check('P1 Registrar → Progreso opens the form; 4 poses, "Frente" picked', first === 'front', first);
  check('P1 the form gives the photo tip and says who can see it', /misma luz/.test(await ana.text('#tip')) && /Solo tú y tu nutrióloga/.test(await ana.text('#privacy')));
  await ana.click('#pp-form [type=submit]');
  check('P1 sending without a photo is stopped', await ana.eval(`document.getElementById('photo').validationMessage !== '' && location.pathname === '/progress-photo.html'`));
  await ana.setFile('#photo', PHOTO);
  await ana.waitFor(`!document.getElementById('preview').hidden`);
  await ana.screenshot(`${OUT}/progress-form.png`, { full: true });
  await ana.click('#pp-form [type=submit]');
  await ana.waitUrl('/progress.html');
  await ana.waitFor(`document.querySelector('.plato-progress-item img')?.naturalWidth > 0`);
  const label = await ana.text('.plato-progress-item .plato-small');
  const noDelete = await ana.eval(`!document.querySelector('.plato-progress-item button') && /Pídeselo/.test(document.querySelector('main').textContent)`);
  check('P1 after sending: the photo shows on Progreso as "Frente"', label === 'Frente', label);
  check('P1 setting off (default): no delete button, the patient is told to ask', noDelete);
  await ana.screenshot(`${OUT}/progress-page.png`, { full: true });
});

await step('N1', async () => {
  await nutri.goto(`${BASE}/patients.html`);
  await nutri.waitFor(`document.querySelector('.plato-patient-link')`);
  const badges = await nutri.eval(`[...document.querySelectorAll('.plato-badge-new')].map(b => b.textContent.trim()).join(' | ')`);
  check('N1 patient list: Ana shows "1 foto de progreso"', badges.includes('1 foto de progreso'), badges);
  await nutri.goto(`${BASE}/patient.html?id=${anaId}&tab=log`);
  await nutri.waitFor(`document.querySelector('.plato-log-card--progress img')?.naturalWidth > 0`);
  const title = await nutri.text('.plato-log-card--progress strong');
  check('N1 Registros shows the photo as "Foto de progreso · Frente" with a delete button', title === 'Foto de progreso · Frente' &&
    await nutri.eval(`!!document.querySelector('.plato-log-card--progress [aria-label^="Borrar"]')`), title);
  await nutri.screenshot(`${OUT}/registros-progress.png`, { full: false });
  await nutri.click('.plato-log-card--progress [aria-label^="Marcar vista"]');
  await nutri.waitFor(`document.querySelector('.plato-log-card--progress .badge')?.textContent.includes('Vista')`);
  check('N1 "Marcar vista" on the progress photo', true);
});

await step('S1', async () => {
  await nutri.goto(`${BASE}/patients.html`);
  await nutri.waitFor(`document.getElementById('settings-link')`);
  await nutri.click('#settings-link');
  await nutri.waitUrl('/settings.html');
  await nutri.waitFor(`!document.getElementById('allow-delete').disabled`);
  const off = await nutri.eval(`!document.getElementById('allow-delete').checked`);
  await nutri.click('#allow-delete');
  await nutri.waitFor(`!document.getElementById('allow-delete').disabled && document.getElementById('allow-help').textContent.startsWith('Encendido')`);
  await nutri.screenshot(`${OUT}/settings.png`, { full: false });
  await nutri.goto(`${BASE}/settings.html`);
  await nutri.waitFor(`!document.getElementById('allow-delete').disabled`);
  check('S1 Ajustes: the switch starts off, turns on, and stays on after reload', off && await nutri.eval(`document.getElementById('allow-delete').checked`));
});

await step('P2', async () => {
  await ana.goto(`${BASE}/progress.html`);
  await ana.waitFor(`document.querySelector('.plato-progress-item button')`);
  check('P2 setting on: the patient sees a delete button', true);
  await ana.eval('window.confirm = () => true');
  await ana.click('.plato-progress-item button');
  await ana.waitFor(`document.getElementById('pp-status').textContent.startsWith('Aún no tienes')`);
  check('P2 the patient deletes the photo', true);
});

await step('N2', async () => {
  await upload('side');
  await nutri.goto(`${BASE}/patient.html?id=${anaId}&tab=log`);
  await nutri.waitFor(`document.querySelector('.plato-log-card--progress')`);
  await nutri.eval('window.confirm = () => true');
  await nutri.click('.plato-log-card--progress [aria-label^="Borrar"]');
  await nutri.waitFor(`!document.querySelector('.plato-log-card--progress')`);
  check('N2 the nutritionist deletes a progress photo from Registros', true);
});

await step('X1', async () => {
  await upload('back');
  await nutri.goto(`${BASE}/export.html?id=${anaId}`);
  await nutri.waitFor(`!document.getElementById('sheet').hidden`);
  const hidden = await nutri.eval(`document.getElementById('progress-section').hidden && !document.getElementById('with-progress').checked`);
  const fetchedBefore = await nutri.eval(`document.querySelectorAll('#progress-photos img').length`);
  await nutri.click('#with-progress');
  await nutri.waitFor(`!document.getElementById('progress-section').hidden && document.querySelector('#progress-photos img')?.naturalWidth > 0`);
  const title = await nutri.eval(`document.querySelector('#progress-section h2').textContent`);
  check('X1 export: progress photos are off by default and not even loaded', hidden && fetchedBefore === 0, `${hidden} ${fetchedBefore}`);
  check('X1 export: ticking "Incluir fotos de progreso" adds them', title === 'Fotos de progreso (1)', title);
});

await sleep(200);
const errs = [...ana.errors, ...nutri.errors];
check('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
