// Ingredients + tags screens (spec "Feature: Ingredients, slice (a)").
// Usage: node tools/ingredients_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
import { launch } from './cdp.mjs';
import { superuser } from './admin.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const GROUPS = ['Cereales', 'Verduras', 'Frutas', 'Leguminosas', 'Carnes', 'Lácteos', 'Grasas'];
const NCOCIDO = readFileSync('data/ingredients-ejemplo.csv', 'utf8').split(String.fromCharCode(10)).filter((l) => l.split(',')[1] === 'cocido').length;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SU = await superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
const ld = spawnSync('python', ['tools/load_ingredients.py', '--base', BASE, '--csv', 'data/ingredients-ejemplo.csv', '--apply'], { env: { ...process.env, PB_SUPERUSER_TOKEN: SU, PYTHONIOENCODING: 'utf-8' }, encoding: 'utf-8' });
const total = Number((ld.stdout.match(/LOADED: (\d+)/) || [])[1]);
check('setup: the example set is loaded', total >= 60, ld.stdout + ld.stderr);
const N = t.nutritionist.token, NID = t.nutritionist.record.id;
const api = async (path, method = 'GET', body) => { const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: N, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
await api('/api/collections/diet_templates/records', 'POST', { nutritionist: NID, title: 'Semana ligera', meals: {} });
await api('/api/collections/diet_templates/records', 'POST', { nutritionist: NID, title: 'Semana fuerte', meals: {} });

const browser = await launch({ port: 9362, profileDir: `${OUT}/chrome-profile` });
async function open(w, h, path, mobile = false) {
  const p = await browser.newPage({ width: w, height: h, mobile });
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: N, record: t.nutritionist.record, collection: 'nutritionists' }))})`);
  await p.goto(`${BASE}${path}`);
  return p;
}
const clickText = (p, sel, text) => p.eval(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.trim().startsWith(${JSON.stringify(text)})); if (!e) throw new Error('no ${sel} ${text}'); e.click(); return true; })()`);
const rowsText = (p) => p.eval(`[...document.querySelectorAll('.plato-ing-table tbody > tr:not(.plato-ing-detail) > th .plato-ing-name')].map((b) => b.textContent)`);
const clear = (p) => p.eval(`(() => { const i = document.getElementById('ing-q'); i.value = ''; i.dispatchEvent(new Event('input')); })()`);
const rowsAre = (p, names) => p.waitFor(`JSON.stringify([...document.querySelectorAll('.plato-ing-table tbody > tr:not(.plato-ing-detail) > th .plato-ing-name')].map((b) => b.textContent)) === ${JSON.stringify(JSON.stringify(names))}`, 15000);
const shown = (p, n) => p.waitFor(`document.getElementById('status').textContent.startsWith('${n} ')`, 15000);
const D = await open(1366, 900, '/home.html?tab=catalog');
globalThis.D = D;

await step('I1', async () => {
  await D.waitFor(`document.querySelector('a.plato-catalog-card[href="/ingredients.html"]')`, 15000);
  const tile = await D.text('a.plato-catalog-card[href="/ingredients.html"]');
  check('I1 Catálogo: the Ingredientes tile is open (not locked) with the count and "de ejemplo"', tile.includes(`${total} ingredientes`) && tile.includes('de ejemplo'), tile);
  await D.click('a.plato-catalog-card[href="/ingredients.html"]');
  await D.waitFor(`location.pathname === '/ingredients.html' && document.getElementById('status').textContent.includes('ingredientes')`, 15000);
  const ui = await D.eval(`({ banner: !document.getElementById('sample-banner').hidden && document.getElementById('sample-banner').textContent, status: document.getElementById('status').textContent, tabs: [...document.querySelectorAll('#ing-tabs [role=tab]')].map((x) => x.getAttribute('aria-label')),
    chips: [...document.querySelectorAll('#tag-bar .plato-chip')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim()), cols: [...document.querySelectorAll('.plato-ing-table thead th')].map((x) => x.textContent) })`);
  check('I1 the banner "Datos de ejemplo" shows, the count is right, two tabs', /Datos de ejemplo/.test(ui.banner) && ui.status === `${total} ingredientes` && ui.tabs[0] === `Ingredientes, ${total}` && ui.tabs[1].startsWith('Equivalentes (ejemplo)'), JSON.stringify(ui));
  check('I1 columns are per 100 g (kcal, proteína, grasas, carbohidratos, fibra) and the starter tags are chips with counts', ui.cols.join() === 'Ingrediente,kcal,Proteína (g),Grasas (g),Carbohidratos (g),Fibra (g)' && ui.chips.length >= 6 && ui.chips.some((c) => /^fibra \(\d+\)$/.test(c)), JSON.stringify(ui));
  await D.screenshot(`${OUT}/list-desk.png`);
});

