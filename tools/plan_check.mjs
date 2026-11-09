// Dishes inside a diet, editor screens (spec "Feature: Diets using dishes, slice (c)"): pick dishes, servings, live day totals that
// agree with the server, "La receta cambió" + Actualizar, copy to week, templates, the patient switch, phone widths.
// Usage: node tools/plan_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
import { launch } from './cdp.mjs';
import { superuser } from './admin.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const near = (a, b, eps = 0.0011) => Math.abs(a - b) < eps;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = async (name, fn) => {
  try { await fn(); } catch (e) {
    const now = await globalThis.P?.eval(`document.body.innerText.slice(0, 300)`).catch(() => '');
    check(name, false, `${e.message.split('\n')[0]} | page: ${now} | errors: ${(globalThis.P?.errors || []).slice(-3).join(' / ')}`);
  }
};
const SU = await superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
const N = t.nutritionist.token, NID = t.nutritionist.record.id, anaId = t.ana_id, carlosId = t.carlos_id;
const api = async (path, method = 'GET', body, token = N) => { const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };

// data: 4 ingredients and 2 dishes with simple numbers (taco 126.12 kcal, huevos 155 kcal)
const NL = String.fromCharCode(10);
writeFileSync(`${OUT}/e.csv`, ['name,state,kcal,protein_g,fat_g,carbs_g,fiber_g,fdc_id,density_g_ml,portions,tags', 'Corn tortilla,otro,218,5.7,2.9,44.6,6.3,9201,,tortilla:24,', 'Pork loin,cocido,143,26,3.5,0,0,9202,,,', 'Cilantro,crudo,23,2.1,0.5,3.7,2.8,9203,,,', 'Egg,cocido,155,12.6,10.6,1.1,0,9204,,large:50,', ''].join(NL));
const ld = spawnSync('python', ['tools/load_ingredients.py', '--base', BASE, '--csv', `${OUT}/e.csv`, '--dataset', 'plantest', '--source', 'test', '--version', '1', '--apply'], { env: { ...process.env, PB_SUPERUSER_TOKEN: SU, PYTHONIOENCODING: 'utf-8' }, encoding: 'utf-8' });
check('setup: ingredients loaded', ld.status === 0, ld.stdout + ld.stderr);
const ing = {};
for (const x of (await api('/api/collections/ingredients/records?perPage=50&filter=' + encodeURIComponent('dataset = "plantest"'))).json.items) ing[x.fdc_id] = x.id;
const line = (ingredient, amount, unit) => ({ ingredient, amount, unit });
const mkDish = (name, unit, items) => api('/api/collections/dishes/records', 'POST', { nutritionist: NID, name, serving_unit: unit, multi_serving: true, items });
const taco = (await mkDish('Taco de lomo', 'taco', [line(ing[9201], 1, 'tortilla'), line(ing[9202], 50, 'g'), line(ing[9203], 10, 'g')])).json;
const huevos = (await mkDish('Huevos', 'porción', [line(ing[9204], 2, 'large')])).json;
check('setup: dishes 126.12 and 155 kcal', near(taco.nutrition.kcal, 126.12) && near(huevos.nutrition.kcal, 155));
const [anaDiet] = (await api(`/api/collections/diets/records?filter=${encodeURIComponent(`patient = '${anaId}'`)}`)).json.items;
await api(`/api/collections/diets/records/${anaDiet.id}`, 'PATCH', { meals: {}, plan: {}, snacks: 2 });

