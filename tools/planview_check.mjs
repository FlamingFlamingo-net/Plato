// Dishes on the patient's screens, print sheet and export (spec "Feature: Diets using dishes, slice (c)"): with and without numbers.
// Usage: node tools/planview_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
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
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, `${e.message.split('\n')[0]}`); } };
const SU = await superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
const N = t.nutritionist.token, NID = t.nutritionist.record.id, anaId = t.ana_id;
const api = async (path, method = 'GET', body, token = N) => { const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
const NL = String.fromCharCode(10);
writeFileSync(`${OUT}/v.csv`, ['name,state,kcal,protein_g,fat_g,carbs_g,fiber_g,fdc_id,density_g_ml,portions,tags', 'Corn tortilla,otro,218,5.7,2.9,44.6,6.3,9301,,tortilla:24,', 'Pork loin,cocido,143,26,3.5,0,0,9302,,,', 'Cilantro,crudo,23,2.1,0.5,3.7,2.8,9303,,,', 'Egg,cocido,155,12.6,10.6,1.1,0,9304,,large:50,', ''].join(NL));
const ld = spawnSync('python', ['tools/load_ingredients.py', '--base', BASE, '--csv', `${OUT}/v.csv`, '--dataset', 'plantest', '--source', 'test', '--version', '1', '--apply'], { env: { ...process.env, PB_SUPERUSER_TOKEN: SU, PYTHONIOENCODING: 'utf-8' }, encoding: 'utf-8' });
check('setup: ingredients loaded', ld.status === 0, ld.stdout + ld.stderr);
const ing = {};
for (const x of (await api('/api/collections/ingredients/records?perPage=50&filter=' + encodeURIComponent('dataset = "plantest"'))).json.items) ing[x.fdc_id] = x.id;
const line = (ingredient, amount, unit) => ({ ingredient, amount, unit });
const mkDish = (name, unit, items) => api('/api/collections/dishes/records', 'POST', { nutritionist: NID, name, serving_unit: unit, multi_serving: true, items });
const taco = (await mkDish('Taco de lomo', 'taco', [line(ing[9301], 1, 'tortilla'), line(ing[9302], 50, 'g'), line(ing[9303], 10, 'g')])).json;
const huevos = (await mkDish('Huevos', 'porción', [line(ing[9304], 2, 'large')])).json;
const L = (dish, servings) => ({ dish, servings });
// every weekday: breakfast 3 x taco, lunch 1 x huevos + free text "Ensalada", dinner 1 x taco (dishes only, no text)
const day = { breakfast: [L(taco.id, 3)], lunch: [L(huevos.id, 1)], dinner: [L(taco.id, 1)] };
const plan = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, structuredClone(day)]));
const meals = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [d, { lunch: 'Ensalada' }]));
const [diet] = (await api(`/api/collections/diets/records?filter=${encodeURIComponent(`patient = '${anaId}'`)}`)).json.items;
const saved = await api(`/api/collections/diets/records/${diet.id}`, 'PATCH', { title: 'Plan con recetas', snacks: 2, meals, plan });
check('setup: diet saved; day total 659.48 (378.36 + 155 + 126.12)', saved.status === 200 && near(saved.json.plan_calc.days['3'].total.kcal, 659.48), JSON.stringify(saved.json?.plan_calc?.days?.['3']?.total));
const setNumbers = (on) => api(`/api/collections/patients/records/${anaId}`, 'PATCH', { show_numbers: on });
await setNumbers(false);

const browser = await launch({ port: 9370, profileDir: `${OUT}/chrome-profile` });
async function as(who, w, h, path, mobile = false) {
  const p = await browser.newPage({ width: w, height: h, mobile });
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  await p.goto(`${BASE}${path}`);
  return p;
}
const body = (p) => p.eval(`document.body.innerText.replace(/\\s+/g, ' ')`);

await step('V1', async () => {
  const a = await as('ana', 390, 844, '/today.html', true);
  await a.waitFor(`document.querySelectorAll('#meals .plato-meal--check').length > 0`, 20000);
  const rows = await a.eval(`[...document.querySelectorAll('#meals .plato-meal--check')].map((r) => r.dataset.slot + ': ' + r.querySelector('.plato-meal-plan').innerText.replace(/\\s+/g, ' ').trim())`);
  check('V1 switch OFF, the patient\'s Hoy: three planned meals, the dishes-only dinner included', rows.length === 3 && rows[0] === 'breakfast: 3 × Taco de lomo' && rows[1] === 'lunch: 1 × Huevos Ensalada' && rows[2] === 'dinner: 1 × Taco de lomo', JSON.stringify(rows));
  const txt = await body(a);
  check('V1 no number anywhere on the page: no "kcal", no "Total del día"', !/kcal|Total del día/.test(txt), txt.slice(0, 400));
  await a.eval(`document.querySelector('#meals [data-slot=dinner] .plato-check').click()`);
  await a.waitFor(`document.querySelector('#meals [data-slot=dinner]').classList.contains('is-done')`, 10000);
  check('V1 a dishes-only meal can be checked off like any other', true);
  await a.screenshot(`${OUT}/today-off.png`);
});

