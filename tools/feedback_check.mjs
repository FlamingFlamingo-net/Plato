// tools/feedback_check.mjs — screen acceptance for photo feedback (spec "Feature: Photo feedback").
// THROWAWAY server seeded with tools/seed.py (Ana has 2 meal photos from yesterday); PHOTO = any local JPEG:
//   PHOTO=photo.jpg node tools/feedback_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
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

const browser = await launch({ port: 9341, profileDir: `${OUT}/chrome-profile` });
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
const firstMealCard = `[...document.querySelectorAll('#feed .plato-log-card:not(.plato-log-card--activity):not(.plato-log-card--progress)')][0]`;
const openRegistros = async () => {
  await nutri.goto(`${BASE}/patient.html?id=${anaId}&tab=log`);
  await nutri.waitFor(`${firstMealCard}?.querySelector('img')?.naturalWidth > 0`);
};

await step('B1', async () => {
  await openRegistros();
  const before = Number(await nutri.text('#log-count'));
  await nutri.eval(`${firstMealCard}.querySelector('[aria-label^="Dar retroalimentación"]').click()`);
  await nutri.waitFor(`document.getElementById('fb-dialog').open`);
  check('B1 meal photo: the dialog offers stars (Sin estrellas / 1 / 2 / 3)', await nutri.eval(`!document.getElementById('fb-stars').hidden && document.querySelectorAll('#fb-stars input').length === 4`));
  await nutri.click('#fb-save');
  const err = await nutri.eval(`document.querySelector('#fb-form .plato-form-error:not([hidden])')?.textContent || ''`);
  check('B2 neither stars nor comment: "Elige estrellas o escribe un comentario."', err === 'Elige estrellas o escribe un comentario.', err);
  await nutri.click('#fb-stars input[value="3"]');
  await nutri.fill('#fb-text', '¡Muy buen plato! Agrega más verdura en la cena.');
  await nutri.screenshot(`${OUT}/feedback-dialog.png`, { full: false });
  await nutri.click('#fb-save');
  await nutri.waitFor(`!document.getElementById('fb-dialog').open && ${firstMealCard}.querySelector('.plato-feedback')`);
  const shown = await nutri.eval(`({ stars: ${firstMealCard}.querySelector('.plato-stars')?.getAttribute('aria-label'), text: ${firstMealCard}.querySelector('.plato-feedback p')?.textContent,
    seenBtn: !!${firstMealCard}.querySelector('[aria-label^="Marcar vista"]'), edit: !!${firstMealCard}.querySelector('[aria-label^="Editar retroalimentación"]') })`);
  const after = Number(await nutri.text('#log-count') || 0);
  check('B1 the card shows ★★★ "¡Excelente!" and the comment, with Editar / Quitar', shown.stars === '3 de 3 estrellas: ¡Excelente!' && shown.text.startsWith('¡Muy buen plato!') && shown.edit, JSON.stringify(shown));
  check('B1 feedback counts as seen (no "Marcar vista"; unseen count down by one)', !shown.seenBtn && after === before - 1, `${before} -> ${after}`);
  await nutri.screenshot(`${OUT}/registros-feedback.png`, { full: false });
});

await step('P1', async () => {
  await ana.goto(`${BASE}/progress.html`);
  await ana.waitFor(`document.querySelector('.plato-bottom-nav a[href="/today.html"] .plato-nav-dot')`);
  check('P1 a dot on "Hoy" tells the patient there is new feedback', true);
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`!document.getElementById('fb-section').hidden && document.querySelector('#fb-list .plato-feedback')`);
  const item = await ana.eval(`({ who: document.querySelector('#fb-list .plato-feedback strong').textContent, stars: document.querySelector('#fb-list .plato-stars').getAttribute('aria-label'),
    isNew: !!document.querySelector('#fb-list .plato-badge-new'), text: document.querySelector('#fb-list .plato-feedback p').textContent })`);
  check('P1 Hoy shows "Tu nutrióloga/o: ★★★ ¡Excelente!" with the comment, marked Nuevo', item.who === 'Tu nutrióloga/o:' && item.stars.endsWith('¡Excelente!') && item.isNew && item.text.startsWith('¡Muy buen plato!'), JSON.stringify(item));
  await ana.screenshot(`${OUT}/today-feedback.png`, { full: true });
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`document.querySelector('#fb-list .plato-feedback')`);
  check('P1 once seen, "Nuevo" goes away', await ana.eval(`!document.querySelector('#fb-list .plato-badge-new')`));
});