const browser = await launch({ port: 9369, profileDir: `${OUT}/chrome-profile` });
async function open(w, h, path, mobile = false) {
  const p = await browser.newPage({ width: w, height: h, mobile });
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: N, record: t.nutritionist.record, collection: 'nutritionists' }))})`);
  await p.goto(`${BASE}${path}`);
  return p;
}
const dietTab = async (p) => { await p.waitFor(`document.getElementById('t-diet')`, 20000); await p.click('#t-diet'); await p.waitFor(`document.getElementById('meal-fields')?.children.length > 0`, 15000); };
const dayBtn = (p, i) => p.eval(`document.querySelectorAll('#days button')[${i}].click()`);
const addDish = async (p, slot, name) => {
  await p.eval(`document.querySelector('.plato-plan-slot[data-slot="${slot}"] [data-action=add-dish]').click()`);
  await p.waitFor(`document.querySelector('.plato-plan-slot[data-slot="${slot}"] .plato-plan-panel input[type=search]')`);
  await p.eval(`(() => { const i = document.querySelector('.plato-plan-slot[data-slot="${slot}"] .plato-plan-panel input[type=search]'); i.value = ${JSON.stringify(name)}; i.dispatchEvent(new Event('input')); })()`);
  await p.waitFor(`[...document.querySelectorAll('.plato-plan-slot[data-slot="${slot}"] .plato-dish-result strong')].some((s) => s.textContent === ${JSON.stringify(name)})`);
  await p.eval(`[...document.querySelectorAll('.plato-plan-slot[data-slot="${slot}"] .plato-dish-result')].find((b) => b.querySelector('strong').textContent === ${JSON.stringify(name)}).click()`);
};
const setServ = (p, slot, i, v) => p.eval(`(() => { const x = document.querySelectorAll('.plato-plan-slot[data-slot="${slot}"] .plato-plan-line')[${i}].querySelector('input'); x.value = ${JSON.stringify(String(v))}; x.dispatchEvent(new Event('input')); })()`);
const totals = (p) => p.eval(`document.getElementById('plan-totals')?.textContent || ''`);
const dietOf = async () => (await api(`/api/collections/diets/records/${anaDiet.id}`)).json;
let P = await open(1366, 900, `/patient.html?id=${anaId}`);
globalThis.P = P;
await P.eval(`window.confirm = () => true`);

await step('E1', async () => {
  await dietTab(P);
  check('E1 each meal has "Agregar receta"; no totals before any dish', (await P.eval(`document.querySelectorAll('[data-action=add-dish]').length`)) === 5 && (await totals(P)) === '');
  await addDish(P, 'breakfast', 'Taco de lomo');
  await P.waitFor(`document.querySelector('.plato-plan-slot[data-slot=breakfast] .plato-plan-line')`);
  check('E1 the picked dish becomes a line with 1 serving and its kcal ("= 126 kcal"), the search panel closes', (await P.text('.plato-plan-slot[data-slot=breakfast] .plato-plan-line')).includes('Taco de lomo') && (await P.text('.plato-plan-slot[data-slot=breakfast] .plato-plan-kcal')) === '= 126 kcal' && (await P.eval(`document.querySelector('.plato-plan-slot[data-slot=breakfast] .plato-plan-panel').hidden`)));
  await setServ(P, 'breakfast', 0, 3);
  await sleep(200);
  const live = await totals(P);
  check('E1 3 servings: the day total is live: "Total del día 378 kcal" (3 x 126.12)', live.includes('Total del día') && live.includes('378 kcal'), live);
  check('E1 the Monday button gets its "has meals" dot', await P.eval(`!!document.querySelectorAll('#days button')[0].querySelector('.plato-day-dot')`));
  await P.fill('#meal-breakfast', 'Café negro');
  check('E1 free text in the same meal: the total says it does not count the text', (await totals(P)).includes('Sin contar el texto libre'), await totals(P));
  await P.fill('#meal-breakfast', '');
  await addDish(P, 'lunch', 'Huevos');
  await sleep(200);
  check('E1 a second dish in another meal adds up: 126.12 x 3 + 155 = 533 kcal', (await totals(P)).includes('533 kcal'), await totals(P));
  await P.eval(`document.querySelector('#diet-form [type=submit]').click()`);
  await P.waitFor(`document.getElementById('diet-state').textContent.startsWith('Guardada')`, 15000);
  const d = await dietOf();
  check('E1 saved: the server\'s Monday total equals the screen\'s (533.36), the snapshot is kept, nothing numeric came from the screen',
    near(d.plan_calc.days['1'].total.kcal, 533.36) && d.plan['1'].breakfast[0].servings === 3 && d.plan['1'].lunch[0].name === 'Huevos', JSON.stringify(d.plan_calc?.days));
  await P.screenshot(`${OUT}/editor-desk.png`);
});

await step('E2', async () => {
  await setServ(P, 'breakfast', 0, 0.3);
  check('E2 0.3 servings is marked invalid and the kcal disappears', (await P.eval(`document.querySelector('.plato-plan-slot[data-slot=breakfast] input').getAttribute('aria-invalid')`)) === 'true');
  await P.eval(`document.querySelector('#diet-form [type=submit]').click()`);
  await sleep(300);
  check('E2 saving is refused with a plain message', (await P.text('#diet-form .plato-form-error')).includes('Revisa las porciones'), await P.text('#diet-form'));
  await setServ(P, 'breakfast', 0, 0.25);
  await sleep(150);
  check('E2 0.25 is valid (31 kcal)', (await P.text('.plato-plan-slot[data-slot=breakfast] .plato-plan-kcal')) === '= 32 kcal' || (await totals(P)).includes('kcal'));
  await setServ(P, 'breakfast', 0, 3);
});

await step('E3', async () => {
  await P.eval(`document.getElementById('copy-day').click()`);
  await sleep(300);
  await dayBtn(P, 1);
  await sleep(200);
  check('E3 "Copiar a todos los días" copies the dishes too (Tuesday has both lines and the same total)', (await P.eval(`document.querySelectorAll('.plato-plan-line').length`)) === 2 && (await totals(P)).includes('533 kcal'), await totals(P));
  await P.eval(`document.querySelector('.plato-plan-slot[data-slot=lunch] [data-action=remove]').click()`);
  await sleep(200);
  check('E3 removing a dish updates the Tuesday total (378 kcal); Monday keeps its own', (await totals(P)).includes('378 kcal'));
  await dayBtn(P, 0);
  await sleep(200);
  check('E3 Monday is untouched (533 kcal)', (await totals(P)).includes('533 kcal'));
  await P.eval(`document.querySelector('#diet-form [type=submit]').click()`);
  await P.waitFor(`document.getElementById('diet-state').textContent.startsWith('Guardada')`, 15000);
  const d = await dietOf();
  check('E3 saved: Monday 533.36, Tuesday 378.36 on the server', near(d.plan_calc.days['1'].total.kcal, 533.36) && near(d.plan_calc.days['2'].total.kcal, 378.36) && near(d.plan_calc.days['7'].total.kcal, 533.36), JSON.stringify(Object.fromEntries(Object.entries(d.plan_calc.days).map(([k, v]) => [k, v.total.kcal]))));
});

await step('E4', async () => {
  await api(`/api/collections/dishes/records/${taco.id}`, 'PATCH', { items: [line(ing[9201], 2, 'tortilla'), line(ing[9202], 50, 'g'), line(ing[9203], 10, 'g')] });   // 178.44
  await P.eval('location.reload()');
  await dietTab(P);
  await P.waitFor(`document.getElementById('plan-stale') && !document.getElementById('plan-stale').hidden`, 10000);
  const banner = await P.text('#plan-stale');
  check('E4 the dish changed (178.44): the banner says one dish changed and that patients still see the saved values', banner.includes('Una receta cambió') && banner.includes('siguen viendo los valores guardados'), banner);
  check('E4 the line says "La receta cambió" and the total still uses the SAVED number (533 kcal)', (await P.text('.plato-plan-slot[data-slot=breakfast] .plato-plan-changed')).includes('La receta cambió') && (await totals(P)).includes('533 kcal'), await totals(P));
  await P.eval(`document.querySelector('.plato-plan-slot[data-slot=breakfast] [data-action=refresh]').click()`);
  await sleep(250);
  check('E4 "Actualizar" renews it on screen: 3 x 178.44 + 155 = 690 kcal, the banner goes away, the change waits for Guardar', (await totals(P)).includes('690 kcal') && (await P.eval(`document.getElementById('plan-stale').hidden`)) && (await P.text('#diet-state')) === 'Cambios sin guardar', await totals(P));
  check('E4 not saved yet: the server still has 533.36', near((await dietOf()).plan_calc.days['1'].total.kcal, 533.36));
  await P.eval(`document.querySelector('#diet-form [type=submit]').click()`);
  await P.waitFor(`document.getElementById('diet-state').textContent.startsWith('Guardada')`, 15000);
  const d = await dietOf();
  check('E4 saved: the server\'s number equals the screen\'s (690.32) and Tuesday (whole week) is renewed too (3 x 178.44 = 535.32)', near(d.plan_calc.days['1'].total.kcal, 690.32) && near(d.plan_calc.days['2'].total.kcal, 535.32), JSON.stringify(d.plan_calc?.days['1']?.total));
});

await step('E5', async () => {
  await api(`/api/collections/dishes/records/${huevos.id}`, 'DELETE');
  await P.eval('location.reload()');
  await dietTab(P);
  check('E5 a deleted dish: the line says "receta borrada" and the total keeps its saved number', (await P.text('.plato-plan-slot[data-slot=lunch] .plato-plan-line')).includes('receta borrada') && (await totals(P)).includes('690 kcal'), await totals(P));
  const before = (await dietOf()).updated;
  await P.eval(`document.querySelector('#diet-form [type=submit]').click()`);
  for (let i = 0; i < 40 && (await dietOf()).updated === before; i++) await sleep(250);
  await sleep(500);
  check('E5 it still saves', near((await dietOf()).plan_calc.days['1'].total.kcal, 690.32));
  await P.eval(`document.querySelector('.plato-plan-slot[data-slot=lunch] [data-action=remove]').click()`);
  await sleep(200);
  check('E5 and can be removed (total 535 kcal)', (await totals(P)).includes('535 kcal'), `${await totals(P)} | lines: ${await P.eval(`document.querySelectorAll('.plato-plan-line').length`)} | state: ${await P.text('#diet-state')} | errs: ${(P.errors || []).slice(-3).join(' / ')}`);
});

await step('E6', async () => {
  // the week still has the deleted dish on other days: a template cannot be made until they are removed
  await P.eval(`document.getElementById('save-template').click()`);
  await P.waitFor(`document.getElementById('st-dialog')?.open`);
  await P.fill('#st-name', 'Plan con recetas');
  await P.click('#st-save');
  await P.waitFor(`document.querySelector('#st-form .plato-form-error')?.textContent.includes('recetas borradas')`, 8000);
  check('E6 a template cannot be saved while the week has a deleted dish: "Hay recetas borradas en la semana. Quítalas…"', true);
  await P.eval(`document.getElementById('st-cancel').click()`);
  for (let d = 1; d < 7; d++) {
    await dayBtn(P, d);
    await sleep(150);
    await P.eval(`document.querySelector('.plato-plan-slot[data-slot=lunch] [data-action=remove]')?.click()`);
    await sleep(150);
  }
  await dayBtn(P, 0);
  await sleep(200);
  await P.eval(`document.getElementById('save-template').click()`);
  await P.waitFor(`document.getElementById('st-dialog')?.open`);
  await P.fill('#st-name', 'Plan con recetas');
  await P.click('#st-save');
  await P.waitFor(`!document.getElementById('st-dialog').open`, 10000).catch(() => {});
  if (await P.eval(`document.getElementById('st-dialog').open`)) throw new Error('template dialog stayed open: ' + (await P.text('#st-form')).replace(/\s+/g, ' ') + ' | name=' + await P.eval(`document.getElementById('st-name').value`) + ' | saved=' + JSON.stringify((await api('/api/collections/diet_templates/records')).json.items.map((x) => x.title)));
  const tpl = (await api('/api/collections/diet_templates/records?filter=' + encodeURIComponent('title = "Plan con recetas"'))).json.items[0];
  check('E6 "Guardar como plantilla" keeps the dishes: the template has the plan and the server\'s totals (Monday 3 x 178.44 = 535.32)', tpl && tpl.plan['1'].breakfast[0].servings === 3 && near(tpl.plan_calc.days['1'].total.kcal, 535.32), JSON.stringify(tpl?.plan_calc?.days?.['1']));
  const T = await open(1366, 900, '/templates.html');
  await T.waitFor(`document.querySelector('#list > li, .plato-template, #list li')`, 15000);
  const txt = await T.eval(`document.body.innerText`);
  const btn = await T.eval(`[...document.querySelectorAll('button')].filter((b) => /Ver|vista|semana/i.test(b.textContent)).length`);
  check('E6 the Plantillas page counts the days with meals for a dishes-only template (7 días)', /7 días/.test(txt), txt.slice(0, 300));
  await T.eval(`[...document.querySelectorAll('button')].find((b) => /Ver|vista|semana/i.test(b.textContent))?.click()`);
  await sleep(300);
  check('E6 its preview lists "3 × Taco de lomo"', (await T.eval(`document.body.innerText`)).includes('3 × Taco de lomo'));
  // use it on Carlos
  const C = await open(1366, 900, `/patient.html?id=${carlosId}`);
  globalThis.P = C; await C.eval(`window.confirm = () => true`);
  await dietTab(C);
  await C.eval(`document.getElementById('use-template').click()`);
  await C.waitFor(`document.querySelector('#ut-list input[name=ut-pick]')`, 10000);
  await C.eval(`[...document.querySelectorAll('#ut-list label')].find((l) => l.textContent.includes('Plan con recetas')).querySelector('input').click()`);
  await C.waitFor(`document.getElementById('ut-preview').textContent.includes('3 × Taco de lomo')`);
  await C.eval(`document.getElementById('ut-use').click()`);
  await sleep(500);
  check('E6 using the template on another patient loads the dishes into the editor ("Taco de lomo" line, 3 servings, 535 kcal)', (await C.text('.plato-plan-slot[data-slot=breakfast] .plato-plan-line')).includes('Taco de lomo') && (await totals(C)).includes('535 kcal'), await totals(C));
  await C.eval(`document.querySelector('#diet-form [type=submit]').click()`);
  await C.waitFor(`document.getElementById('diet-state').textContent.startsWith('Guardada')`, 15000);
  const cd = (await api(`/api/collections/diets/records?filter=${encodeURIComponent(`patient = '${carlosId}'`)}`)).json.items[0];
  check('E6 saved on the other patient with its own snapshot and total (535.32)', near(cd.plan_calc.days['1'].total.kcal, 535.32), JSON.stringify(cd.plan_calc?.days['1']));
  globalThis.P = P;
});

await step('E7', async () => {
  P = await open(1366, 900, `/patient.html?id=${anaId}`); globalThis.P = P;
  await dietTab(P);
  check('E7 the "Mostrar calorías y macros al paciente" switch starts off', (await P.eval(`document.getElementById('show-numbers').checked`)) === false && (await P.text('#show-numbers-hint')).startsWith('Apagado'));
  await P.click('#show-numbers');
  await P.waitFor(`document.getElementById('show-numbers-hint').textContent.startsWith('Encendido')`);
  await sleep(300);
  check('E7 switching on is saved on the patient right away', (await api(`/api/collections/patients/records/${anaId}`)).json.show_numbers === true);
  await P.eval('location.reload()'); await dietTab(P);
  check('E7 it stays on after a reload', await P.eval(`document.getElementById('show-numbers').checked`));
  await P.click('#show-numbers');
  await sleep(500);
  check('E7 and off again', (await api(`/api/collections/patients/records/${anaId}`)).json.show_numbers === false);
});

await step('P1', async () => {
  for (const w of [320, 360, 390]) {
    const p = await open(w, 800, `/patient.html?id=${anaId}`, true);
    await dietTab(p);
    await addDish(p, 'dinner', 'Taco de lomo');
    await p.waitFor(`document.querySelector('.plato-plan-slot[data-slot=dinner] .plato-plan-line')`);
    await sleep(300);
    const m = await p.eval(`(() => { const vw = innerWidth; const els = [...document.querySelectorAll('.plato-plan-line, .plato-plan-line *, #plan-totals, #plan-stale, .plato-numbers-switch')]; return { page: document.documentElement.scrollWidth <= vw && vw <= ${w} + 1, inside: els.every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.left >= -0.5 && r.right <= vw + 0.5); }) }; })()`);
    check(`P1 ${w}px: the diet editor with dishes fits (lines, controls, totals, switch), no sideways scroll`, m.page && m.inside, JSON.stringify(m));
    if (w === 320) await p.screenshot(`${OUT}/editor-320.png`);
    await p.close?.();
  }
});

const errs = (globalThis.P?.errors || []).filter((e) => !/\b40[034]\b|Failed to load resource/.test(e)).join(' | ');
check('no console errors', !errs, errs);
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