await step('I2', async () => {
  await D.fill('#ing-q', 'arroz');
  await rowsAre(D, ['Arroz blanco', 'Arroz blanco']);
  check('I2 search "arroz" finds the 2 rice rows (crudo and cocido)', (await rowsText(D)).join() === 'Arroz blanco,Arroz blanco');
  await D.fill('#ing-q', 'ACEITE');
  await rowsAre(D, ['Aceite de oliva']);
  check('I2 search ignores capitals', (await rowsText(D)).join() === 'Aceite de oliva');
  await D.fill('#ing-q', 'platano');
  await rowsAre(D, ['Plátano']);
  check('I2 search ignores accents (platano finds Plátano)', (await rowsText(D)).join() === 'Plátano');
  await clear(D);
  await D.eval(`(() => { const s = document.getElementById('ing-state'); s.value = 'cocido'; s.dispatchEvent(new Event('change')); })()`);
  await D.waitFor(`document.getElementById('status').textContent === '${NCOCIDO} ingredientes'`);
  check(`I2 filter by state "cocido" narrows the list to ${NCOCIDO}`, true);
  await D.eval(`(() => { const s = document.getElementById('ing-state'); s.value = ''; s.dispatchEvent(new Event('change')); const o = document.getElementById('ing-sort'); o.value = 'protein'; o.dispatchEvent(new Event('change')); })()`);
  await D.waitFor(`document.querySelector('.plato-ing-name').textContent === 'Pechuga de pollo sin piel'`);
  const top = await rowsText(D);
  check('I2 sorting by proteína puts the highest first (Pechuga de pollo, 31 g)', top[0] === 'Pechuga de pollo sin piel', top.slice(0, 3).join());
  check('I2 the search, filter and sort live in the address', (await D.eval('location.search')).includes('orden=protein'));
});

await step('I3', async () => {
  await D.fill('#ing-q', 'frijol negro');
  await rowsAre(D, ['Frijol negro']);
  await D.click('.plato-ing-name');
  const det = await D.text('.plato-ing-detail:not([hidden])');
  check('I3 a row opens to show extra nutrients, both exchange groups, source and version', det.includes('sodio mg') && det.includes('Leguminosas (90 g)') && det.includes('Carnes (60 g)') && det.includes('EJEMPLO') && det.includes('versión 0'), det);
  check('I3 the opener says expanded for screen readers', (await D.eval(`document.querySelector('.plato-ing-name').getAttribute('aria-expanded')`)) === 'true');
});

await step('I4', async () => {
  await D.eval(`window.__csv = ''; URL.createObjectURL = (b) => { b.arrayBuffer().then((ab) => { window.__bom = new Uint8Array(ab)[0] === 0xEF; }); b.text().then((x) => { window.__csv = x; }); return '#'; }`);
  await D.click('#ing-controls button');
  await D.waitFor(`window.__csv.length > 100 && window.__bom !== undefined`);
  const lines = (await D.eval('window.__csv')).trim().split('\n');
  check('I4 the CSV download has a header and every ingredient (all of them, not just the filtered ones)', lines.length === total + 1 && lines[0].startsWith('name,state,kcal') && lines.some((l) => l.startsWith('Frijol negro,cocido,132') && l.includes('Leguminosas:90;Carnes:60')), `${lines.length} ${lines[0]} bom=${await D.eval('window.__bom')} frijol=${lines.find((l) => l.startsWith('Frijol negro'))}`);
});

