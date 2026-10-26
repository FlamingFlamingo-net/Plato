// tools/activity_check.mjs — screen acceptance for the activity log (slice 1 of the activity dashboard).
// THROWAWAY server seeded with tools/seed.py (Ana has one walk from yesterday):
//   node tools/activity_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };

const browser = await launch({ port: 9337, profileDir: `${OUT}/chrome-profile` });
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
const RUN = 'Correr · 30 min · 5 km · 10 km/h · 6:00 min/km · plano';
const visible = (sel) => `!document.querySelector(${JSON.stringify(sel)}).closest('[hidden]')`;

await step('P1', async () => {
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`document.getElementById('act-status').textContent || document.querySelector('#activities li')`);
  check('P1 Today shows "Actividad de hoy" with nothing logged yet', await ana.text('#act-status') === 'Aún no registras actividad hoy.', await ana.text('#act-status'));
  await ana.goto(`${BASE}/log.html`);
  await ana.waitFor(`document.querySelector('.plato-log-type a[href="/activity.html"]')`);
  await ana.click('.plato-log-type a[href="/activity.html"]');
  await ana.waitUrl('/activity.html');
  await ana.waitFor(`document.querySelectorAll('#kinds input').length === 9`);
  check('P1 Registrar → Actividad opens the activity form (9 activities)', await ana.eval(`document.querySelector('.plato-log-type [aria-current=page]').textContent === 'Actividad' && document.querySelector('.plato-bottom-nav [aria-current=page]').textContent.includes('Registrar')`));
});

await step('P2', async () => {
  await ana.click('#act-form [type=submit]');
  const err = await ana.eval(`document.querySelector('#act-form [role=alert], #act-form .plato-form-error')?.textContent || ''`);
  check('P2 sending with no activity picked says what to fix', /Elige qué actividad/.test(err), err);
  await ana.click('input[name=kind][value=gym]');
  check('P2 the error clears once an activity is picked', await ana.eval(`document.querySelector('.plato-form-error').hidden`));
  await ana.click('#more summary');
  const gymHides = await ana.eval(`document.getElementById('terrain').hidden && document.getElementById('distance-field').hidden`);
  await ana.click('input[name=kind][value=other]');
  const otherShows = await ana.eval(`!document.getElementById('other-field').hidden && document.getElementById('kind_other').required`);
  await ana.click('input[name=kind][value=run]');
  const runShows = await ana.eval(`!document.getElementById('terrain').hidden && !document.getElementById('distance-field').hidden && document.getElementById('other-field').hidden`);
  check('P2 details follow the activity: gym has no terrain/distance, "Otra" asks a name, running has both', gymHides && otherShows && runShows, `${gymHides} ${otherShows} ${runShows}`);
  await ana.fill('#minutes', '30');
  await ana.click('input[name=terrain][value=flat]');
  await ana.fill('#distance_km', '5');
  const speed = await ana.text('#speed');
  check('P2 speed is worked out: "10 km/h · ritmo 6:00 min/km"', speed === 'Velocidad: 10 km/h · ritmo 6:00 min/km', speed);
  check('P2 date defaults to today, max today, min 7 days back', await ana.eval(`(() => { const d = document.getElementById('date'); const b = new Date(); b.setDate(b.getDate() - 7);
    const ymd = (x) => x.toLocaleDateString('en-CA'); return d.value === ymd(new Date()) && d.max === d.value && d.min === ymd(b); })()`));
  await ana.fill('#note', 'Parque');
  await new Promise((r) => setTimeout(r, 600)); // Basecoat animates <details> opening
  const fits = await ana.eval(`(() => { const d = document.getElementById('more').getBoundingClientRect();
    const last = document.getElementById('speed').getBoundingClientRect(); const note = document.getElementById('note').getBoundingClientRect();
    return last.bottom <= d.bottom && d.bottom <= note.top; })()`);
  check('P2 "Más detalles" grows with its content (nothing spills over the note)', fits);
  check('P2 summary reads "Más detalles (opcional)" with its space', await ana.eval(`getComputedStyle(document.querySelector('#more summary')).columnGap !== 'normal'`));
  await ana.screenshot(`${OUT}/activity-form.png`, { full: true });
  await ana.click('#act-form [type=submit]');
  await ana.waitUrl('/today.html');
  await ana.waitFor(`document.querySelector('#activities li h3')`);
  const summary = await ana.text('#activities li h3');
  check('P2 after sending: back on Today with the run listed', summary === RUN, summary);
  await ana.screenshot(`${OUT}/today-activity.png`, { full: true });
});

let before = 0;
await step('N1', async () => {
  await nutri.goto(`${BASE}/patients.html`);
  await nutri.waitFor(`document.querySelector('.plato-patient-link')`);
  const badges = await nutri.eval(`[...document.querySelectorAll('.plato-badge-new')].map(b => b.textContent.trim()).join(' | ')`);
  check('N1 patient list: Ana shows "2 actividades nuevas"', badges.includes('2 actividades nuevas'), badges);
  await nutri.goto(`${BASE}/patient.html?id=${anaId}&tab=log`);
  await nutri.waitFor(`document.querySelector('.plato-log-card--activity')`);
  const tab = await nutri.text('#t-log');
  before = Number(await nutri.text('#log-count'));
  const cards = await nutri.eval(`[...document.querySelectorAll('#feed > li')].map(li => li.classList.contains('plato-feed-day') ? '#' : li.classList.contains('plato-log-card--activity') ? 'A' : 'M').join('')`);
  const first = await nutri.eval(`document.querySelector('.plato-log-card--activity p').textContent`);
  check('N1 "Registros" tab: today\'s run first, then yesterday\'s walk and meals', tab.startsWith('Registros') && cards.startsWith('#A#') && first === RUN, `${tab} ${cards} ${first}`);
  await nutri.screenshot(`${OUT}/registros.png`, { full: false });
  await nutri.click('.plato-log-card--activity button');
  await nutri.waitFor(`Number(document.getElementById('log-count').textContent) === ${before - 1}`);
  check('N1 "Marcar vista" on the run lowers the unseen count by one', await nutri.eval(`document.querySelector('.plato-log-card--activity .badge')?.textContent.includes('Vista')`));
});

await step('P3', async () => {
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`document.querySelector('#activities .plato-meal-status')`);
  check('P3 the patient sees "Vista por tu nutrióloga/o" on the run', (await ana.text('#activities .plato-meal-status')).includes('Vista por tu nutrióloga/o'));
});

await step('X1', async () => {
  await nutri.goto(`${BASE}/export.html?id=${anaId}`);
  await nutri.waitFor(`!document.getElementById('sheet').hidden`);
  const titles = await nutri.eval(`[...document.querySelectorAll('#sheet h2')].map(h => h.textContent)`);
  const rows = await nutri.eval(`[...document.querySelectorAll('#sheet table')].at(-1).querySelectorAll('tbody tr').length`);
  check('X1 export has "Actividad física (2)" with both entries', titles.includes('Actividad física (2)') && rows === 2, `${titles} ${rows}`);
});

await step('P4', async () => {
  await ana.eval('window.confirm = () => true');
  await ana.click('#activities li button');
  await ana.waitFor(`document.getElementById('act-status').textContent === 'Aún no registras actividad hoy.'`);
  check('P4 the patient deletes today\'s activity', true);
});

const errs = [...ana.errors, ...nutri.errors];
check('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
