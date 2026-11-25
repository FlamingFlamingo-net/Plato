// SMAE + USDA screens (spec "SMAE and USDA side by side", s2): source tabs, Equivalentes, the recipe builder's source filter,
// "equivalente" units, "Fibra: incompleta" (screen = server), the AI list, phones. SMAE rows are INVENTED here (the book is copyrighted).
// Usage: node tools/smaeui_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
import { launch } from './cdp.mjs';
import { superuser } from './admin.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, eps = 0.0011) => Math.abs(a - b) < eps;
const N = t.nutritionist.token, NID = t.nutritionist.record.id;
const SU = await superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
const api = async (path, method = 'GET', body, token = N) => { const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
const py = (args) => spawnSync('python', args, { env: { ...process.env, PB_SUPERUSER_TOKEN: SU, PYTHONIOENCODING: 'utf-8' }, encoding: 'utf-8' });

// ---------- data: the real USDA file + an invented SMAE-style table through the real converter ----------
const ex = (o) => `"${JSON.stringify(o).replace(/"/g, '""')}"`;
writeFileSync(`${OUT}/smae-mini.csv`, ['group,subgroup,name,qty_text,qty,unit,peso_bruto_g,peso_neto_g,kcal,protein_g,fat_g,carbs_g,fiber_g,check,extras',
  `Verduras,,Acelga prueba cruda,2,2.0,taza,120,98,22,2.2,0.1,4.3,3.6,,${ex({ sodium_mg: 50 })}`,
  `Cereales y tubérculos,sin grasa,Tortilla prueba,1,1.0,pieza,30,30,64,1.4,0.5,13.6,1.5,,`,
  `Leguminosas,,Frijol prueba cocido,1/2,0.5,taza,90,90,120,7.5,0.5,20,8,,`,
  `Alimentos de origen animal,muy bajo aporte de grasa,Pollo prueba cocido,1,1.0,pieza,40,30,40,7,1,0,,,`,
  `Leche,entera,Leche prueba,1,1.0,taza,240,240,150,9,8,12,,kcal 150 vs 156,`].join('\n') + '\n');
const conv = py(['tools/smae_to_csv.py', `${OUT}/smae-mini.csv`, `${OUT}/smae-mini-out.csv`]);
const l1 = py(['tools/load_ingredients.py', '--base', BASE, '--csv', `${OUT}/smae-mini-out.csv`, '--dataset', 'smae-v4', '--source', 'SMAE 4a edición', '--version', '4', '--apply']);
const l2 = py(['tools/load_ingredients.py', '--base', BASE, '--csv', 'data/ingredients-usda.csv', '--dataset', 'usda-sr-legacy', '--source', 'USDA FoodData Central, SR Legacy', '--version', 'SR Legacy 2018', '--apply']);
check('setup: 5 invented SMAE foods and the 420 USDA foods are loaded', conv.status === 0 && l1.status === 0 && l2.status === 0 && /LOADED: 5 /.test(l1.stdout) && /LOADED: 420 /.test(l2.stdout), conv.stdout + l1.stdout.slice(-200) + l2.stdout.slice(-200) + l1.stderr + l2.stderr);
const ing = Object.fromEntries((await api(`/api/collections/ingredients/records?perPage=50&filter=${encodeURIComponent('dataset = "smae-v4"')}`)).json.items.map((x) => [x.name, x]));

const browser = await launch({ port: 9375, profileDir: `${OUT}/chrome-profile` });
async function open(w, h, path, mobile = false) {
  const p = await browser.newPage({ width: w, height: h, mobile });
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: N, record: t.nutritionist.record, collection: 'nutritionists' }))})`);
  await p.goto(`${BASE}${path}`);
  return p;
}
const names = (p) => p.eval(`[...document.querySelectorAll('.plato-ing-table tbody > tr:not(.plato-ing-detail) > th .plato-ing-name')].map((b) => b.textContent)`);
const D = await open(1366, 900, '/ingredients.html');
const ready = (p) => p.waitFor(`document.getElementById('status').textContent.includes('ingrediente')`, 20000);

await step('S1', async () => {
  await ready(D);
  const tabs = await D.eval(`[...document.querySelectorAll('#ing-tabs [role=tab]')].map((x) => [x.getAttribute('aria-label'), x.getAttribute('aria-selected')])`);
  check('S1 tabs: SMAE (español) first and open, USDA (inglés), Equivalentes; no "Otros"', JSON.stringify(tabs) === JSON.stringify([['SMAE (español), 5', 'true'], ['USDA (inglés), 420', 'false'], ['Equivalentes', 'false']]), JSON.stringify(tabs));
  check('S1 the SMAE tab lists only the SMAE foods, A–Z', (await names(D)).join() === 'Acelga prueba cruda,Frijol prueba cocido,Leche prueba,Pollo prueba cocido,Tortilla prueba', (await names(D)).join());
  check('S1 the source line names SMAE', (await D.text('#source-line')).startsWith('Fuente: SMAE'));
  const row = (n) => D.eval(`(() => { const th = [...document.querySelectorAll('.plato-ing-table tbody > tr > th')].find((x) => x.querySelector('.plato-ing-name').textContent === ${JSON.stringify(n)}); const tr = th.parentElement;
    return { eq: th.querySelector('.plato-ing-eq')?.textContent || '', confirm: !!th.querySelector('.plato-confirm'), fib: tr.querySelector('td[data-label="Fibra (g)"]').textContent, kcal: tr.querySelector('td[data-label="kcal"]').textContent }; })()`);
  const fr = await row('Frijol prueba cocido'), po = await row('Pollo prueba cocido'), le = await row('Leche prueba'), ac = await row('Acelga prueba cruda');
  check('S2 each SMAE food shows its group and its equivalent ("Leguminosas — 1 equivalente = 1/2 taza (90 g)"; "Verduras — 1 equivalente = 2 taza (98 g)")', fr.eq === 'Leguminosas — 1 equivalente = 1/2 taza (90 g)' && ac.eq === 'Verduras — 1 equivalente = 2 taza (98 g)', `${fr.eq} | ${ac.eq}`);
  check('S2 per 100 g: Frijol 133 kcal (120 in 90 g); a food without a fibre value shows "—", not 0', fr.kcal === '133' && po.fib === '—' && fr.fib !== '—', JSON.stringify([fr, po]));
  check('S2 calories that do not add up in the book carry a "por confirmar" badge', le.confirm && !fr.confirm);
  await D.eval(`[...document.querySelectorAll('.plato-ing-name')].find((b) => b.textContent === 'Pollo prueba cocido').click()`);
  const det = await D.text('.plato-ing-detail:not([hidden])');
  check('S2 the detail explains the missing fibre and shows the group and source', det.includes('el SMAE no da este dato') && det.includes('Alimentos de origen animal · muy bajo aporte de grasa (30 g)') && det.includes('SMAE 4a edición'), det);
  await D.screenshot(`${OUT}/smae-desk.png`);
});

await step('S3', async () => {
  await D.fill('#ing-q', 'frijol');
  await D.waitFor(`document.getElementById('status').textContent === '1 ingrediente'`);
  check('S3 "frijol" in the SMAE tab finds the SMAE food', (await names(D)).join() === 'Frijol prueba cocido');
  await D.click('#tab-usda');
  await D.waitFor(`document.getElementById('status').textContent === '420 ingredientes'`);
  check('S3 the USDA tab has its own (empty) search and an English hint', (await D.eval(`document.getElementById('ing-q').value`)) === '' && (await D.eval(`document.getElementById('ing-q').placeholder`)).includes('inglés') && (await D.text('#source-line')).startsWith('Fuente: USDA'));
  await D.fill('#ing-q', 'beans');
  await D.waitFor(`/^[0-9]+ ingredientes$/.test(document.getElementById('status').textContent) && document.getElementById('status').textContent !== '420 ingredientes' && document.querySelectorAll('.plato-ing-name').length >= 5`);
  check('S3 "beans" in USDA finds USDA foods only', (await names(D)).every((n) => /beans/i.test(n)));
  await D.eval(`(() => { const o = document.getElementById('ing-sort'); o.value = 'protein'; o.dispatchEvent(new Event('change')); })()`);
  await D.click('#tab-smae');
  await D.waitFor(`document.getElementById('ing-q').value === 'frijol' && document.getElementById('status').textContent === '1 ingrediente'`);
  check('S3 back on SMAE, its own search ("frijol") and sort (name) are still there', (await D.eval(`document.getElementById('ing-sort').value`)) === 'name');
  check('S3 the address says which tab and search', (await D.eval('location.search')) === '?q=frijol');
  await D.click('#tab-usda');
  await D.waitFor(`document.getElementById('ing-q').value === 'beans'`);
  await D.goto(`${BASE}/ingredients.html`);   // no ?tab: the page remembers the last tab on this device
  await ready(D);
  check('S3 opening Ingredientes again lands on the last tab used (USDA)', (await D.eval(`document.querySelector('#ing-tabs [aria-selected=true]').id`)) === 'tab-usda');
  await D.click('#tab-smae');
});

await step('S4', async () => {
  await D.fill('#ing-q', '');
  await D.waitFor(`document.getElementById('status').textContent === '5 ingredientes'`);
  const chips = await D.eval(`[...document.querySelectorAll('#tag-bar .plato-chip')].map((x) => x.textContent.replace(/\\s+/g, ' ').trim())`);
  check('S4 tag chips count only this tab\'s foods (SMAE: "bajo en sodio" on the invented foods, not USDA\'s hundreds)', chips.length >= 1 && chips.every((c) => Number((c.match(/\((\d+)\)$/) || [])[1]) <= 5), chips.join());
  await D.eval(`document.querySelector('#tag-bar .plato-chip').click()`);
  await sleep(400);
  check('S4 picking a chip narrows within SMAE', (await names(D)).length >= 1 && (await names(D)).every((n) => n.includes('prueba')));
  await D.eval(`[...document.querySelectorAll('#tag-bar button')].find((b) => b.textContent.startsWith('Quitar')).click()`);
});

await step('E1', async () => {
  await D.click('#tab-equivalentes');
  await D.waitFor(`document.querySelectorAll('details.plato-group').length === 5`);
  const g = await D.eval(`[...document.querySelectorAll('details.plato-group')].map((d) => [d.dataset.group, d.open, d.querySelectorAll('li').length])`);
  check('E1 Equivalentes: the SMAE groups in the book\'s order, closed, with their counts', JSON.stringify(g.map((x) => x[0])) === JSON.stringify(['Verduras', 'Cereales y tubérculos · sin grasa', 'Leguminosas', 'Alimentos de origen animal · muy bajo aporte de grasa', 'Leche · entera']) && g.every((x) => !x[1] && x[2] === 1), JSON.stringify(g));
  await D.fill('#ing-q', 'frijol');
  await D.waitFor(`document.querySelectorAll('details.plato-group').length === 1`);
  const li = await D.eval(`[document.querySelector('details.plato-group').open, document.querySelector('details.plato-group li').textContent]`);
  check('E1 searching "frijol" opens Leguminosas with "Frijol prueba cocido (cocido) · 1/2 taza … 90 g"', li[0] && li[1].startsWith('Frijol prueba cocido (cocido) · 1/2 taza') && li[1].endsWith('90 g'), JSON.stringify(li));
  check('E1 the Equivalentes search is its own (the SMAE tab search stays empty)', await (async () => { await D.click('#tab-smae'); await sleep(300); return (await D.eval(`document.getElementById('ing-q').value`)) === ''; })());
});

await step('A1', async () => {
  await D.eval(`window.__json = ''; const o = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { b.text().then((x) => { window.__json = x; }); return o(b); }`);
  await D.click('#ing-ai');
  await D.waitFor(`window.__json.length > 1000`);
  const doc = JSON.parse(await D.eval('window.__json'));
  const po = doc.ingredients.find((x) => x.name === 'Pollo prueba cocido'), corn = doc.ingredients.find((x) => x.name === 'Corn tortilla');
  check('A1 the AI list has both sources (425), each labelled; SMAE items have no fdc_id, an id, "equivalente" among units, and fibre null when unknown',
    doc.ingredients.length === 425 && po.source === 'SMAE' && po.fdc_id === null && po.id === ing['Pollo prueba cocido'].id && po.portions[0] === 'equivalente' && po.per_100g.fiber_g === null && corn.source === 'USDA' && corn.fdc_id > 0 && /ingredient_id/.test(doc.how_to_use), JSON.stringify([po, corn]).slice(0, 400));
});

// ---------- recipe builder ----------
let dishId = '';
await step('B1', async () => {
  const B = await open(1366, 900, '/dishes.html');
  globalThis.B = B;
  await B.waitFor(`document.getElementById('new-dish')`, 15000);
  await sleep(500);
  await B.click('#new-dish');
  await B.waitFor(`document.getElementById('dish-dialog')?.open`);
  const seg = await B.eval(`[...document.querySelectorAll('#dish-src [role=radio]')].map((b) => b.textContent + ':' + b.getAttribute('aria-checked'))`);
  check('B1 the builder search has Todos | SMAE | USDA, Todos picked', seg.join() === 'Todos:true,SMAE:false,USDA:false', seg.join());
  await B.fill('#dish-ing-q', 'tortilla');
  await B.waitFor(`document.querySelectorAll('#dish-results .plato-dish-result').length >= 2`);
  const all = await B.eval(`[...document.querySelectorAll('#dish-results .plato-dish-result')].map((b) => b.querySelector('.plato-src').textContent + ' ' + b.querySelector('strong').textContent)`);
  check('B1 Todos: "tortilla" finds SMAE and USDA foods, each with its label', all.includes('SMAE Tortilla prueba') && all.includes('USDA Corn tortilla'), all.join(' | '));
  await B.eval(`document.querySelector('#dish-src [data-src=smae]').click()`);
  await sleep(200);
  const sm = await B.eval(`[...document.querySelectorAll('#dish-results .plato-dish-result')].map((b) => b.querySelector('.plato-src').textContent)`);
  check('B1 SMAE: only SMAE results', sm.length === 1 && sm[0] === 'SMAE', sm.join());
  await B.eval(`document.querySelector('#dish-src [data-src=smae]').focus(); document.querySelector('#dish-src').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  await sleep(200);
  check('B1 arrow keys move the choice (SMAE → USDA) and the focus; USDA shows only USDA results', (await B.eval(`document.activeElement.dataset.src`)) === 'usda' && (await B.eval(`[...document.querySelectorAll('#dish-results .plato-src')].every((b) => b.textContent === 'USDA')`)));
  await B.eval(`document.querySelector('#dish-src [data-src=todos]').click()`);
  await B.fill('#dish-ing-q', 'frijol prueba');
  await B.waitFor(`document.querySelectorAll('#dish-results .plato-dish-result').length === 1`);
  check('B1 a result shows the SMAE equivalent', (await B.text('#dish-results .plato-dish-result')).includes('1 equivalente = 1/2 taza (90 g)'));
  await B.click('#dish-results .plato-dish-result');
  await B.waitFor(`document.querySelectorAll('#dish-lines .plato-dish-line').length === 1`);
  const units = await B.eval(`[...document.querySelector('#dish-lines select').options].map((o) => o.textContent)`);
  check('B2 an SMAE food can be measured in g, equivalente (90 g) and taza (180 g)', units.join() === 'g,equivalente (90 g),taza (180 g)', units.join());
  await B.eval(`(() => { const s = document.querySelector('#dish-lines select'); s.value = 'equivalente'; s.dispatchEvent(new Event('change')); const a = document.getElementById('dl-a-0'); a.value = '1'; a.dispatchEvent(new Event('input')); })()`);
  await sleep(200);
  const t1 = await B.text('#dish-totals-text');
  check('B2 1 equivalente of frijol = 120 kcal; fibre is a real number (8 g)', t1.startsWith('120 kcal') && t1.includes('Fibra 8 g'), t1);
  await B.fill('#dish-ing-q', 'pollo prueba');
  await B.waitFor(`document.querySelectorAll('#dish-results .plato-dish-result').length === 1`);
  await B.click('#dish-results .plato-dish-result');
  await B.waitFor(`document.querySelectorAll('#dish-lines .plato-dish-line').length === 2`);
  await B.eval(`(() => { const s = document.querySelectorAll('#dish-lines select')[1]; s.value = 'equivalente'; s.dispatchEvent(new Event('change')); const a = document.getElementById('dl-a-1'); a.value = '1'; a.dispatchEvent(new Event('input')); })()`);
  await B.fill('#dish-ing-q', 'corn tortilla');
  await B.waitFor(`document.querySelectorAll('#dish-results .plato-dish-result').length >= 1`);
  await B.click('#dish-results .plato-dish-result');
  await B.waitFor(`document.querySelectorAll('#dish-lines .plato-dish-line').length === 3`);
  await B.eval(`(() => { const a = document.getElementById('dl-a-2'); a.value = '30'; a.dispatchEvent(new Event('input')); })()`);
  await sleep(200);
  const t2 = await B.text('#dish-totals-text');
  const badges = await B.eval(`[...document.querySelectorAll('#dish-lines .plato-src')].map((b) => b.textContent).join()`);
  check('B3 adding the chicken (no fibre value) makes the total say "Fibra: incompleta"; each line shows its source', t2.includes('Fibra: incompleta') && badges === 'SMAE,SMAE,USDA', `${t2} | ${badges}`);
  await B.screenshot(`${OUT}/builder-desk.png`);
  await B.fill('#dish-name', 'Tostada mixta prueba');
  await B.fill('#dish-unit', 'tostada');
  await B.eval(`document.getElementById('dish-save').click()`);
  await B.waitFor(`!document.getElementById('dish-dialog') && [...document.querySelectorAll('#list .plato-dish h2')].some((x) => x.textContent === 'Tostada mixta prueba')`, 15000);
  const saved = (await api(`/api/collections/dishes/records?filter=${encodeURIComponent('name = "Tostada mixta prueba"')}`)).json.items[0];
  dishId = saved.id;
  const corn = (await api(`/api/collections/ingredients/records?filter=${encodeURIComponent('name = "Corn tortilla"')}`)).json.items[0];
  const want = 120 + 40 + 0.3 * corn.kcal;
  const shownKcal = Number((t2.match(/^([\d.,]+) kcal/) || [])[1]?.replace(',', ''));
  check(`B4 server total = screen total (${want.toFixed(1)} kcal); the server also says fibre is incomplete`, near(saved.nutrition.kcal, want, 0.01) && Math.abs(shownKcal - Math.round(want)) <= 1 && saved.nutrition.fiber_incomplete === true, JSON.stringify(saved.nutrition) + ' ' + t2);
  check('B4 the recipe card says "Fibra: incompleta"', (await B.eval(`[...document.querySelectorAll('#list .plato-dish')].find((c) => c.querySelector('h2').textContent === 'Tostada mixta prueba').querySelector('.plato-dish-stats').textContent`)).includes('Fibra: incompleta'));
  const plain = await api('/api/collections/dishes/records', 'POST', { nutritionist: NID, name: 'Solo frijol prueba', serving_unit: 'plato', items: [{ ingredient: ing['Frijol prueba cocido'].id, amount: 1, unit: 'equivalente' }] });
  check('B4 a recipe whose foods all have fibre is not flagged (Fibra 8 g)', plain.status === 200 && !plain.json.nutrition.fiber_incomplete && near(plain.json.nutrition.fiber_g, 8), JSON.stringify(plain.json?.nutrition));
});