await step('E1', async () => {
  await clear(D);
  await D.click('#tab-equivalentes');
  await D.waitFor(`document.querySelectorAll('.plato-group').length >= 7`);
  const g = await D.eval(`Object.fromEntries([...document.querySelectorAll('.plato-group')].map((s) => [s.querySelector('h2').textContent, [...s.querySelectorAll('li')].map((li) => li.textContent)]))`);
  check('E1 the Equivalentes tab lists the 7 groups, labelled "ejemplo"', GROUPS.every((n) => g[n]) && (await D.text('#ing-view')).startsWith('Ejemplo:'), Object.keys(g).join());
  check('E1 Frijol negro sits in two groups (Leguminosas 90 g and Carnes 60 g)', g.Leguminosas.some((x) => x.startsWith('Frijol negro') && x.endsWith('90 g')) && g.Carnes.some((x) => x.startsWith('Frijol negro') && x.endsWith('60 g')));
  check('E1 the groups come in the usual order', Object.keys(g).slice(0, 7).join() === GROUPS.join(), Object.keys(g).join());
  await D.click('#tab-lista');
  await D.waitFor(`document.querySelectorAll('.plato-ing-table tbody tr').length > 10`);
});

await step('T1', async () => {
  await clear(D);
  await D.eval(`(() => { const o = document.getElementById('ing-sort'); o.value = 'name'; o.dispatchEvent(new Event('change')); })()`);
  await sleep(400);
  await D.eval(`document.querySelector('button[aria-label="Etiquetas de Huevo entero"]').click()`);
  await D.waitFor(`document.getElementById('tag-dialog')?.open`);
  const pre = await D.eval(`[...document.querySelectorAll('#tag-dialog .plato-tag-row')].map((r) => ({ t: r.textContent.replace(/\\s+/g, ' ').trim(), checked: r.querySelector('input').checked, disabled: r.querySelector('input').disabled }))`);
  check('T1 the dialog lists the starter tags; those already on the egg are ticked, disabled and say "incluida"', pre.length >= 6 && pre.filter((x) => x.checked).every((x) => x.disabled && x.t.includes('incluida')) && pre.some((x) => x.checked), JSON.stringify(pre));
  await D.fill('#tag-new', 'Post-entreno');
  await D.eval(`document.querySelector('.plato-tag-add').requestSubmit()`);
  await D.waitFor(`[...document.querySelectorAll('#tag-dialog .plato-tag-row')].some((r) => r.textContent.includes('Post-entreno') && r.querySelector('input').checked)`);
  check('T1 a new tag typed by hand is created and put on the egg (ticked)', true);
  await D.fill('#tag-new', 'POST-entreno');
  await D.eval(`document.querySelector('.plato-tag-add').requestSubmit()`);
  await sleep(500);
  const dupe = await D.eval(`document.querySelectorAll('#tag-dialog .plato-tag-row').length`);
  await D.fill('#tag-new', 'FÍBRA');
  await D.eval(`document.querySelector('.plato-tag-add').requestSubmit()`);
  await sleep(500);
  check('T1 typing the same name again (other capitals/accents) does not make a copy; a starter name just ticks the starter', (await D.eval(`document.querySelectorAll('#tag-dialog .plato-tag-row').length`)) === dupe && (await D.eval(`[...document.querySelectorAll('#tag-dialog .plato-tag-row')].filter((r) => r.textContent.startsWith('Post-entreno')).length`)) === 1);
  await D.fill('#tag-new', 'x'.repeat(40));
  check('T1 the name box allows at most 30 characters', (await D.eval(`document.getElementById('tag-new').maxLength`)) === 30);
  await D.eval(`document.querySelector('#tag-dialog footer button').click()`);
  await D.waitFor(`!document.getElementById('tag-dialog')`);
  await D.fill('#ing-q', 'frijol negro');
  await rowsAre(D, ['Frijol negro']);
  await D.eval(`document.querySelector('button[aria-label="Etiquetas de Frijol negro"]').click()`);
  await D.waitFor(`document.getElementById('tag-dialog')?.open`);
  await D.eval(`[...document.querySelectorAll('#tag-dialog .plato-tag-row input')].find((i) => i.closest('.plato-tag-row').textContent.startsWith('Post-entreno')).click()`);
  await sleep(600);
  await D.eval(`document.querySelector('#tag-dialog footer button').click()`);
  await D.waitFor(`!document.getElementById('tag-dialog')`);
  await clear(D);
  await sleep(600);
  const chips = await D.eval(`[...document.querySelectorAll('#tag-bar .plato-chip')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim())`);
  check('T1 "Post-entreno (2)" appears as a chip (egg and beans)', chips.includes('Post-entreno (2)'), chips.join());
  await clickText(D, '#tag-bar .plato-chip', 'Post-entreno');
  await shown(D, 2);
  check('T1 picking it narrows the list to those 2', (await rowsText(D)).join() === 'Frijol negro,Huevo entero', (await rowsText(D)).join());
  check('T1 the chip keeps the keyboard focus after picking', (await D.eval(`document.activeElement.classList.contains('plato-chip')`)));
  await clickText(D, '#tag-bar .plato-chip', 'bajo en sodio');
  await rowsAre(D, ['Frijol negro']);
  check('T1 picking "bajo en sodio" too shows only items with BOTH (Frijol negro; the egg has no such tag)', (await rowsText(D)).join() === 'Frijol negro');
  check('T1 the picked tags live in the address', (await D.eval('location.search')).includes('etiquetas='));
  await D.eval(`[...document.querySelectorAll('#tag-bar button')].find((b) => b.textContent.startsWith('Quitar')).click()`);
  await shown(D, total);
});

