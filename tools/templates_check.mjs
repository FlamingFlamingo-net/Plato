// tools/templates_check.mjs — screen acceptance for saved diet templates (spec "Feature: Saved diet templates").
// THROWAWAY server seeded with tools/seed.py (Ana has a weekly diet, Carlos has none):
//   node tools/templates_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };

const browser = await launch({ port: 9340, profileDir: `${OUT}/chrome-profile` });
const nutri = await browser.newPage({ width: 1280, height: 900 });
await nutri.goto(`${BASE}/manifest.webmanifest`);
const s = t.nutritionist;
await nutri.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
const { ana_id: anaId, carlos_id: carlosId } = t;
// Read data straight from the API with the nutritionist's token (to prove what is and is not saved).
const api = (path, method = 'GET', body) => nutri.eval(`fetch(${JSON.stringify(BASE + path)}, { method: ${JSON.stringify(method)},
  headers: { Authorization: ${JSON.stringify(s.token)}, 'Content-Type': 'application/json' }${body ? `, body: ${JSON.stringify(JSON.stringify(body))}` : ''} })
  .then(async (r) => ({ status: r.status, body: r.status === 204 ? null : await r.json() }))`);
const dietOf = async (pid) => (await api(`/api/collections/diets/records?filter=${encodeURIComponent(`patient = "${pid}"`)}`)).body.items[0] || null;
const openDiet = async (pid) => {
  await nutri.goto(`${BASE}/patient.html?id=${pid}&tab=diet`);
  await nutri.waitFor(`document.getElementById('meal-breakfast') && document.getElementById('diet-state').textContent`);
};

let anaDiet;
await step('T1', async () => {
  anaDiet = await dietOf(anaId);
  await openDiet(anaId);
  await nutri.click('#save-template');
  await nutri.waitFor(`document.getElementById('st-dialog').open`);
  const prefill = await nutri.eval(`document.getElementById('st-name').value`);
  check('T1 "Guardar como plantilla" opens with the plan name filled in', prefill === anaDiet.title, prefill);
  await nutri.fill('#st-name', 'Fase 1');
  await nutri.click('#st-save');
  await nutri.waitFor(`!document.getElementById('st-dialog').open`);
  const [tpl] = (await api('/api/collections/diet_templates/records')).body.items;
  check('T1 the template has the same week as Ana\'s diet', tpl?.title === 'Fase 1' && JSON.stringify(tpl.meals) === JSON.stringify(anaDiet.meals), tpl?.title);
  await nutri.click('#save-template');
  await nutri.fill('#st-name', 'Fase 1');
  await nutri.click('#st-save');
  await nutri.waitFor(`!document.getElementById('st-conflict').hidden`);
  check('T1 the same name again asks: replace or save as a copy', (await nutri.text('#st-conflict-title')).includes('Ya tienes una plantilla llamada'));
  await nutri.screenshot(`${OUT}/save-conflict.png`, { full: false });
  await nutri.click('#st-copy');
  await nutri.waitFor(`!document.getElementById('st-dialog').open`);
  const titles = (await api('/api/collections/diet_templates/records?sort=title')).body.items.map((x) => x.title);
  check('T1 "Guardar como copia" saves "Fase 1 (copia)"', titles.join('|') === 'Fase 1|Fase 1 (copia)', titles.join('|'));
});

await step('T2', async () => {
  await openDiet(carlosId);
  await nutri.click('#use-template');
  await nutri.waitFor(`document.querySelectorAll('#ut-list input').length === 2`);
  await nutri.click('#ut-list input[value]:not([value=""])');
  await nutri.eval(`[...document.querySelectorAll('#ut-list label')].find(l => l.textContent.startsWith('Fase 1') && !l.textContent.includes('copia')).querySelector('input').click()`);
  await nutri.waitFor(`document.querySelectorAll('#ut-preview .week-day').length === 7 && !document.getElementById('ut-use').disabled`);
  await nutri.screenshot(`${OUT}/use-dialog.png`, { full: false });
  await nutri.click('#ut-use');
  await nutri.waitFor(`!document.getElementById('ut-dialog').open`);
  const shown = await nutri.eval(`({ b: document.getElementById('meal-breakfast').value, state: document.getElementById('diet-state').textContent, title: document.getElementById('d-title').value })`);
  const stored = await dietOf(carlosId);
  check('T2 the week fills the editor, marked "Cambios sin guardar", and nothing is stored yet',
    shown.b === anaDiet.meals['1'].breakfast && shown.state === 'Cambios sin guardar' && shown.title === 'Fase 1' && !stored, JSON.stringify({ shown, stored: !!stored }));
  await nutri.click('#days button:nth-child(2)');
  await nutri.fill('#meal-dinner', 'Caldo de pollo con verduras');
  await nutri.click('#diet-form [type=submit]');
  await nutri.waitFor(`document.getElementById('diet-state').textContent.startsWith('Guardada')`);
  const saved = await dietOf(carlosId);
  const expect = structuredClone(anaDiet.meals); expect['2'].dinner = 'Caldo de pollo con verduras';
  check('T2 after "Guardar dieta": Carlos has the template plus my change', JSON.stringify(saved?.meals) === JSON.stringify(expect));
});

