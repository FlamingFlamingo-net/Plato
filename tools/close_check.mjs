// tools/close_check.mjs — screen acceptance for "Close a patient's account" (rules are in api_check.py).
// THROWAWAY server seeded with tools/seed.py:
//   node tools/close_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await launch({ port: 9336, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport = { width: 1280, height: 900 }) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const nutri = await as('nutritionist');
const ana = await as('ana', { width: 390, height: 844, mobile: true });
const { ana_id: anaId, carlos_id: carlosId } = t;
const listNames = (p) => p.eval(`[...document.querySelectorAll('.plato-patient-meta strong')].map(s => s.textContent)`);
const typeAndCheck = async (sel, value, btn) => { await nutri.fill(sel, value); return nutri.eval(`document.getElementById('${btn}').disabled`); };

// 1. Close Carlos through the dialog (typed first name).
await step('S1', async () => {
  await nutri.goto(`${BASE}/patient.html?id=${carlosId}&tab=access`);
  await nutri.waitFor(`!document.getElementById('close-card').hidden`);
  check('S1 active patient: "Cerrar cuenta" card shown, archived card hidden', await nutri.eval(`document.getElementById('archived-card').hidden && !document.getElementById('invite-card').hidden`));
  await nutri.click('#close-open');
  await nutri.waitFor(`document.getElementById('close-dialog').open`);
  const label = await nutri.text('#cd-label');
  const offEmpty = await nutri.eval(`document.getElementById('cd-confirm').disabled`);
  const offWrong = await typeAndCheck('#cd-name', 'Carla', 'cd-confirm');
  const onRight = !(await typeAndCheck('#cd-name', 'carlos', 'cd-confirm'));
  check('S1 confirm needs the first name ("Carlos", any case); wrong name keeps it off', offEmpty && offWrong && onRight && label.includes('Carlos'), `${offEmpty} ${offWrong} ${onRight} ${label}`);
  await nutri.screenshot(`${OUT}/close-dialog.png`, { full: false });
  await nutri.click('#cd-confirm');
  await nutri.waitFor(`location.search.includes('tab=access') && !location.search.includes('closed=1') && !document.getElementById('archived-card').hidden`);
  const banner = await nutri.eval(`!document.getElementById('closed-banner').hidden && document.getElementById('closed-title').textContent`);
  check('S1 after closing: banner "Cuenta cerrada el …", Reactivar / Borrar shown, invite hidden',
    /^Cuenta cerrada el /.test(banner) && await nutri.eval(`document.getElementById('invite-card').hidden && document.getElementById('close-card').hidden`), banner);
  await nutri.screenshot(`${OUT}/closed-access.png`, { full: false });
});

// 2. Lists.
await step('S2', async () => {
  await nutri.goto(`${BASE}/patients.html`);
  await nutri.waitFor(`document.querySelectorAll('.plato-patient-link').length >= 1`);
  const active = await listNames(nutri);
  await nutri.goto(`${BASE}/patients.html?view=archived`);
  await nutri.waitFor(`document.querySelectorAll('.plato-patient-link').length >= 1`);
  const archived = await listNames(nutri);
  const badge = await nutri.eval(`document.querySelector('.plato-patient-link .badge')?.textContent || ''`);
  const newHidden = await nutri.eval(`document.getElementById('new-patient').hidden`);
  check('S2 Carlos leaves the main list and appears under Archivados with "Cerrada el …"',
    !active.includes('Carlos Ruiz Peña') && archived.join() === 'Carlos Ruiz Peña' && /^Cerrada el /.test(badge) && newHidden, `${active} | ${archived} | ${badge}`);
  await nutri.screenshot(`${OUT}/archived-list.png`, { full: false });
});