await step('D1', async () => {
  const [diet] = (await api(`/api/collections/diets/records?filter=${encodeURIComponent(`patient = '${t.ana_id}'`)}`)).json.items;
  const plain = (await api(`/api/collections/dishes/records?filter=${encodeURIComponent('name = "Solo frijol prueba"')}`)).json.items[0];
  const r = await api(`/api/collections/diets/records/${diet.id}`, 'PATCH', { plan: { 1: { breakfast: [{ dish: dishId, servings: 1 }], lunch: [{ dish: plain.id, servings: 1 }] }, 2: { lunch: [{ dish: plain.id, servings: 2 }] } } });
  const c = r.json?.plan_calc;
  check('D1 in a diet, the day with that recipe says fibre incomplete (day and that meal); the meal and day without it do not',
    r.status === 200 && c.dishes[dishId].per_serving.fiber_incomplete === true && c.days['1'].total.fiber_incomplete === true && c.days['1'].slots.breakfast.fiber_incomplete === true && !c.days['1'].slots.lunch.fiber_incomplete && !c.days['2'].total.fiber_incomplete, JSON.stringify(c?.days).slice(0, 400));
  const P = await open(1366, 900, `/patient.html?id=${t.ana_id}`);
  await P.waitFor(`document.getElementById('t-diet')`, 20000); await P.click('#t-diet');
  await P.waitFor(`document.getElementById('plan-totals')?.textContent.includes('Total del día')`, 15000);
  const txt = await P.eval(`document.getElementById('plan-totals').textContent`);
  check('D1 the diet editor\'s day total shows "Fibra: incompleta" (screen arithmetic agrees)', txt.includes('Fibra: incompleta'), txt.slice(0, 200));
});

