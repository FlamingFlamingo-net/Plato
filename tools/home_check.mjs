// tools/home_check.mjs — screen acceptance for the nutritionist's home (spec "Patient activity dashboard", slice 3).
// THROWAWAY server seeded with tools/seed.py (Ana: 2 meal photos + 1 walk from yesterday; Carlos: no app, no diet).
//   PHOTO=photo.jpg node tools/home_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
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

const browser = await launch({ port: 9343, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const nutri = await as('nutritionist', { width: 1366, height: 900 });
nutri.eval('window.confirm = () => true');
const count = (id) => nutri.eval(`document.querySelector('#tab-${id} .plato-home-count')?.textContent || '0'`);
const cardCount = () => nutri.eval(`document.querySelectorAll('#cards > li.plato-log-card').length`);
const openHome = async (tab = '') => {
  await nutri.goto(`${BASE}/home.html${tab ? `?tab=${tab}` : ''}`);
  await nutri.waitFor(`document.querySelectorAll('.plato-home-tab').length === 6 && document.getElementById('feed-status').textContent !== 'Cargando…' && document.querySelector('#today li:not(.plato-muted)')`);
  await nutri.eval('window.confirm = () => true');
};

await step('H0', async () => {
  await nutri.goto(`${BASE}/`);
  await nutri.waitUrl('/home.html');
  check('H0 a signed-in nutritionist lands on Inicio', true);
});

await step('H1', async () => {
  await openHome();
  const b = await nutri.eval(`({ name: document.getElementById('banner-name').textContent, edit: document.getElementById('banner-edit-label').textContent, photo: document.getElementById('banner-photo').classList.contains('has-photo') })`);
  check('H1 banner shows the name as text and "Agregar foto de portada" before a photo', b.name === 'Laura Méndez' && b.edit === 'Agregar foto de portada' && !b.photo, JSON.stringify(b));
  await nutri.click('#banner-edit');
  await nutri.waitUrl('/settings.html');
  await nutri.waitFor(`document.getElementById('pr-name').value === 'Laura Méndez'`);
  await nutri.setFile('#cover', PHOTO);
  await nutri.waitFor(`!document.getElementById('cover-preview').hidden`);
  await nutri.fill('#pr-whatsapp', '614 000 0000');
  await nutri.fill('#pr-instagram', '@consultorio.demo');
  await nutri.click('#profile-save');
  await nutri.waitFor(`!document.getElementById('profile-save').disabled && document.getElementById('cover').value === ''`);
  await sleep(300);
  await openHome();
  await nutri.waitFor(`document.getElementById('banner-photo').classList.contains('has-photo')`);
  const contact = await nutri.text('#banner-contact');
  check('H1 after Ajustes: the photo is the background, contact is live text on top', contact.includes('WhatsApp 614 000 0000') && contact.includes('@consultorio.demo'), contact);
  await nutri.screenshot(`${OUT}/home-desktop.png`, { full: false });
});

await step('H2', async () => {
  const a = await nutri.eval(`(() => { const g = document.getElementById('tabs').getBoundingClientRect(), hoy = document.querySelector('.plato-home-today').getBoundingClientRect(), b = document.getElementById('all-seen').getBoundingClientRect();
    return { top: Math.round(g.top - hoy.top), bottom: Math.round(g.bottom - b.bottom), width: Math.round(b.width - hoy.width), gap: Math.round(b.top - hoy.bottom) }; })()`);
  check('H2 layout: tabs and Hoy share the top edge; tabs end where the button ends; button as wide as Hoy, separate', a.top === 0 && a.bottom === 0 && a.width === 0 && a.gap > 0, JSON.stringify(a));
  const agenda = await nutri.eval(`(() => { const b = document.getElementById('tab-agenda'); b.click(); return { dis: b.getAttribute('aria-disabled'), sel: b.getAttribute('aria-selected'), lock: !!b.querySelector('.plato-home-tab-lock') }; })()`);
  check('H2 Agenda is greyed out with a lock and cannot be opened', agenda.dis === 'true' && agenda.sel === 'false' && agenda.lock, JSON.stringify(agenda));
  await nutri.eval(`document.getElementById('tab-pending').focus()`);
  await nutri.eval(`document.getElementById('tabs').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  check('H2 arrow keys move between tabs and skip Agenda', await nutri.eval(`document.activeElement.id`) === 'tab-recent');
});

await step('H3', async () => {
  await openHome('recent');
  const n = await count('recent');
  const cards = await cardCount();
  const hoy = await nutri.text('#today li');
  check('H3 Recientes: Ana\'s 2 meal photos and her walk; count 3; Hoy says 3 sin ver de 1 paciente', n === '3' && cards === 3 && hoy.startsWith('3registros sin ver de 1 paciente'), `${n} ${cards} ${hoy}`);
  await nutri.click('#tab-photos');
  await nutri.waitFor(`document.querySelectorAll('.plato-chip').length === 3 && document.getElementById('feed-status').textContent !== 'Cargando…'`);
  await nutri.click('.plato-chip:nth-child(2)');
  await nutri.waitFor(`document.querySelector('.plato-chip:nth-child(2)').getAttribute('aria-pressed') === 'true' && document.getElementById('feed-status').textContent !== 'Cargando…'`);
  const prog = await cardCount();
  await nutri.click('.plato-chip:nth-child(3)');
  await nutri.waitFor(`document.querySelector('.plato-chip:nth-child(3)').getAttribute('aria-pressed') === 'true' && document.getElementById('feed-status').textContent !== 'Cargando…'`);
  check('H3 Fotos: Progreso shows 0, Comidas shows 2', prog === 0 && await cardCount() === 2, `${prog}`);
});

await step('H4', async () => {
  await nutri.eval(`document.querySelector('#cards [aria-label^="Dar retroalimentación"]').click()`);
  await nutri.waitFor(`document.getElementById('fb-dialog').open`);
  await nutri.click('#fb-stars input[value="3"]');
  await nutri.fill('#fb-text', '¡Muy buen plato!');
  await nutri.click('#fb-save');
  await nutri.waitFor(`!document.getElementById('fb-dialog').open && document.querySelector('#cards .plato-feedback')`);
  check('H4 feedback from Inicio: shows on the card and counts as seen (Fotos 2 → 1)', await count('photos') === '1', await count('photos'));
  await nutri.click('#tab-activity');
  await nutri.waitFor(`document.querySelector('#cards .plato-log-card--activity [aria-label^="Marcar vista"]')`);
  await nutri.click('#cards .plato-log-card--activity [aria-label^="Marcar vista"]');
  await nutri.waitFor(`!document.querySelector('#tab-activity .plato-home-count')`);
  check('H4 "Marcar vista" on Actividades: its count goes away; Recientes drops to 1', await count('recent') === '1');
});

await step('H5', async () => {
  await nutri.click('#tab-recent');
  await nutri.waitFor(`document.getElementById('all-seen').textContent.includes('(1)')`);
  await nutri.click('#all-seen');
  await nutri.waitFor(`document.getElementById('all-seen').disabled && !document.querySelector('#tab-recent .plato-home-count')`);
  check('H5 "Marcar todo como visto (1)" clears the rest; the button greys out', true);
  await nutri.click('#tab-pending');
  await nutri.waitFor(`document.querySelector('.plato-pending')`);
  const texts = await nutri.eval(`[...document.querySelectorAll('.plato-pending')].map(li => li.querySelector('strong').textContent + ': ' + li.querySelector('p').textContent)`);
  check('H5 Pendientes (placeholder): Carlos has no app and no diet; the button is greyed out here',
    texts.includes('Carlos Ruiz Peña: Aún no usa la app. Mándale su enlace.') && texts.includes('Carlos Ruiz Peña: No tiene dieta asignada.') && await nutri.eval(`document.getElementById('all-seen').disabled`), texts.join(' | '));
  const ph = await nutri.eval(`new Set([...document.querySelectorAll('.plato-pending')].map(e => Math.round(e.getBoundingClientRect().height))).size`);
  check('H5 Pendientes cards are all the same height', ph === 1, ph);
  await nutri.screenshot(`${OUT}/home-pending.png`, { full: false });
});

await step('H6', async () => {
  await nutri.click('#tab-catalog');
  await nutri.waitFor(`document.querySelectorAll('.plato-catalog-card').length === 7`);
  const c = await nutri.eval(`({ live: [...document.querySelectorAll('a.plato-catalog-card')].map(a => a.getAttribute('href')), locked: document.querySelectorAll('.plato-catalog-card.is-locked[aria-disabled="true"]').length })`);
  check('H6 Catálogo: 7 lists; Pacientes and Dietas open, the 5 others are locked', c.live.join() === '/patients.html,/templates.html' && c.locked === 5, JSON.stringify(c));
  await nutri.screenshot(`${OUT}/home-catalog.png`, { full: false });
  // Edge case: very long wording on one tile must not break the grid (all tiles same height, text capped at 2 lines)
  const tiles = (sel) => nutri.eval(`(() => {
    const hs = [...document.querySelectorAll('${sel}')].map(e => Math.round(e.getBoundingClientRect().height));
    const lines = [...document.querySelectorAll('#cards strong, #cards small, #cards p')].map(e => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)));
    return { same: new Set(hs).size === 1, maxLines: Math.max(...lines), wide: document.documentElement.scrollWidth <= innerWidth, hs };
  })()`);
  const plain = await tiles('#cards .plato-catalog-card');
  await nutri.eval(`(() => { const s = document.querySelectorAll('#cards .plato-catalog-card small');
    s[1].textContent = 'Próximamente · ' + 'una descripción muy larga que ocupa varias líneas '.repeat(4);
    s[3].textContent = 'Supercalifragilisticoespialidosoextraordinariamentelargo'; })()`);
  const long = await tiles('#cards .plato-catalog-card');
  check('H6 Catálogo tiles all the same height, also with very long text (max 2 lines, no sideways scroll)',
    plain.same && long.same && long.maxLines <= 2 && long.wide, JSON.stringify({ plain, long }));
  await nutri.screenshot(`${OUT}/home-catalog-long.png`, { full: false });
});

await step('H7', async () => {
  const at = new Date().toLocaleDateString('en-CA');
  const made = await nutri.eval(`Promise.all(Array.from({ length: 60 }, (_, i) => fetch('/api/collections/activity_logs/records', { method: 'POST',
    headers: { Authorization: ${JSON.stringify(t.ana.token)}, 'Content-Type': 'application/json' },
    body: JSON.stringify({ patient: ${JSON.stringify(t.ana_id)}, date: ${JSON.stringify(at)}, kind: 'walk', minutes: i + 1 }) }).then(r => r.status))).then(s => s.filter(x => x === 200).length)`);
  if (made !== 60) throw new Error(`only ${made}/60 activities created`);
  await openHome('recent');
  const first = await cardCount();
  await nutri.click('#more');
  await nutri.waitFor(`document.querySelectorAll('#cards > li.plato-log-card').length > 50`);
  const total = await cardCount();
  const ids = await nutri.eval(`[...document.querySelectorAll('#cards > li.plato-log-card')].map(li => li.dataset.id)`);
  const dup = ids.length !== new Set(ids).size;
  check('H7 63 events: first 50, "Cargar más" shows the rest (63), no duplicates', first === 50 && total === 63 && !dup && await nutri.eval(`document.getElementById('more').hidden`), `${first} ${total} dup=${dup}`);
});

await step('H8', async () => {
  const phone = await as('nutritionist', { width: 390, height: 844, mobile: true });
  await phone.goto(`${BASE}/home.html`);
  await phone.waitFor(`document.querySelectorAll('.plato-home-tab').length === 6`);
  const cols = await phone.eval(`getComputedStyle(document.getElementById('tabs')).gridTemplateColumns.split(' ').length`);
  check('H8 phone: tabs in 2 columns, no sideways scrolling', cols === 2 && await phone.eval(`document.documentElement.scrollWidth <= innerWidth`), cols);
  await phone.screenshot(`${OUT}/home-phone.png`, { full: false });
  nutri.errors.push(...phone.errors);
});

const errs = nutri.errors;
check('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