await step('T2', async () => {
  const P = await open(1366, 900, '/templates.html');
  await P.waitFor(`document.querySelectorAll('#list > li.card').length === 2`, 15000);
  await P.eval(`[...document.querySelectorAll('#list > li.card')].find((c) => c.querySelector('h2').textContent === 'Semana ligera').querySelector('[data-action=tags]').click()`);
  await P.waitFor(`document.getElementById('tag-dialog')?.open`);
  await P.fill('#tag-new', 'Alta proteína');
  await P.eval(`document.querySelector('.plato-tag-add').requestSubmit()`);
  await P.waitFor(`[...document.querySelectorAll('#tag-dialog .plato-tag-row')].some((r) => r.textContent.includes('Alta proteína') && r.querySelector('input').checked)`);
  await P.eval(`document.querySelector('#tag-dialog footer button').click()`);
  await P.waitFor(`!document.getElementById('tag-dialog') && document.querySelector('#list .badge')`);
  const cards = await P.eval(`[...document.querySelectorAll('#list > li.card')].map((c) => c.querySelector('h2').textContent + ':' + [...c.querySelectorAll('.badge')].map((b) => b.textContent).join('|'))`);
  check('T2 a template gets its own tag; the other template has none; the ingredient tags do not show here (no inheritance)', cards.join() === 'Semana fuerte:,Semana ligera:Alta proteína' || cards.join() === 'Semana ligera:Alta proteína,Semana fuerte:', cards.join());
  await clickText(P, '#tag-bar .plato-chip', 'Alta proteína');
  await P.waitFor(`document.querySelectorAll('#list > li.card').length === 1`);
  check('T2 the chip narrows Dietas to that template; the ingredient-only tags (fibra…) are not offered here', (await P.eval(`document.querySelector('#list h2').textContent`)) === 'Semana ligera' && (await P.eval(`[...document.querySelectorAll('#tag-bar .plato-chip')].map((b) => b.textContent).join('|')`)).split('|').length === 1);
  check('T2 the chip keeps the keyboard focus', await P.eval(`document.activeElement.classList.contains('plato-chip')`));
});

