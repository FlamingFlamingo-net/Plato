// Recetas (dishes) screens (spec "Feature: Recetas (dishes), slice (b)"): list, builder, live totals, duplicate, tags, archive, delete, phone.
// Usage: node tools/dishes_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
import { launch } from './cdp.mjs';
import { superuser } from './admin.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = async (name, fn) => {
  try { await fn(); } catch (e) {
    const now = await globalThis.D?.eval(`[...document.querySelectorAll('#list > li.card h2')].map((h) => h.textContent).join(' | ') + ' || toast: ' + [...document.querySelectorAll('.plato-toast')].map((x) => x.textContent).join(' / ')`).catch(() => '');
    check(name, false, `${e.message.split('\n')[0]} | now: ${now} | page errors: ${(globalThis.D?.errors || []).slice(-3).join(' / ')}`);
  }
};
const SU = await superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
const ld = spawnSync('python', ['tools/load_ingredients.py', '--base', BASE, '--csv', 'data/ingredients-usda.csv', '--dataset', 'usda-sr-legacy', '--source', 'USDA FoodData Central, SR Legacy', '--version', 'SR Legacy 2018', '--apply'], { env: { ...process.env, PB_SUPERUSER_TOKEN: SU, PYTHONIOENCODING: 'utf-8' }, encoding: 'utf-8' });
check('setup: the USDA ingredients are loaded', /LOADED: 4\d\d/.test(ld.stdout), ld.stdout + ld.stderr);
const N = t.nutritionist.token, NID = t.nutritionist.record.id;
const api = async (path, method = 'GET', body, token = N) => { const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

const browser = await launch({ port: 9368, profileDir: `${OUT}/chrome-profile` });
async function open(w, h, path, mobile = false) {
  const p = await browser.newPage({ width: w, height: h, mobile });
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: N, record: t.nutritionist.record, collection: 'nutritionists' }))})`);
  await p.goto(`${BASE}${path}`);
  return p;
}
const D = await open(1366, 900, '/home.html?tab=catalog');
globalThis.D = D;
const cards = (p) => p.eval(`[...document.querySelectorAll('#list > li.card')].map((c) => c.querySelector('h2').textContent)`);
const cardNames = async (p, names) => p.waitFor(`JSON.stringify([...document.querySelectorAll('#list > li.card')].map((c) => c.querySelector('h2').textContent)) === ${JSON.stringify(JSON.stringify(names))}`, 15000);
const pickIng = async (p, name) => { await p.fill('#dish-ing-q', name); await p.waitFor(`[...document.querySelectorAll('#dish-results .plato-dish-result strong')].some((s) => s.textContent === ${JSON.stringify(name)})`); await p.eval(`[...document.querySelectorAll('#dish-results .plato-dish-result')].find((b) => b.querySelector('strong').textContent === ${JSON.stringify(name)}).click()`); };
const setUnit = (p, i, v) => p.eval(`(() => { const s = document.querySelectorAll('#dish-lines li')[${i}].querySelector('select'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); })()`);
const totalsText = (p) => p.text('#dish-totals');

await step('S1', async () => {
  await D.waitFor(`document.querySelector('a.plato-catalog-card[href="/dishes.html"]')`, 15000);
  const tile = await D.text('a.plato-catalog-card[href="/dishes.html"]');
  check('S1 Catálogo: the Recetas tile is open (not locked) and says "0 recetas"', tile.includes('0 recetas'), tile);
  await D.click('a.plato-catalog-card[href="/dishes.html"]');
  await D.waitFor(`location.pathname === '/dishes.html' && document.querySelector('#list .plato-empty-state')`, 15000);
  check('S1 empty page: "Aún no tienes recetas" with a button to make the first one; the USDA source line shows',
    (await D.text('#list')).includes('Aún no tienes recetas') && (await D.text('#source-line')).includes('USDA FoodData Central'), await D.text('#list'));
});

await step('S2', async () => {
  await D.click('#new-dish');
  await D.waitFor(`document.getElementById('dish-dialog')?.open`);
  check('S2 "Nueva receta" opens the builder with the cursor in the name', await D.eval(`document.activeElement.id === 'dish-name'`));
  await D.fill('#dish-name', 'Taco de lomo');
  await D.fill('#dish-unit', 'taco');
  await D.click('#dish-multi');
  await pickIng(D, 'Corn tortilla');
  await setUnit(D, 0, 'tortilla'); await D.fill('#dl-a-0', '1');
  await pickIng(D, 'Pork loin, lean, roasted'); await D.fill('#dl-a-1', '50');
  await pickIng(D, 'Cilantro, raw'); await D.fill('#dl-a-2', '10');
  await sleep(300);
  const live = await totalsText(D);
  check('S2 the live total for "Por 1 taco" equals the hand calculation (159 kcal, from 24 g + 50 g + 10 g)', live.startsWith('Por 1 taco') && live.includes('159 kcal') && live.includes('Fibra'), live);
  const unitOpts = await D.eval(`[...document.querySelectorAll('#dish-lines li')[0].querySelectorAll('select option')].map((o) => o.textContent)`);
  check('S2 the tortilla line offers g and its household portions (tortilla = 24 g); no ml (no density)', unitOpts[0] === 'g' && unitOpts.some((o) => o.startsWith('tortilla (24 g)')) && !unitOpts.includes('ml'), unitOpts.join('|'));
  const lineOut = await D.eval(`document.querySelectorAll('#dish-lines li')[0].textContent`);
  check('S2 each line shows its grams and kcal ("24 g · 52 kcal")', lineOut.includes('24 g') && lineOut.includes('52 kcal'), lineOut);
  await D.screenshot(`${OUT}/builder-desk.png`);
  await D.click('#dish-save');
  await D.waitFor(`!document.getElementById('dish-dialog') && document.querySelector('#list > li.card')`, 15000);
  const stored = (await api('/api/collections/dishes/records')).json.items[0];
  const cardTxt = await D.text('#list > li.card');
  check('S2 saved: the card shows "Por 1 taco: 159 kcal…" and "Se sirve por piezas"; the server\'s stored number is the same (159.12)', cardTxt.includes('Por 1 taco: 159 kcal') && cardTxt.includes('Se sirve por piezas') && Math.abs(stored.nutrition.kcal - 159.12) < 0.01, `${cardTxt} ${JSON.stringify(stored.nutrition)}`);
});

await step('S3', async () => {
  await D.eval(`document.querySelector('#list > li.card [data-action=duplicate]').click()`);
  await cardNames(D, ['Taco de lomo', 'Taco de lomo (copia)']);
  await D.eval(`[...document.querySelectorAll('#list > li.card')].find((c) => c.querySelector('h2').textContent === 'Taco de lomo').querySelector('[data-action=duplicate]').click()`);
  await cardNames(D, ['Taco de lomo', 'Taco de lomo (copia 2)', 'Taco de lomo (copia)']);
  const copy = (await api('/api/collections/dishes/records?filter=' + encodeURIComponent('name = "Taco de lomo (copia)"'))).json.items[0];
  check('S3 "Duplicar" makes "(copia)" then "(copia 2)", with the same lines and the same numbers', Math.abs(copy.nutrition.kcal - 159.12) < 0.01 && copy.items.length === 3);
});

await step('S4', async () => {
  await D.eval(`[...document.querySelectorAll('#list > li.card')].find((c) => c.querySelector('h2').textContent === 'Taco de lomo (copia 2)').querySelector('[data-action=edit]').click()`);
  await D.waitFor(`document.getElementById('dish-dialog')?.open && document.querySelectorAll('#dish-lines li').length === 3`);
  const pre = await D.eval(`({ name: document.getElementById('dish-name').value, unit: document.getElementById('dish-unit').value, multi: document.getElementById('dish-multi').checked, a0: document.getElementById('dl-a-0').value, u0: document.querySelectorAll('#dish-lines li')[0].querySelector('select').value })`);
  check('S4 editing loads the dish: name, unit, switch, amounts and the chosen portion', pre.name === 'Taco de lomo (copia 2)' && pre.unit === 'taco' && pre.multi && pre.a0 === '1' && pre.u0 === 'tortilla', JSON.stringify(pre));
  await D.fill('#dl-a-0', '2');
  await sleep(200);
  check('S4 changing 1 tortilla to 2 updates the total live (159 -> 211 kcal)', (await totalsText(D)).includes('211 kcal'), await totalsText(D));
  await D.eval(`document.querySelectorAll('#dish-lines li')[2].querySelector('button[aria-label^="Quitar"]').click()`);
  await sleep(200);
  check('S4 removing the cilantro line updates it (209 kcal)', (await totalsText(D)).includes('209 kcal') && (await D.eval(`document.querySelectorAll('#dish-lines li').length`)) === 2, await totalsText(D));
  await D.click('#dish-save');
  await D.waitFor(`!document.getElementById('dish-dialog')`);
  await sleep(500);
  const ed = (await api('/api/collections/dishes/records?filter=' + encodeURIComponent('name = "Taco de lomo (copia 2)"'))).json.items[0];
  check('S4 saved: the server\'s number equals the screen\'s (2 x 24 g tortilla + 50 g loin = 209.14 kcal)', Math.abs(ed.nutrition.kcal - 209.14) < 0.01, JSON.stringify(ed.nutrition));
});

await step('S5', async () => {
  await D.click('#new-dish');
  await D.waitFor(`document.getElementById('dish-dialog')?.open`);
  await D.fill('#dish-name', '');
  await D.click('#dish-save');
  check('S5 saving with no name says so and keeps the focus there', (await D.text('#dish-dialog .plato-form-error')).includes('Escribe el nombre') && (await D.eval(`document.activeElement.id`)) === 'dish-name');
  await D.fill('#dish-name', 'Taco de lomo');
  await D.fill('#dish-unit', 'taco');
  await D.click('#dish-save');
  check('S5 no ingredients: "Agrega al menos un ingrediente"', (await D.text('#dish-dialog .plato-form-error')).includes('Agrega al menos un ingrediente'));
  await pickIng(D, 'Egg, hard-boiled');
  await setUnit(D, 0, 'large'); await D.fill('#dl-a-0', '2');
  await sleep(200);
  check('S5 "2 large" eggs = 100 g = 155 kcal on the line and in the total', (await D.eval(`document.querySelectorAll('#dish-lines li')[0].textContent`)).includes('100 g · 155 kcal') && (await totalsText(D)).includes('155 kcal'));
  await D.click('#dish-save');
  await D.waitFor(`document.querySelector('#dish-dialog .plato-form-error:not([hidden])')`);
  check('S5 a repeated name is refused in words: "Ya tienes una receta con ese nombre."', (await D.text('#dish-dialog .plato-form-error')).includes('Ya tienes una receta con ese nombre'), await D.text('#dish-dialog .plato-form-error'));
  await D.fill('#dish-name', 'Huevos');
  await D.fill('#dish-unit', 'porción');
  await D.click('#dish-save');
  await D.waitFor(`!document.getElementById('dish-dialog')`);
  await sleep(400);
  check('S5 "Huevos" saved: 155 kcal', (await D.text('#list')).includes('Por 1 porción: 155 kcal'));
  await D.fill('#dish-q', 'huev');
  await cardNames(D, ['Huevos']);
  check('S5 search by name narrows the list', true);
  await D.fill('#dish-q', '');
  await cardNames(D, ['Huevos', 'Taco de lomo', 'Taco de lomo (copia 2)', 'Taco de lomo (copia)']);
});

await step('S6', async () => {
  await D.eval(`(() => { const s = document.getElementById('list-sort'); s.value = 'kcal'; s.dispatchEvent(new Event('change')); })()`);
  await cardNames(D, ['Taco de lomo (copia 2)', 'Taco de lomo', 'Taco de lomo (copia)', 'Huevos']);
  check('S6 "Más calorías primero": the 209 kcal dish, then the two 159 kcal (by name), then the 155 kcal one', true);
});

await step('S7', async () => {
  await D.eval(`[...document.querySelectorAll('#list > li.card')].find((c) => c.querySelector('h2').textContent === 'Huevos').querySelector('[data-action=tags]').click()`);
  await D.waitFor(`document.getElementById('tag-dialog')?.open`);
  const rows = await D.eval(`[...document.querySelectorAll('#tag-dialog .plato-tag-row')].map((r) => r.textContent.replace(/\\s+/g, ' ').trim())`);
  check('S7 the Etiquetas dialog on a dish offers the starter tags and no ingredient-only state (nothing ticked: no inheritance from the egg)', rows.length >= 3 && (await D.eval(`[...document.querySelectorAll('#tag-dialog .plato-tag-row input')].every((i) => !i.checked)`)), rows.join('|'));
  await D.fill('#tag-new', 'Desayuno');
  await D.eval(`document.querySelector('.plato-tag-add').requestSubmit()`);
  await D.waitFor(`[...document.querySelectorAll('#tag-dialog .plato-tag-row')].some((r) => r.textContent.includes('Desayuno') && r.querySelector('input').checked)`);
  await D.eval(`document.querySelector('#tag-dialog footer button').click()`);
  await D.waitFor(`!document.getElementById('tag-dialog') && document.querySelector('#tag-bar .plato-chip')`);
  const chips = await D.eval(`[...document.querySelectorAll('#tag-bar .plato-chip')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim())`);
  check('S7 the new tag "Desayuno (1)" is a chip; the dish shows it as a badge', chips.join() === 'Desayuno (1)' && (await D.text('#list')).includes('Desayuno'), chips.join());
  await D.eval(`document.querySelector('#tag-bar .plato-chip').click()`);
  await cardNames(D, ['Huevos']);
  check('S7 picking the chip narrows to that dish; the chip keeps the keyboard focus', await D.eval(`document.activeElement.classList.contains('plato-chip')`));
  await D.eval(`[...document.querySelectorAll('#tag-bar button')].find((b) => b.textContent.startsWith('Quitar')).click()`);
  await sleep(400);
});

await step('S8', async () => {
  await D.eval(`window.confirm = () => true`);
  await D.eval(`[...document.querySelectorAll('#list > li.card')].find((c) => c.querySelector('h2').textContent === 'Taco de lomo (copia)').querySelector('[data-action=archive]').click()`);
  await D.waitFor(`![...document.querySelectorAll('#list h2')].some((h) => h.textContent === 'Taco de lomo (copia)')`);
  const tabs = await D.eval(`[...document.querySelectorAll('#list-bar [role=tab]')].map((x) => x.getAttribute('aria-label'))`);
  check('S8 archiving moves it out of Activas: tabs say "Activas, 3" and "Archivadas, 1"', tabs.join() === 'Activas, 3,Archivadas, 1', tabs.join());
  await D.click('#tab-archived');
  await cardNames(D, ['Taco de lomo (copia)']);
  const arch = await D.text('#list > li.card');
  check('S8 the Archivadas tab lists it with Restaurar (no Editar or Duplicar)', await D.eval(`!!document.querySelector('#list [data-action=restore]') && !document.querySelector('#list [data-action=edit]') && !document.querySelector('#list [data-action=duplicate]')`), arch);
  await D.eval(`document.querySelector('#list [data-action=restore]').click()`);
  await D.waitFor(`document.querySelectorAll('#list > li.card').length === 0`);
  await D.click('#tab-active');
  await D.waitFor(`document.querySelectorAll('#list > li.card').length === 4`);
  check('S8 restoring brings it back to Activas (4)', true);
  await D.eval(`[...document.querySelectorAll('#list > li.card')].find((c) => c.querySelector('h2').textContent === 'Taco de lomo (copia)').querySelector('[data-action=delete]').click()`);
  await D.waitFor(`document.querySelectorAll('#list > li.card').length === 3`);
  check('S8 deleting (after the confirm) removes it', (await api('/api/collections/dishes/records?filter=' + encodeURIComponent('name = "Taco de lomo (copia)"'))).json.totalItems === 0);
});

await step('S9', async () => {
  const tortilla = (await api('/api/collections/ingredients/records?filter=' + encodeURIComponent('name = "Corn tortilla"'))).json.items[0];
  const up = await api(`/api/collections/ingredients/records/${tortilla.id}`, 'PATCH', { kcal: 300 }, SU);
  await D.eval('location.reload()');
  await D.waitFor(`document.querySelector('#list .plato-dish-note')`, 15000);
  const notes = await D.eval(`[...document.querySelectorAll('#list > li.card')].filter((c) => c.querySelector('.plato-dish-note')).map((c) => c.querySelector('h2').textContent)`);
  check('S9 the ingredient data changed: dishes using the tortilla say "Valores actualizados el …"; the egg dish does not', up.status === 200 && notes.sort().join() === 'Taco de lomo,Taco de lomo (copia 2)', notes.join());
  const pig = (await api('/api/collections/ingredients/records?filter=' + encodeURIComponent('name = "Egg, hard-boiled"'))).json.items[0];
  const del = await api(`/api/collections/ingredients/records/${pig.id}`, 'DELETE', null, SU);
  await D.eval('location.reload()');
  await D.waitFor(`document.querySelector('#list .plato-dish-warn')`, 15000);
  check('S9 an ingredient deleted: the egg dish keeps its numbers and warns "Falta un ingrediente"', del.status === 204 && (await D.text('#list .plato-dish-warn')).includes('Falta un ingrediente') && (await D.text('#list')).includes('155 kcal'));
  await D.eval(`[...document.querySelectorAll('#list > li.card')].find((c) => c.querySelector('h2').textContent === 'Huevos').querySelector('[data-action=edit]').click()`);
  await D.waitFor(`document.getElementById('dish-dialog')?.open`);
  check('S9 editing it says which line is gone: "ya no existe. Quítalo o cámbialo."', (await D.text('#dish-lines')).includes('ya no existe'));
  await D.click('#dish-save');
  check('S9 saving is refused until that line is removed', (await D.text('#dish-dialog .plato-form-error')).includes('ya no existe'));
  await D.eval(`document.querySelector('#dish-dialog [data-variant=outline]').click()`);
});

await step('A1', async () => {
  const P = await open(1366, 900, '/ingredients.html');
  await P.waitFor(`document.querySelectorAll('.plato-ing-table tbody tr').length > 10`, 20000);
  await P.eval(`window.__ai = ''; URL.createObjectURL = (b) => { b.text().then((x) => { window.__ai = x; }); return '#'; }`);
  await P.click('#ing-ai');
  await P.waitFor(`window.__ai.length > 1000`, 15000);
  const doc = JSON.parse(await P.eval('window.__ai'));
  const beans = doc.ingredients.find((i) => i.name === 'Black beans, cooked');
  const eggs = doc.ingredients.find((i) => i.fdc_id === 173424);
  check('A1 "Lista para IA (JSON)": format, data set name and version, the how-to line, every ingredient with its fdc_id', doc.format === 'plato-ingredients' && doc.datasets[0].dataset === 'usda-sr-legacy' && doc.datasets[0].version === 'SR Legacy 2018' && /fdc_id/.test(doc.how_to_use) && doc.ingredients.length >= 419 && doc.ingredients.every((i) => i.fdc_id > 0), `${doc.ingredients.length}`);
  check('A1 an entry has the exact portion labels, per-100 g numbers, has_density and tags (black beans: cup, alta en fibra); the deleted egg is gone', beans && beans.fdc_id === 173735 && beans.portions.join() === 'cup' && beans.per_100g.kcal === 132 && beans.has_density === false && beans.tags.includes('alta en fibra') && !eggs, JSON.stringify(beans));
});

await step('P1', async () => {
  for (const w of [320, 360, 390]) {
    const p = await open(w, 700, '/dishes.html', true);
    await p.waitFor(`document.querySelectorAll('#list > li.card').length >= 1`, 20000);
    await sleep(400);
    const list = await p.eval(`({ ok: document.documentElement.scrollWidth <= innerWidth && innerWidth <= ${w} + 1, tabs: document.querySelector('#list-bar').getBoundingClientRect().right <= innerWidth + 0.5, cards: [...document.querySelectorAll('#list > li.card')].every((c) => c.getBoundingClientRect().right <= innerWidth + 0.5) })`);
    check(`P1 ${w}px: the Recetas list fits (cards, tabs), no sideways scroll`, list.ok && list.tabs && list.cards, JSON.stringify(list));
    await p.click('#new-dish');
    await p.waitFor(`document.getElementById('dish-dialog')?.open`);
    await p.fill('#dish-name', 'Prueba'); await p.fill('#dish-unit', 'plato');
    await pickIng(p, 'Banana, raw'); await setUnit(p, 0, 'medium (7" to 7-7/8" long)');
    await pickIng(p, 'Black beans, cooked');
    await sleep(300);
    const b = await p.eval(`(() => { const d = document.querySelector('#dish-dialog > div').getBoundingClientRect(), s = document.getElementById('dish-save').getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
      const inside = [...document.querySelectorAll('#dish-dialog .input, #dish-dialog .select, #dish-dialog .textarea')].every((e) => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= vw + 0.5; });
      return { dlg: d.left >= 0 && d.right <= vw + 0.5 && d.bottom <= vh + 0.5, save: s.top >= 0 && s.bottom <= vh && s.right <= vw, inside, page: document.documentElement.scrollWidth <= vw && vw <= ${w} + 1 }; })()`);
    check(`P1 ${w}px: the builder fits, every box is inside the screen, "Guardar receta" is always in view`, b.dlg && b.save && b.inside && b.page, JSON.stringify(b));
    if (w === 320) await p.screenshot(`${OUT}/builder-320.png`);
    await p.eval(`document.querySelector('#dish-dialog [data-variant=outline]').click()`);
  }
});

const errs = D.errors.filter((e) => !/\b40[034]\b|Failed to load resource/.test(e)).join(' | ');
check('no console errors', !errs, errs);
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