await step('B3', async () => {
  await openRegistros();
  await nutri.eval(`${firstMealCard}.querySelector('[aria-label^="Editar retroalimentación"]').click()`);
  await nutri.waitFor(`document.getElementById('fb-dialog').open && document.getElementById('fb-text').value.startsWith('¡Muy buen')`);
  check('B3 Editar opens with the current stars and comment', await nutri.eval(`document.querySelector('#fb-stars input:checked').value === '3'`));
  await nutri.click('#fb-stars input[value="2"]');
  await nutri.fill('#fb-text', 'Buen plato. Cuida la porción de tortilla.');
  await nutri.click('#fb-save');
  await nutri.waitFor(`${firstMealCard}.querySelector('.plato-stars')?.getAttribute('aria-label') === '2 de 3 estrellas: Bien'`);
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`document.querySelector('#fb-list .plato-feedback')`);
  const ed = await ana.eval(`document.querySelector('#fb-list .plato-feedback').textContent`);
  check('B3 the patient sees the new version, "(editada)"', ed.includes('(editada)') && ed.includes('Cuida la porción'), ed);
});

await step('B1p', async () => {
  await ana.goto(`${BASE}/progress-photo.html`);
  await ana.waitFor(`document.querySelectorAll('#poses input').length === 4`);
  await ana.setFile('#photo', PHOTO);
  await ana.waitFor(`!document.getElementById('preview').hidden`);
  await ana.click('#pp-form [type=submit]');
  await ana.waitUrl('/progress.html');
  await openRegistros();
  await nutri.waitFor(`document.querySelector('.plato-log-card--progress [aria-label^="Dar retroalimentación"]')`);
  await nutri.click('.plato-log-card--progress [aria-label^="Dar retroalimentación"]');
  await nutri.waitFor(`document.getElementById('fb-dialog').open`);
  check('B1 progress photo: no stars in the dialog, comment only', await nutri.eval(`document.getElementById('fb-stars').hidden`));
  await nutri.click('#fb-save');
  const err = await nutri.eval(`document.querySelector('#fb-form .plato-form-error:not([hidden])')?.textContent || ''`);
  await nutri.fill('#fb-text', 'Se nota tu constancia. ¡Sigue así!');
  await nutri.click('#fb-save');
  await nutri.waitFor(`document.querySelector('.plato-log-card--progress .plato-feedback p')`);
  check('B1 progress photo: empty comment refused, then the comment shows without stars', err === 'Escribe un comentario.' &&
    await nutri.eval(`!document.querySelector('.plato-log-card--progress .plato-stars')`), err);
  await ana.goto(`${BASE}/progress.html`);
  await ana.waitFor(`document.querySelector('.plato-progress-item .plato-feedback p')`);
  check('B1 the patient sees the comment under the progress photo', (await ana.text('.plato-progress-item .plato-feedback p')).startsWith('Se nota tu constancia'));
  await ana.screenshot(`${OUT}/progress-feedback.png`, { full: true });
});

await step('X1', async () => {
  await nutri.goto(`${BASE}/export.html?id=${anaId}`);
  await nutri.waitFor(`!document.getElementById('sheet').hidden`);
  const fb = await nutri.eval(`[...document.querySelectorAll('.doc-feedback')].map(p => p.textContent)`);
  check('X1 export: the feedback goes with the meal photo', fb.some((x) => x === 'Nutrióloga/o: ★★ Bien · Buen plato. Cuida la porción de tortilla.'), fb.join(' | '));
});

await step('B3r', async () => {
  await openRegistros();
  await nutri.eval('window.confirm = () => true');
  await nutri.eval(`${firstMealCard}.querySelector('[aria-label^="Quitar retroalimentación"]').click()`);
  await nutri.waitFor(`!${firstMealCard}.querySelector('.plato-feedback') && ${firstMealCard}.querySelector('[aria-label^="Dar retroalimentación"]')`);
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`document.getElementById('act-status').textContent || document.querySelector('#activities li')`);
  check('B3 Quitar removes it for both sides', await ana.eval(`document.getElementById('fb-section').hidden`));
});

await step('B6', async () => {
  await nutri.eval(`fetch('/api/plato/patients/${anaId}/close', { method: 'POST', headers: { Authorization: ${JSON.stringify(t.nutritionist.token)}, 'Content-Type': 'application/json' }, body: '{}' })`);
  await openRegistros();
  await nutri.waitFor(`document.querySelector('.plato-log-card--progress .plato-feedback')`);
  check('B6 closed account: feedback stays, no feedback buttons', await nutri.eval(`!document.querySelector('[aria-label^="Dar retroalimentación"], [aria-label^="Editar retroalimentación"], [aria-label^="Quitar retroalimentación"]')`));
});

const errs = [...nutri.errors, ...ana.errors].filter((e) => !/401|Unauthorized/.test(e));
check('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