// 3. Read-only screens.
await step('S3', async () => {
  await nutri.goto(`${BASE}/patient.html?id=${carlosId}&tab=overview`);
  await nutri.waitFor(`document.querySelector('#m-rows td')`);
  const ov = await nutri.eval(`document.getElementById('m-form').hidden && !document.querySelector('#m-rows button')`);
  await nutri.click('#t-diet');
  await nutri.waitFor(`document.getElementById('meal-breakfast')`);
  const dt = await nutri.eval(`document.getElementById('meal-breakfast').readOnly && document.querySelector('#diet-form [type=submit]').hidden && document.getElementById('copy-day').hidden`);
  await nutri.click('#t-notes');
  const nt = await nutri.eval(`document.getElementById('note-form').hidden`);
  check('S3 closed account is read-only: no measurement form or delete, diet read-only, no note form', ov && dt && nt, `${ov} ${dt} ${nt}`);
  await nutri.goto(`${BASE}/export.html?id=${carlosId}`);
  await nutri.waitFor(`!document.getElementById('sheet').hidden`);
  check('S3 a closed account can still be exported', true);
});

// 4. Reactivate, new link, the patient joins again.
await step('S4', async () => {
  await nutri.goto(`${BASE}/patient.html?id=${carlosId}&tab=access`);
  await nutri.waitFor(`!document.getElementById('archived-card').hidden`);
  await nutri.eval('window.confirm = () => true');
  await nutri.click('#reopen');
  await nutri.waitFor(`!document.getElementById('invite-card').hidden && !document.getElementById('close-card').hidden && document.getElementById('closed-banner').hidden`);
  await nutri.click('#make-link');
  const link = await nutri.waitFor(`document.getElementById('invite-link').value`);
  const phone = await browser.newPage({ width: 390, height: 844, mobile: true });
  await phone.goto(link);
  await phone.waitFor(`!document.getElementById('join-form').hidden`);
  const pw = randomBytes(12).toString('base64url');
  await phone.fill('#j-email', `zz-carlos-${randomBytes(3).toString('hex')}@test.local`);
  await phone.fill('#j-password', pw); await phone.fill('#j-password2', pw);
  await phone.click('#join-form [type=submit]');
  await phone.waitUrl('/today.html');
  check('S4 "Reactivar" then a new link: Carlos joins again and sees Today', true);
});

// 5. Closing ends the patient's session on the phone.
await step('S5', async () => {
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`document.querySelector('.plate-count')`);
  await nutri.goto(`${BASE}/patient.html?id=${anaId}&tab=access`);
  await nutri.waitFor(`!document.getElementById('close-card').hidden`);
  await nutri.click('#close-open');
  await nutri.fill('#cd-name', 'Ana');
  await nutri.click('#cd-confirm');
  await nutri.waitFor(`!document.getElementById('archived-card').hidden`);
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`location.pathname === '/' && !document.getElementById('ended').hidden`);
  await ana.screenshot(`${OUT}/patient-ended.png`, { full: false });
  check('S5 after closing, the patient\'s app goes to sign-in with "Tu sesión terminó"', await ana.eval(`!location.search.includes('ended')`));
});

// 6. Permanent delete (typed full name).
await step('S6', async () => {
  await nutri.goto(`${BASE}/patient.html?id=${anaId}&tab=access`);
  await nutri.waitFor(`!document.getElementById('archived-card').hidden`);
  await nutri.click('#delete-open');
  await nutri.waitFor(`document.getElementById('delete-dialog').open`);
  const offFirst = await typeAndCheck('#dd-name', 'Ana', 'dd-confirm');
  const onFull = !(await typeAndCheck('#dd-name', 'ana lopez rios', 'dd-confirm'));
  const warn = await nutri.text('#dd-text');
  check('S6 delete needs the full name (accents optional) and warns about 5 years', offFirst && onFull && warn.includes('5 años'), `${offFirst} ${onFull}`);
  await nutri.screenshot(`${OUT}/delete-dialog.png`, { full: false });
  await nutri.click('#dd-confirm');
  await nutri.waitUrl('/patients.html?view=archived');
  await sleep(500);
  const names = await listNames(nutri);
  check('S6 after delete: back on Archivados, Ana is gone', !names.includes('Ana López Ríos'), names.join());
  await nutri.goto(`${BASE}/patient.html?id=${anaId}`);
  await nutri.waitFor(`document.getElementById('status').textContent.startsWith('No encontrado')`);
  check('S6 the deleted patient\'s page says "No encontrado"', true);
});

const errs = [...nutri.errors, ...ana.errors].filter((e) => !/404|401|Not Found|Unauthorized|beforeunload/i.test(e));
check('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
