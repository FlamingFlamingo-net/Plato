// tools/snack_check.mjs — screen acceptance for "Snacks per diet + meal goal = all planned meals".
// THROWAWAY server seeded with tools/seed.py (Laura = nutritionist; Ana has a diet and the app; Carlos has neither).
//   PB_CONTAINER=pb-check node tools/snack_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
import { launch } from './cdp.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
const BOX = process.env.PB_CONTAINER || 'pb-check';
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const TODAY = ymd(new Date());
const WD = String(((new Date().getDay() + 6) % 7) + 1);          // today's ISO weekday, "1" = Monday
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const monday = addDays(TODAY, -(Number(WD) - 1));
const api = async (token, method, path, body) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (r.status >= 400) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const N = t.nutritionist.token, A = t.ana.token, anaId = t.ana_id, carlosId = t.carlos_id;
const ALL7 = { snack_early: 'Plátano', breakfast: 'Avena con fruta', snack_am: 'Manzana', lunch: 'Pollo con arroz', snack_pm: 'Yogur', dinner: 'Ensalada de atún', snack_night: 'Té y nueces' };
const [anaDiet] = (await api(N, 'GET', `/api/collections/diets/records?filter=${encodeURIComponent(`patient = '${anaId}'`)}`)).items;
const setAnaDiet = (snacks, todayMeals) => api(N, 'PATCH', `/api/collections/diets/records/${anaDiet.id}`, { snacks, meals: { ...anaDiet.meals, [WD]: todayMeals } });
const clearAnaToday = async () => {
  const logs = (await api(A, 'GET', `/api/collections/meal_logs/records?perPage=50&filter=${encodeURIComponent(`patient = '${anaId}' && date = '${TODAY}'`)}`)).items;
  for (const l of logs) await api(A, 'DELETE', `/api/collections/meal_logs/records/${l.id}`);
};
const checkMeal = (slot) => api(A, 'POST', '/api/collections/meal_logs/records', { patient: anaId, date: TODAY, slot });