await step('T3', async () => {
  await D.fill('#ing-q', 'huevo');
  await rowsAre(D, ['Clara de huevo', 'Huevo entero']);
  await D.eval(`document.querySelector('button[aria-label="Etiquetas de Huevo entero"]').click()`);
  await D.waitFor(`document.getElementById('tag-dialog')?.open`);
  const del = `[...document.querySelectorAll('#tag-dialog .plato-tag-row')].find((r) => r.textContent.startsWith('Post-entreno')).querySelector('button')`;
  await D.eval(`${del}.click()`);
  check('T3 deleting my tag asks first ("¿Quitarla de todo? Eliminar")', (await D.eval(`${del}.textContent`)).includes('¿Quitarla de todo?'));
  await D.eval(`${del}.click()`);
  await D.waitFor(`![...document.querySelectorAll('#tag-dialog .plato-tag-row')].some((r) => r.textContent.startsWith('Post-entreno'))`);
  await D.eval(`document.querySelector('#tag-dialog footer button').click()`);
  await D.waitFor(`!document.getElementById('tag-dialog')`);
  await sleep(600);
  const chips = await D.eval(`[...document.querySelectorAll('#tag-bar .plato-chip')].map((x) => x.textContent)`);
  const left = await api(`/api/collections/item_tags/records?filter=${encodeURIComponent('nutritionist != ""')}&perPage=1`);
  check('T3 after confirming, the tag is gone from the chips and from every item (beans and egg); only my other 2 links remain', !chips.some((c) => c.startsWith('Post-entreno')) && left.json.totalItems === 2,   // what is left of mine: fibra on the egg, and the template's tag
   `${chips.join()} ${left.json.totalItems}`);
});

await step('P1', async () => {
  for (const w of [320, 360, 390]) {
    const p = await open(w, 700, '/ingredients.html', true);
    await p.waitFor(`document.querySelectorAll('.plato-ing-table tbody tr').length > 10`, 15000);
    await sleep(500);
    const r = await p.eval(`(() => { const first = document.querySelector('.plato-ing-table tbody > tr:not(.plato-ing-detail)'); const cells = [...first.querySelectorAll('td')].map((c) => c.getBoundingClientRect()); const f = first.getBoundingClientRect();
      return { scroll: document.documentElement.scrollWidth > innerWidth || innerWidth > ${w} + 1,   // a phone that grew wider than its width means something overflows
       inside: cells.every((c) => c.left >= 0 && c.right <= innerWidth), stacked: getComputedStyle(document.querySelector('.plato-ing-table thead')).position === 'absolute', n: cells.length, tabs: document.querySelector('#ing-tabs').getBoundingClientRect().right <= innerWidth,
      ctl: [...document.querySelectorAll('#ing-controls > *')].every((e) => e.getBoundingClientRect().right <= innerWidth + 0.5) }; })()`);
    check(`P1 ${w}px: ingredient rows are stacked cards with the 5 numbers inside the screen, controls and tabs fit, no sideways scroll`, !r.scroll && r.inside && r.stacked && r.n === 5 && r.tabs && r.ctl, JSON.stringify(r));
    await p.eval(`document.querySelector('.plato-ing-table tbody button[aria-label^="Etiquetas de"]').click()`);
    await p.waitFor(`document.getElementById('tag-dialog')?.open`);
    await sleep(300);
    const d = await p.eval(`(() => { const b = document.querySelector('#tag-dialog > div').getBoundingClientRect(), f = document.querySelector('#tag-dialog footer button').getBoundingClientRect(); return { inside: b.left >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, done: f.top >= 0 && f.bottom <= innerHeight }; })()`);
    check(`P1 ${w}px: the Etiquetas dialog fits and "Listo" is in view`, d.inside && d.done, JSON.stringify(d));
    if (w === 320) { await p.screenshot(`${OUT}/dialog-320.png`); await p.eval(`document.querySelector('#tag-dialog footer button').click()`); await p.screenshot(`${OUT}/list-320.png`); }
    await p.goto(`${BASE}/ingredients.html?tab=equivalentes`);
    await p.waitFor(`document.querySelectorAll('.plato-group').length >= 7`, 15000);
    check(`P1 ${w}px: the Equivalentes tab has no sideways scroll`, await p.eval(`document.documentElement.scrollWidth <= innerWidth && innerWidth <= ${w} + 1`));
  }
});