await step('V2', async () => {
  await setNumbers(true);
  const a = await as('ana', 390, 844, '/today.html', true);
  await a.waitFor(`document.querySelectorAll('#meals .plato-meal--check').length > 0`, 20000);
  await a.waitFor(`document.querySelector('#day-total .week-day-total')`, 10000);
  const rows = await a.eval(`[...document.querySelectorAll('#meals .plato-meal--check')].map((r) => r.dataset.slot + ': ' + r.querySelector('.plato-meal-plan').innerText.replace(/\\s+/g, ' ').trim())`);
  check('V2 switch ON: each meal shows its calories; a meal that also has free text says "+ texto libre"', rows[0] === 'breakfast: 3 × Taco de lomo 378 kcal' && rows[1] === 'lunch: 1 × Huevos Ensalada 155 kcal + texto libre' && rows[2] === 'dinner: 1 × Taco de lomo 126 kcal', JSON.stringify(rows));
  const tot = await a.text('#day-total');
  check('V2 the day total shows kcal and P / G / C, and is flagged partial because of the free text (659 kcal + texto libre · P 69,9 g…)', /Total del día/.test(tot) && /659 kcal \+ texto libre/.test(tot) && /P \d+[,.]\d g · G \d+[,.]\d g · C \d+[,.]\d g/.test(tot), tot);
  const server = (await api(`/api/collections/diets/records/${diet.id}`, 'GET', null, t.ana.token)).json;
  check('V2 the patient\'s numbers are the server\'s (plan_calc 659.48 kcal on every day)', near(server.plan_calc.days['3'].total.kcal, 659.48));
  await a.screenshot(`${OUT}/today-on.png`);
  for (const w of [320, 360]) {
    const p = await as('ana', w, 700, '/today.html', true);
    await p.waitFor(`document.querySelector('#day-total .week-day-total')`, 15000);
    const m = await p.eval(`(() => { const vw = innerWidth; return document.documentElement.scrollWidth <= vw && vw <= ${w} + 1 && [...document.querySelectorAll('#meals *, #day-total *')].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.left >= -0.5 && r.right <= vw + 0.5); }); })()`);
    check(`V2 ${w}px: the day with numbers fits, no sideways scroll`, m);
  }
});

await step('V3', async () => {
  // print sheet, as the nutritionist: it follows the PATIENT'S switch, not who prints
  await setNumbers(false);
  const n = await as('nutritionist', 1280, 900, `/diet-print.html?id=${anaId}`);
  await n.waitFor(`!document.getElementById('sheet').hidden`, 20000);
  const off = await n.eval(`document.querySelector('.week-table').innerText.replace(/\\s+/g, ' ')`);
  check('V3 print, switch OFF (even for the nutritionist): dishes on the sheet ("3 × Taco de lomo") but no kcal and no total row', off.includes('3 × Taco de lomo') && off.includes('1 × Huevos') && off.includes('Ensalada') && !/kcal|Total del día/.test(off), off.slice(0, 300));
  await setNumbers(true);
  const n2 = await as('nutritionist', 1280, 900, `/diet-print.html?id=${anaId}`);
  await n2.waitFor(`!document.getElementById('sheet').hidden`, 20000);
  const on = await n2.eval(`document.querySelector('.week-table').innerText.replace(/\\s+/g, ' ')`);
  const cells = await n2.eval(`document.querySelectorAll('.week-table tfoot td').length`);
  check('V3 print, switch ON: every meal has its kcal, and a "Total del día" row has 7 day cells ("659 kcal + texto libre")', on.includes('378 kcal') && on.includes('155 kcal + texto libre') && /Total del día/.test(on) && on.includes('659 kcal + texto libre') && cells === 7, on.slice(-300));
  const a = await as('ana', 390, 844, '/diet-print.html', true);
  await a.goto(`${BASE}/diet-print.html?id=${anaId}`);
  await a.waitFor(`!document.getElementById('sheet').hidden`, 20000);
  check('V3 print as the patient (switch ON): the same numbers', (await a.eval(`document.querySelector('.week-table').innerText`)).includes('378 kcal'));
  await n2.screenshot(`${OUT}/print-on.png`);
});

await step('V4', async () => {
  await setNumbers(false);
  const e1 = await as('nutritionist', 1280, 900, `/export.html?id=${anaId}`);
  await e1.waitFor(`document.querySelector('.week-list')`, 20000);
  const off = await e1.eval(`document.querySelector('.week-list').innerText.replace(/\\s+/g, ' ')`);
  check('V4 export, switch OFF: dishes listed, no numbers', off.includes('3 × Taco de lomo') && off.includes('Ensalada') && !/kcal|Total del día/.test(off), off.slice(0, 250));
  await setNumbers(true);
  const e2 = await as('nutritionist', 1280, 900, `/export.html?id=${anaId}`);
  await e2.waitFor(`document.querySelector('.week-list')`, 20000);
  const on = await e2.eval(`document.querySelector('.week-list').innerText.replace(/\\s+/g, ' ')`);
  check('V4 export, switch ON: calories per meal and "Total del día" per weekday', on.includes('378 kcal') && /Total del día/.test(on) && (await e2.eval(`document.querySelectorAll('.week-day-total').length`)) === 7, on.slice(0, 300));
});

await step('V5', async () => {
  const a = await as('ana', 390, 844, '/log.html?slot=breakfast', true);
  await a.waitFor(`document.getElementById('planned')?.textContent`, 15000);
  const txt = await a.eval(`document.getElementById('planned').textContent`);
  check('V5 the photo page shows "Tu plan: 3 × Taco de lomo" for the chosen meal', txt === 'Tu plan: 3 × Taco de lomo', txt);
});

await setNumbers(false);
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