await step('P1', async () => {
  for (const w of [320, 360, 390]) {
    const p = await open(w, 700, '/ingredients.html?tab=smae', true);
    await ready(p); await sleep(400);
    const r = await p.eval(`({ grow: document.documentElement.scrollWidth > innerWidth || innerWidth > ${w} + 1, tabs: [...document.querySelectorAll('#ing-tabs [role=tab]')].every((b) => b.getBoundingClientRect().right <= innerWidth + 0.5), eq: [...document.querySelectorAll('.plato-ing-eq')].every((e) => e.getBoundingClientRect().right <= innerWidth + 0.5),
      off: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > ${w} + 1).map((e) => e.className || e.tagName).slice(0, 4) })`);
    check(`P1 ${w}px: the three tabs, the SMAE rows and their equivalent lines fit; no sideways scroll`, !r.grow && r.tabs && r.eq, JSON.stringify(r));
    if (w === 320) await p.screenshot(`${OUT}/smae-320.png`);
    await p.goto(`${BASE}/ingredients.html?tab=equivalentes&q=frijol`);
    await p.waitFor(`document.querySelectorAll('details.plato-group').length === 1`, 15000);
    check(`P1 ${w}px: Equivalentes (group open) fits`, await p.eval(`document.documentElement.scrollWidth <= innerWidth && innerWidth <= ${w} + 1`));
    if (w === 320) await p.screenshot(`${OUT}/eq-320.png`);
    await p.goto(`${BASE}/dishes.html`);
    await p.waitFor(`document.getElementById('new-dish')`, 15000); await sleep(500);
    await p.click('#new-dish');
    await p.waitFor(`document.getElementById('dish-dialog')?.open`);
    await p.fill('#dish-ing-q', 'tortilla'); await sleep(300);
    const d = await p.eval(`(() => { const s = document.getElementById('dish-src').getBoundingClientRect(), b = document.querySelector('#dish-dialog > div').getBoundingClientRect(); return { seg: s.left >= 0 && s.right <= innerWidth, box: b.right <= innerWidth + 0.5, res: [...document.querySelectorAll('#dish-results .plato-dish-result')].every((x) => x.getBoundingClientRect().right <= innerWidth + 0.5), grow: innerWidth > ${w} + 1 }; })()`);
    check(`P1 ${w}px: the builder's Todos | SMAE | USDA and the labelled results fit`, d.seg && d.box && d.res && !d.grow, JSON.stringify(d));
    if (w === 320) await p.screenshot(`${OUT}/builder-320.png`);
  }
});

const errs = [D, globalThis.B].filter(Boolean).flatMap((p) => p.errors).filter((e) => !/\b40[034]\b|Failed to load resource|ERR_NO_BUFFER_SPACE/.test(e)).join(' | ');
check('no console errors', !errs, errs);
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