await step('U1', async () => {
  // Real data: remove the made-up set, load the USDA file, and look at the page the way the client will.
  const run = (args) => spawnSync('python', ['tools/load_ingredients.py', '--base', BASE, ...args], { env: { ...process.env, PB_SUPERUSER_TOKEN: SU, PYTHONIOENCODING: 'utf-8' }, encoding: 'utf-8' });
  run(['--remove-dataset', 'ejemplo', '--apply']);
  const r = run(['--csv', 'data/ingredients-usda.csv', '--dataset', 'usda-sr-legacy', '--source', 'USDA FoodData Central, SR Legacy', '--version', 'SR Legacy 2018', '--apply']);
  const n = Number((r.stdout.match(/LOADED: (\d+)/) || [])[1]);
  check('U1 the USDA file loads (400+ foods)', n >= 400, r.stdout + r.stderr);
  const P = await open(1366, 900, '/ingredients.html');
  await P.waitFor(`document.querySelectorAll('.plato-ing-table tbody tr').length > 10`, 20000);
  const ui = await P.eval(`({ banner: !document.getElementById('sample-banner').hidden, src: document.getElementById('source-line').hidden ? '' : document.getElementById('source-line').textContent, status: document.getElementById('status').textContent })`);
  check('U1 no "Datos de ejemplo" banner; the line "Fuente: USDA FoodData Central (SR Legacy)…" shows', !ui.banner && ui.src.startsWith('Fuente: USDA FoodData Central (SR Legacy)') && ui.src.includes('nombres están en inglés') && ui.status === `${n} ingredientes`, JSON.stringify(ui));
  await P.fill('#ing-q', 'black beans, cooked');
  await P.waitFor(`document.querySelector('.plato-ing-name')?.textContent === 'Black beans, cooked'`);
  await P.click('.plato-ing-name');
  const det = await P.text('.plato-ing-detail:not([hidden])');
  check('U1 the row detail shows portions (cup = 172 g), sodium, source, version and the FDC id', det.includes('Porciones: cup = 172 g') && det.includes('sodium mg') && det.includes('USDA FoodData Central, SR Legacy') && det.includes('versión SR Legacy 2018') && det.includes('FDC 173735'), det);
  await P.fill('#ing-q', 'pancake');
  await P.waitFor(`document.querySelector('.plato-ing-name')?.textContent === 'Pancake'`);
  await P.click('.plato-ing-name');
  check('U1 pancake (no fibre value at USDA) shows fibre 0 and says so', (await P.text('.plato-ing-detail:not([hidden])')).includes('USDA no da este dato') && (await P.eval(`document.querySelector('.plato-ing-table tbody > tr td[data-label="Fibra (g)"]').textContent`)) === '0');
  await P.fill('#ing-q', 'beans');
  await P.waitFor(`document.querySelectorAll('.plato-ing-name').length >= 10`);
  check('U1 searching in English finds beans; the Equivalentes tab says there is no data yet', true);
  await P.click('#tab-equivalentes');
  await P.waitFor(`document.querySelector('.plato-empty-state')`);
  check('U1 Equivalentes: "Aún no hay equivalentes" (no exchange data in USDA)', (await P.text('.plato-empty-state')).includes('Aún no hay equivalentes'));
  await P.goto(`${BASE}/home.html?tab=catalog`);
  await P.waitFor(`document.querySelector('a.plato-catalog-card[href="/ingredients.html"]')`, 15000);
  const tile = await P.text('a.plato-catalog-card[href="/ingredients.html"]');
  check('U1 the Catálogo tile counts the foods and no longer says "de ejemplo"', tile.includes(`${n} ingredientes`) && !tile.includes('de ejemplo'), tile);
  const ph = await open(320, 700, '/ingredients.html', true);
  await ph.waitFor(`document.querySelectorAll('.plato-ing-table tbody tr').length > 10`, 20000);
  await sleep(400);
  check('U1 320px: the source line fits, no sideways scroll', await ph.eval(`document.documentElement.scrollWidth <= innerWidth && innerWidth <= 321 && document.getElementById('source-line').getBoundingClientRect().right <= innerWidth`));
  await ph.screenshot(`${OUT}/usda-320.png`);
});

console.log('ALL ERRORS:', JSON.stringify(D.errors.slice(0, 6)));
const errs = D.errors.filter((e) => !/\b40[034]\b|Failed to load resource/.test(e)).join(' | ');
check('no console errors', !errs, errs);
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