const browser = await launch({ port: 9348, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const nutri = await as('nutritionist', { width: 1280, height: 900 });
const ana = await as('ana', { width: 390, height: 844, mobile: true });
const rows = () => nutri.eval(`[...document.querySelectorAll('#meal-fields textarea')].map(x => x.id.replace('meal-', ''))`);
const openDiet = async (id) => {
  await nutri.goto(`${BASE}/patient.html?id=${id}`);
  await nutri.waitFor(`!document.getElementById('content').hidden`);
  await nutri.click('#t-diet');   // the diet loads when its tab opens
  await nutri.waitFor(`document.querySelectorAll('#snacks button').length === 5 && document.querySelectorAll('#meal-fields textarea').length > 0`);
  await nutri.eval('window.confirm = () => true');
};
const pressed = () => nutri.eval(`document.querySelector('#snacks [aria-pressed=true]')?.textContent`);
const anaHoy = async () => {
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`document.querySelector('.plato-week-row[data-kind=meal]') && !document.getElementById('status').textContent.startsWith('Cargando')`);
  await sleep(300);
  return ana.eval(`({ slots: [...document.querySelectorAll('#meals li')].map(li => li.dataset.slot), slices: document.querySelectorAll('#plate .plate-slice').length,
    today: document.querySelector('.plato-week-row[data-kind=meal] .plato-week-line span').textContent,
    dot: document.querySelector('.plato-week-row[data-kind=meal] .plato-week-dots li.is-today')?.className || '',
    goal: document.querySelector('.plato-week-row[data-kind=meal]').textContent, wide: document.documentElement.scrollWidth <= innerWidth })`);
};

await step('S1', async () => {
  await openDiet(carlosId);
  const r = await rows();
  check('S1 a new diet starts with 2 snacks: 5 rows (desayuno, mañana, comida, tarde, cena)', await pressed() === '2' && r.join() === 'breakfast,snack_am,lunch,snack_pm,dinner', `${await pressed()} ${r}`);
  await nutri.click('#snacks button:nth-child(5)');   // 4
  const r4 = await rows();
  check('S1 4 snacks: 7 rows, "previa al desayuno" first and "nocturna" last', r4.join() === 'snack_early,breakfast,snack_am,lunch,snack_pm,dinner,snack_night', r4.join());
  const lbl = await nutri.eval(`document.querySelector('label[for=meal-snack_early]').textContent + '|' + document.querySelector('label[for=meal-snack_night]').textContent`);
  check('S1 their labels', lbl === 'Colación previa al desayuno|Colación nocturna', lbl);
  await nutri.fill('#meal-snack_early', 'Plátano antes de entrenar');
  await nutri.click('#snacks button:nth-child(3)');   // 2
  const r2 = await rows();
  await nutri.click('#snacks button:nth-child(5)');   // 4 again
  const back = await nutri.eval(`document.getElementById('meal-snack_early').value`);
  check('S1 back to 2 hides them; at 4 again the text is still there', r2.length === 5 && back === 'Plátano antes de entrenar', `${r2.length} ${back}`);
  await nutri.click('#snacks button:nth-child(1)');   // 0
  check('S1 0 snacks: only desayuno, comida, cena', (await rows()).join() === 'breakfast,lunch,dinner');
  await nutri.click('#snacks button:nth-child(4)');   // 3
  await nutri.fill('#meal-breakfast', 'Huevos');
  await nutri.click('#diet-form [type=submit]');
  await nutri.waitFor(`document.getElementById('diet-state').textContent.startsWith('Guardada')`);
  const [d] = (await api(N, 'GET', `/api/collections/diets/records?filter=${encodeURIComponent(`patient = '${carlosId}'`)}`)).items;
  check('S1 the snack number saves with the diet (3), hidden text kept', d.snacks === 3 && d.meals['1']?.snack_early === 'Plátano antes de entrenar', JSON.stringify({ s: d.snacks, m: d.meals['1'] }));
  await openDiet(carlosId);
  check('S1 reopened: 3 snacks, nocturna shown', await pressed() === '3' && (await rows()).includes('snack_night'));
  await nutri.screenshot(`${OUT}/diet-editor.png`, { full: false });
});

await step('S2', async () => {
  await clearAnaToday();
  await setAnaDiet(4, ALL7);
  const s = await anaHoy();
  check('S2 Hoy with 4 snacks: 7 meals in the order of the day, plate with 7 slices', s.slots.join() === 'snack_early,breakfast,snack_am,lunch,snack_pm,dinner,snack_night' && s.slices === 7, JSON.stringify(s));
  check('S2 phone 390 px: no sideways scroll', s.wide);
  await ana.screenshot(`${OUT}/hoy-7.png`, { full: true });
  await ana.goto(`${BASE}/log.html`);
  await ana.waitFor(`document.querySelectorAll('#slots input').length > 0`);
  const opts = await ana.eval(`[...document.querySelectorAll('#slots input')].map(i => i.value)`);
  check('S2 Registrar offers today\'s 7 planned meals + Comida extra', opts.join() === 'snack_early,breakfast,snack_am,lunch,snack_pm,dinner,snack_night,extra', opts.join());
  await setAnaDiet(2, { breakfast: 'Avena', lunch: 'Pollo', dinner: 'Atún', snack_night: 'Texto oculto' });
  await ana.goto(`${BASE}/log.html`);
  await ana.waitFor(`document.querySelectorAll('#slots input').length > 0`);
  const o2 = await ana.eval(`[...document.querySelectorAll('#slots input')].map(i => i.value)`);
  check('S2 only planned ones: 3 meals (a hidden snack with text is not offered) + extra', o2.join() === 'breakfast,lunch,dinner,extra', o2.join());
});

await step('S3', async () => {
  await clearAnaToday();
  await setAnaDiet(2, { breakfast: 'Avena', snack_am: 'Manzana', lunch: 'Pollo', snack_pm: 'Yogur', dinner: 'Atún' });
  for (const s of ['breakfast', 'snack_am', 'lunch', 'snack_pm']) await checkMeal(s);
  let s = await anaHoy();
  check('S3 5 planned, 4 checked: "Hoy: 4 de 5", the day does not count yet', s.today === 'Hoy: 4 de 5 comidas' && !s.dot.includes('is-met'), JSON.stringify(s));
  await checkMeal('dinner');
  s = await anaHoy();
  check('S3 all 5 checked: the day counts', s.today === 'Hoy: 5 de 5 comidas' && s.dot.includes('is-met'), JSON.stringify(s));
  check('S3 goal text: "todas las de tu plan"', s.goal.includes('todas las de tu plan, 5 días a la semana'), s.goal);
  await clearAnaToday();
  await setAnaDiet(0, { breakfast: 'Avena', snack_am: 'oculta', lunch: 'Pollo', dinner: 'Atún' });
  for (const sl of ['breakfast', 'lunch', 'dinner']) await checkMeal(sl);
  s = await anaHoy();
  check('S3 with 0 snacks, 3 meals are enough', s.today === 'Hoy: 3 de 3 comidas' && s.dot.includes('is-met'), JSON.stringify(s));
  await clearAnaToday();
  await setAnaDiet(2, {});
  s = await anaHoy();
  check('S3 a day without plan: "Hoy: sin plan", shown apart (not a miss)', s.today === 'Hoy: sin plan' && s.dot.includes('is-noplan'), JSON.stringify(s));
  await ana.screenshot(`${OUT}/hoy-noplan.png`, { full: false });
});

await step('S4', async () => {
  // Admin writes an older week with the old rule (3 meals a day) before this week's "all".
  const email = `zz-su-${randomBytes(3).toString('hex')}@test.local`, pw = `Zz${randomBytes(12).toString('hex')}`;
  execFileSync('docker', ['exec', BOX, '/pb/pocketbase', 'superuser', 'upsert', email, pw]);
  const su = await api(null, 'POST', '/api/collections/_superusers/auth-with-password', { identity: email, password: pw });
  await api(su.token, 'PATCH', `/api/collections/patients/records/${anaId}`, { goal_history: [
    { from: addDays(monday, -14), service: 'nutrition', meal_days: 5, meal_per_day: 3, act_days: 0, act_min: 30 },
    { from: monday, service: 'nutrition', meal_days: 5, meal_per_day: 'all', act_days: 0, act_min: 30 }] });
  await nutri.goto(`${BASE}/patient.html?id=${anaId}`);
  await nutri.waitFor(`document.querySelector('.plato-week-table tbody tr')`);
  const r = await nutri.eval(`({ sub: document.getElementById('goals-sub').textContent, rows: [...document.querySelector('.plato-week-table').querySelectorAll('tbody tr')].map(tr => [...tr.children].map(td => td.textContent)) })`);
  check('S4 the patient page says "Comidas: todas las de tu plan"', r.sub.includes('Comidas: todas las de tu plan, 5 días a la semana'), r.sub);
  check('S4 this week uses the new rule; two weeks ago keeps "3 comidas al día"', r.rows[0][2].startsWith('todas las de tu plan') && r.rows[2][2].startsWith('3 comidas al día'), JSON.stringify(r.rows.slice(0, 3)));
  await nutri.click('#goals-edit');
  await nutri.waitFor(`document.getElementById('goals-dialog').open`);
  const noPer = await nutri.eval(`!document.getElementById('gd-meal-per')`);
  check('S4 "Cambiar metas" no longer asks for meals a day', noPer);
  await nutri.eval(`(() => { const s = document.getElementById('gd-meal-days'); s.value = '4'; })()`);
  await nutri.click('#gd-save');
  await nutri.waitFor(`!document.getElementById('goals-dialog').open`);
  const p = await api(N, 'GET', `/api/collections/patients/records/${anaId}`);
  const last = p.goal_history[p.goal_history.length - 1];
  check('S4 saving writes this week as "all" (4 days)', last.meal_per_day === 'all' && last.meal_days === 4, JSON.stringify(last));
});

await step('S5', async () => {
  const tpl = await api(N, 'POST', '/api/collections/diet_templates/records', { nutritionist: t.nutritionist.record.id, title: 'ZZ Tres colaciones', snacks: 3, meals: { 1: { breakfast: 'Avena', snack_night: 'Té' } } });
  check('S5 a template keeps its snack number', tpl.snacks === 3, tpl.snacks);
  const plain = await api(N, 'POST', '/api/collections/diet_templates/records', { nutritionist: t.nutritionist.record.id, title: 'ZZ Sin número', meals: { 1: { breakfast: 'Avena' } } });
  check('S5 without a number the server uses 2', plain.snacks === 2, plain.snacks);
  await openDiet(anaId);
  await nutri.click('#use-template');
  await nutri.waitFor(`[...document.querySelectorAll('#ut-list input')].length >= 2`);
  await nutri.eval(`(() => { const i = [...document.querySelectorAll('#ut-list label')].find(l => l.textContent.includes('ZZ Tres colaciones')).querySelector('input'); i.checked = true; i.dispatchEvent(new Event('change')); })()`);
  await nutri.click('#ut-use');
  await nutri.waitFor(`!document.getElementById('ut-dialog').open`);
  check('S5 applying it sets 3 snacks in the editor', await pressed() === '3' && (await rows()).includes('snack_night'));
  await nutri.click('#diet-form [type=submit]');
  await nutri.waitFor(`document.getElementById('diet-state').textContent.startsWith('Guardada')`);
  await setAnaDiet(4, ALL7);
  await nutri.goto(`${BASE}/diet-print.html?id=${anaId}`);
  await nutri.waitFor(`document.querySelector('.week-table tbody tr')`, 15000);
  const pr = await nutri.eval(`[...document.querySelectorAll('.week-table tbody tr')].map(tr => tr.dataset.slot)`);
  check('S5 print: 7 rows with 4 snacks', pr.join() === 'snack_early,breakfast,snack_am,lunch,snack_pm,dinner,snack_night', pr.join());
  await nutri.goto(`${BASE}/export.html?id=${anaId}`);
  await nutri.waitFor(`document.querySelector('.week-list')`, 15000);
  const ex = await nutri.eval(`document.querySelector('.week-list').textContent`);
  check('S5 export lists the new snacks', ex.includes('Colación previa al desayuno') && ex.includes('Colación nocturna'), ex.slice(0, 200));
});

const errs = [...nutri.errors, ...ana.errors].join(' | ');
check('S6 no console errors', !errs, errs);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