await step('T3', async () => {
  const [tpl] = (await api(`/api/collections/diet_templates/records?filter=${encodeURIComponent('title = "Fase 1"')}`)).body.items;
  await api(`/api/collections/diet_templates/records/${tpl.id}`, 'PATCH', { meals: { 1: { breakfast: 'Cambiado en la plantilla' } } });
  const after = await dietOf(carlosId);
  check('T3 changing the template later does not change Carlos\'s diet', after.meals['1'].breakfast === anaDiet.meals['1'].breakfast);
});

await step('T4', async () => {
  await openDiet(carlosId);
  await nutri.eval('window.confirm = () => false');
  await nutri.click('#use-template');
  await nutri.waitFor(`document.querySelectorAll('#ut-list input').length === 2`);
  await nutri.click('#ut-list input');
  await nutri.click('#ut-use');
  const kept = await nutri.eval(`document.getElementById('diet-state').textContent.startsWith('Guardada') && document.getElementById('ut-dialog').open`);
  check('T4 replacing an existing diet asks first; Cancel keeps it', kept);
  await nutri.eval('window.confirm = () => true');
  await nutri.click('#ut-use');
  await nutri.waitFor(`document.getElementById('diet-state').textContent === 'Cambios sin guardar'`);
  check('T4 confirming replaces the week in the editor (still unsaved)', true);
  await nutri.click('#diet-form [type=submit]');
  await nutri.waitFor(`document.getElementById('diet-state').textContent.startsWith('Guardada')`);
});

await step('T7', async () => {
  await nutri.goto(`${BASE}/patients.html`);
  await nutri.waitFor(`document.getElementById('templates-link')`);
  await nutri.click('#templates-link');
  await nutri.waitUrl('/templates.html');
  await nutri.waitFor(`document.querySelectorAll('#list > li.card').length === 2`);
  await nutri.click('#list > li.card button[aria-expanded]');
  await nutri.waitFor(`document.querySelector('#list .plato-week-preview:not([hidden]) .week-day')`);
  check('T7 Plantillas lists both templates with a week preview', true);
  await nutri.screenshot(`${OUT}/templates-page.png`, { full: false });
  await nutri.eval(`[...document.querySelectorAll('#list > li.card')].find(li => li.querySelector('h2').textContent === 'Fase 1 (copia)').querySelectorAll('button')[1].click()`);
  await nutri.waitFor(`document.getElementById('rn-dialog').open`);
  await nutri.fill('#rn-name', 'Fase 1');
  await nutri.click('#rn-save');
  await nutri.waitFor(`document.querySelector('#rn-form .plato-form-error:not([hidden])')`);
  const err = await nutri.text('#rn-form .plato-form-error');
  await nutri.fill('#rn-name', 'Fase 2');
  await nutri.click('#rn-save');
  await nutri.waitFor(`[...document.querySelectorAll('#list h2')].some(h => h.textContent === 'Fase 2')`);
  check('T7 rename: a taken name is refused, a new one works', err === 'Ya tienes una plantilla con ese nombre.', err);
  await nutri.eval('window.confirm = () => true');
  await nutri.eval(`[...document.querySelectorAll('#list > li.card')].find(li => li.querySelector('h2').textContent === 'Fase 2').querySelector('[aria-label^="Borrar"]').click()`);
  await nutri.waitFor(`document.querySelectorAll('#list > li.card').length === 1`);
  check('T7 delete removes it; Carlos\'s diet is intact', !!(await dietOf(carlosId))?.meals);
});

await step('T8', async () => {
  await api(`/api/plato/patients/${carlosId}/close`, 'POST', {});
  await openDiet(carlosId);
  check('T8 closed account: no "Usar plantilla"; "Guardar como plantilla" still there',
    await nutri.eval(`document.getElementById('use-template').hidden && !document.getElementById('save-template').hidden`));
});

const errs = nutri.errors;
check('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
