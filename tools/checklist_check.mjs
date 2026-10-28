// tools/checklist_check.mjs — screen acceptance for the meal checklist (spec "Feature: Weekly goals", slice 1).
// THROWAWAY server seeded with tools/seed.py (Ana: a diet for every day; yesterday breakfast + lunch photos).
//   PHOTO=photo.jpg node tools/checklist_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
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

const browser = await launch({ port: 9344, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const ana = await as('ana', { width: 390, height: 844, mobile: true });
const nutri = await as('nutritionist', { width: 1280, height: 900 });
const row = (slot) => `#meals li[data-slot="${slot}"]`;
const openToday = async (q = '') => {
  await ana.goto(`${BASE}/today.html${q}`);
  await ana.waitFor(`document.querySelectorAll('#meals .plato-meal').length > 0`);
  await ana.eval('window.confirm = () => true');
};
const firstSlot = async () => ana.eval(`document.querySelector('#meals .plato-meal')?.dataset.slot`);
const cnt = async () => ana.text('.plate-count');

let slot;
await step('C1', async () => {
  await openToday();
  slot = await firstSlot();
  const s = await ana.eval(`(() => { const li = document.querySelector('${row('X')}'.replace('X', ${JSON.stringify('')}) ) || document.querySelector('#meals .plato-meal');
    return { photoLink: !!li.querySelector('a.plato-meal-photo'), pressed: li.querySelector('.plato-check').getAttribute('aria-pressed'), label: li.querySelector('.plato-check').getAttribute('aria-label') }; })()`);
  check('C1 unchecked meal: only the check (no "Agregar foto"), labelled "Marcar … como comido"', !s.photoLink && s.pressed === 'false' && /^Marcar .+ como comido$/.test(s.label), JSON.stringify(s));
  await ana.screenshot(`${OUT}/checklist-empty.png`, { full: true });
});

await step('C2', async () => {
  const before = await cnt();
  await ana.click(`${row(slot)} .plato-check`);
  await ana.waitFor(`document.querySelector('${row(slot)} .plato-check').getAttribute('aria-pressed') === 'true'`);
  const after = await cnt();
  check('C2 one tap checks it (no photo), the plate fills a slice, "Agregar foto" appears', before.startsWith('0/') && after.startsWith('1/') &&
    await ana.eval(`!!document.querySelector('${row(slot)} a.plato-meal-photo')`), `${before} → ${after}`);
  await openToday();
  check('C2 the check survives a refresh', await ana.eval(`document.querySelector('${row(slot)} .plato-check').getAttribute('aria-pressed') === 'true'`));
});

await step('C3', async () => {
  await ana.click(`${row(slot)} .plato-check`);
  await ana.waitFor(`document.querySelector('${row(slot)} .plato-check').getAttribute('aria-pressed') === 'false'`);
  check('C3 tapping again undoes it the same day', (await cnt()).startsWith('0/'));
});

await step('C4', async () => {
  await ana.click(`${row(slot)} .plato-check`);
  await ana.waitFor(`document.querySelector('${row(slot)} a.plato-meal-photo')`);
  await ana.click(`${row(slot)} a.plato-meal-photo`);
  await ana.waitUrl('/log.html');
  await ana.waitFor(`document.querySelector('input[name=slot][value=${slot}]')?.checked`);
  await ana.setFile('#photo', PHOTO);
  await ana.waitFor(`!document.getElementById('preview').hidden`);
  await ana.click('#log-form [type=submit]');
  await ana.waitUrl('/today.html');
  await ana.waitFor(`document.querySelector('${row(slot)} .plato-meal-thumbs img')?.naturalWidth > 0`);
  const n = await ana.eval(`fetch('/api/collections/meal_logs/records?filter=' + encodeURIComponent('date = "' + ${JSON.stringify(new Date().toLocaleDateString('en-CA'))} + '" && slot = "${slot}"'), { headers: { Authorization: ${JSON.stringify(t.ana.token)} } }).then(r => r.json()).then(j => j.items.length + ':' + !!j.items[0].photo)`);
  check('C4 "Agregar foto" attaches the photo to the same check (one log, with photo)', n === '1:true', n);
  check('C4 the button now says "Otra foto"', (await ana.text(`${row(slot)} a.plato-meal-photo`)).includes('Otra foto'));
});

await step('C5', async () => {
  await ana.eval(`window.__asked = ''; window.confirm = (m) => { window.__asked = m; return true; }`);
  await ana.click(`${row(slot)} .plato-check`);
  await ana.waitFor(`document.querySelector('${row(slot)} .plato-check').getAttribute('aria-pressed') === 'false'`);
  const asked = await ana.eval('window.__asked');
  check('C5 undoing a check with a photo asks first ("Se quitará también la foto") and removes both', asked.includes('Se quitará también la foto') &&
    !(await ana.eval(`!!document.querySelector('${row(slot)} .plato-meal-thumbs')`)), asked);
});

await step('C6', async () => {
  await ana.click('#add-extra');
  await ana.waitUrl('/log.html');
  await ana.waitFor(`document.querySelector('input[name=slot][value=extra]')?.checked`);
  await ana.click('#log-form [type=submit]');
  await sleep(200);
  const msg = await ana.eval(`document.getElementById('photo').validationMessage`);
  check('C6 an extra needs a photo or a note', msg === 'Agrega una foto o una nota de lo que comiste.', msg);
  await ana.fill('#note', 'Un pan dulce en la oficina');
  await ana.click('#log-form [type=submit]');
  await ana.waitUrl('/today.html');
  await ana.waitFor(`document.querySelector('#extras .plato-meal')`);
  const txt = await ana.text('#extras .plato-meal');
  check('C6 the extra shows under "Comidas extra" with its note; no count, no warning', txt.includes('Comida extra') && txt.includes('Un pan dulce') &&
    (await cnt()).startsWith('0/') && await ana.eval(`document.getElementById('extras-empty').hidden`), txt);
  await ana.screenshot(`${OUT}/checklist-extra.png`, { full: true });
});

await step('C7', async () => {
  await ana.click('#day-switch [data-day=yesterday]');
  await ana.waitFor(`document.querySelector('#day-switch [data-day=yesterday]').getAttribute('aria-pressed') === 'true' && document.getElementById('meals').getAttribute('aria-label') === 'Comidas de ayer'`);
  await ana.waitFor(`document.querySelector('${row('breakfast')} .plato-meal-thumbs img')`);
  check('C7 "Ayer" shows yesterday: the seeded breakfast and lunch photos are checked', await ana.eval(`['breakfast','lunch'].every(s => document.querySelector('#meals li[data-slot="' + s + '"] .plato-check').getAttribute('aria-pressed') === 'true')`));
  const other = await ana.eval(`[...document.querySelectorAll('#meals .plato-meal')].map(li => li.dataset.slot).find(s => !['breakfast','lunch'].includes(s))`);
  await ana.click(`${row(other)} .plato-check`);
  await ana.waitFor(`document.querySelector('${row(other)} .plato-check').getAttribute('aria-pressed') === 'true'`);
  check('C7 a meal of yesterday can still be checked', true);
  check('C7 the date line says "Ayer, …" while yesterday is shown', (await ana.text('#date')).startsWith('Ayer, '));
  // Seeded "yesterday" logs are created today, so undo is allowed (rule: same day the check was made; the server
  // sets "created", so an older check can't be faked here; that rule is the unchanged delete rule, covered by api_check).
  // Answer "Cancelar" to the photo question: the meal stays checked and the photo stays.
  await ana.eval(`window.__asked = ''; window.confirm = (m) => { window.__asked = m; return false; }`);
  await ana.click(`${row('breakfast')} .plato-check`);
  await ana.waitFor(`window.__asked !== '' && !document.querySelector('${row('breakfast')} .plato-check').disabled`);
  check('C7 "Cancelar" on the photo question keeps yesterday\'s meal checked with its photo', await ana.eval(`document.querySelector('${row('breakfast')} .plato-check').getAttribute('aria-pressed') === 'true' && !!document.querySelector('${row('breakfast')} .plato-meal-thumbs img')`));
  await ana.screenshot(`${OUT}/checklist-yesterday.png`, { full: true });
});

await step('C8', async () => {
  await nutri.goto(`${BASE}/patient.html?id=${t.ana_id}&tab=log`);
  await nutri.waitFor(`document.querySelector('.plato-log-card--check')`);
  const cards = await nutri.eval(`[...document.querySelectorAll('.plato-log-card--check')].map(c => c.innerText.replace(/\\s+/g, ' '))`);
  check('C8 nutritionist: the bare check is a compact "lo comió" line; the extra shows "Comida extra" + note',
    cards.some((c) => c.includes('lo comió')) && cards.some((c) => c.includes('Comida extra') && c.includes('Un pan dulce')), cards.join(' | '));
  check('C8 no feedback button on a check without photo', await nutri.eval(`![...document.querySelectorAll('.plato-log-card--check button')].some(b => b.textContent.includes('retroalimentación'))`));
  const badge = await nutri.eval(`document.getElementById('log-count').hidden ? '0' : document.getElementById('log-count').textContent`);
  // Expected = unseen photos/extras + unseen activities + unseen progress photos (seed adds some), never bare checks.
  const exp = await nutri.eval(`(async () => {
    const a = JSON.parse(localStorage.getItem('plato.auth')).token;
    const n = async (c, f) => (await (await fetch('/api/collections/' + c + '/records?perPage=1&fields=id&filter=' + encodeURIComponent(f), { headers: { Authorization: a } })).json()).totalItems;
    const p = 'patient = "${t.ana_id}" && seen_at = ""';
    return { counted: await n('meal_logs', p + ' && (photo != "" || slot = "extra")') + await n('activity_logs', p) + await n('progress_photos', p),
             bareChecks: await n('meal_logs', p + ' && photo = "" && slot != "extra"') };
  })()`);
  check('C8 the "sin ver" badge counts photos, extras and activities, not the unseen bare checks', badge === String(exp.counted) && exp.bareChecks > 0, `${badge} ${JSON.stringify(exp)}`);
  const lay = await nutri.eval(`(() => {
    const clipped = [...document.querySelectorAll('.plato-log-card')].filter(c => c.scrollWidth > c.clientWidth + 1).length;
    const ck = document.querySelector('.plato-log-card--check'), tall = Math.max(...[...document.querySelectorAll('.plato-log-card')].map(c => c.getBoundingClientRect().height));
    return { clipped, compact: ck.getBoundingClientRect().height < tall * 0.6 };
  })()`);
  check('C8 layout: no card content cut off; check cards stay compact next to photo cards', lay.clipped === 0 && lay.compact, JSON.stringify(lay));
  await nutri.screenshot(`${OUT}/nutri-registros.png`, { full: false });
  await nutri.goto(`${BASE}/home.html?tab=photos`);
  await nutri.waitFor(`document.querySelectorAll('.plato-home-tab').length === 6 && document.getElementById('feed-status').textContent !== 'Cargando…' && document.querySelector('#today li:not(.plato-muted)')`);
  check('C8 Inicio → Fotos lists photos only (no compact check lines)', await nutri.eval(`!document.querySelector('#cards .plato-log-card--check') && document.querySelectorAll('#cards .plato-log-card').length >= 2`));
  await nutri.click('#tab-recent');
  await nutri.waitFor(`document.querySelector('#cards .plato-log-card--check')`);
  check('C8 Inicio → Recientes shows the check and the extra as compact lines', await nutri.eval(`document.querySelectorAll('#cards .plato-log-card--check').length >= 2`));
});

await step('C9', async () => {
  await openToday();
  const a11y = await ana.eval(`[...document.querySelectorAll('.plato-check')].every(b => b.tagName === 'BUTTON' && b.getAttribute('aria-label') && b.getBoundingClientRect().width >= 44)`);
  check('C9 phone: every check is a real ≥44 px button with a label; no sideways scroll', a11y && await ana.eval(`document.documentElement.scrollWidth <= innerWidth`));
});

const errs = [...ana.errors, ...nutri.errors].filter((e) => !/status of 40[04]/.test(e));
check('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
