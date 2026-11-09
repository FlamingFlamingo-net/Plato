// Diets using dishes, server side (spec "Feature: Diets using dishes, slice (c)"): snapshots, totals against hand-made numbers,
// refusals, ownership, "a saved diet never changes on its own", numbers hidden from a patient unless switched on.
// Usage: node tools/planapi_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
import { createNutritionist, superuser } from './admin.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const near = (a, b, eps = 0.0011) => Math.abs(a - b) < eps;
const N = t.nutritionist.token, NID = t.nutritionist.record.id, A = t.ana.token, anaId = t.ana_id, carlosId = t.carlos_id;
const SU = await superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
const NL = String.fromCharCode(10);
async function api(path, { method = 'GET', body, token = N } = {}) {
  const headers = token ? { Authorization: token } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const raw = await r.text(); let json = null; try { json = JSON.parse(raw); } catch {}
  return { status: r.status, json, raw };
}
const H = 'name,state,kcal,protein_g,fat_g,carbs_g,fiber_g,fdc_id,density_g_ml,portions,tags';
const ROWS = ['Corn tortilla,otro,218,5.7,2.9,44.6,6.3,9101,,tortilla:24,', 'Pork loin,cocido,143,26,3.5,0,0,9102,,,', 'Cilantro,crudo,23,2.1,0.5,3.7,2.8,9103,,,', 'Egg,cocido,155,12.6,10.6,1.1,0,9104,,large:50,'];
const loader = (rows, extra = []) => {
  writeFileSync(`${OUT}/p.csv`, `${H}${NL}${rows.join(NL)}${NL}`);
  return spawnSync('python', ['tools/load_ingredients.py', '--base', BASE, '--csv', `${OUT}/p.csv`, '--dataset', 'plantest', '--source', 'test', '--version', '1', ...extra], { env: { ...process.env, PB_SUPERUSER_TOKEN: SU, PYTHONIOENCODING: 'utf-8' }, encoding: 'utf-8' });
};
check('setup: 4 test ingredients loaded', loader(ROWS, ['--apply']).status === 0);
const ing = {};
for (const x of (await api(`/api/collections/ingredients/records?perPage=50&filter=${encodeURIComponent('dataset = "plantest"')}`)).json.items) ing[x.fdc_id] = x.id;
const line = (ingredient, amount, unit) => ({ ingredient, amount, unit });
const mkDish = (name, items, token = N, nid = NID) => api('/api/collections/dishes/records', { method: 'POST', token, body: { nutritionist: nid, name, serving_unit: 'taco', multi_serving: true, items } });
// taco = 24 g tortilla + 50 g pork + 10 g cilantro = 126.12 kcal, 14.578 P, 2.496 F, 11.074 C, 1.792 fibre
const taco = (await mkDish('Taco plan', [line(ing[9101], 1, 'tortilla'), line(ing[9102], 50, 'g'), line(ing[9103], 10, 'g')])).json;
const huevo = (await mkDish('Huevo plan', [line(ing[9104], 2, 'large')])).json;      // 155 kcal
check('setup: the dishes are 126.12 and 155 kcal', near(taco.nutrition.kcal, 126.12) && near(huevo.nutrition.kcal, 155));

const [diet] = (await api(`/api/collections/diets/records?filter=${encodeURIComponent(`patient = '${anaId}'`)}`)).json.items;
const savePlan = (plan, extra = {}, id = diet.id) => api(`/api/collections/diets/records/${id}`, { method: 'PATCH', body: { plan, ...extra } });
const L = (dish, servings) => ({ dish, servings });
const MON = { 1: { breakfast: [L(taco.id, 3)] } };

let r = await savePlan(MON, { meals: { 1: { breakfast: '' } } });
let d1 = r.json?.plan_calc?.days?.['1'];
check('P1 "Taco x 3" on Monday breakfast: slot and day = 378.36 kcal, 43.734 P, 7.488 F, 33.222 C, 5.376 fibre (3 x the taco)',
  r.status === 200 && d1 && near(d1.slots.breakfast.kcal, 378.36) && near(d1.total.kcal, 378.36) && near(d1.total.protein_g, 43.734) && near(d1.total.fat_g, 7.488) && near(d1.total.carbs_g, 33.222) && near(d1.total.fiber_g, 5.376), JSON.stringify(r.json?.plan_calc || r.json));
check('P1 the stored line carries the dish name and unit; nothing numeric is on the line itself',
  r.json.plan['1'].breakfast[0].name === 'Taco plan' && r.json.plan['1'].breakfast[0].unit === 'taco' && Object.keys(r.json.plan['1'].breakfast[0]).sort().join() === 'dish,name,servings,unit', JSON.stringify(r.json.plan));
check('P1 the snapshot holds the per-serving numbers (126.12) and the dish name', near(r.json.plan_calc.dishes[taco.id].per_serving.kcal, 126.12) && r.json.plan_calc.dishes[taco.id].name === 'Taco plan');

// free text, mixed
r = await savePlan(MON, { meals: { 1: { breakfast: 'Café negro' } } });
d1 = r.json.plan_calc.days['1'];
check("P2 dishes + free text in one slot: the totals are the dishes' and the slot and the day are flagged free_text", r.status === 200 && near(d1.slots.breakfast.kcal, 378.36) && d1.slots.breakfast.free_text === true && d1.free_text === true, JSON.stringify(d1));
r = await savePlan({ 1: { breakfast: [L(taco.id, 1)], lunch: [L(huevo.id, 1)] } }, { meals: { 1: { breakfast: '', lunch: '', dinner: 'Ensalada' } } });
d1 = r.json.plan_calc.days['1'];
check('P2 two meals of dishes: the day adds them (126.12 + 155 = 281.12); free text in ANOTHER shown meal (dinner) flags the day as partial', near(d1.total.kcal, 281.12) && d1.slots.breakfast.free_text === false && d1.free_text === true, JSON.stringify(d1));
r = await savePlan({}, { meals: { 1: { breakfast: 'Solo texto' } } });
check('P2 free text only, no plan: saves, no day totals', r.status === 200 && Object.keys(r.json.plan_calc.days).length === 0 && Object.keys(r.json.plan).length === 0, JSON.stringify(r.json?.plan_calc));
r = await savePlan(MON, { meals: { 1: { breakfast: '' } } });

// refusals
await createNutritionist(BASE, { name: 'Otra', email: 'otra-plan@test.local', password: 'OtraPlan12345' });
const O = (await api('/api/collections/nutritionists/auth-with-password', { method: 'POST', token: null, body: { identity: 'otra-plan@test.local', password: 'OtraPlan12345' } })).json;
const theirs = (await mkDish('Ajena plan', [line(ing[9104], 1, 'large')], O.token, O.record.id)).json;
const arch = (await mkDish('Archivada plan', [line(ing[9104], 1, 'large')])).json;
await api(`/api/collections/dishes/records/${arch.id}`, { method: 'PATCH', body: { archived_at: '2000-01-01 00:00:00.000Z' } });
const nine = Array.from({ length: 9 }, () => L(taco.id, 1));
const bad = {
  "another nutritionist's dish": savePlan({ 1: { breakfast: [L(theirs.id, 1)] } }),
  'unknown dish id': savePlan({ 1: { breakfast: [L('zzzzzzzzzzzzzzz', 1)] } }),
  'no dish id': savePlan({ 1: { breakfast: [{ servings: 1 }] } }),
  'servings 0': savePlan({ 1: { breakfast: [L(taco.id, 0)] } }),
  'servings 0.1': savePlan({ 1: { breakfast: [L(taco.id, 0.1)] } }),
  'servings 0.3': savePlan({ 1: { breakfast: [L(taco.id, 0.3)] } }),
  'servings 21': savePlan({ 1: { breakfast: [L(taco.id, 21)] } }),
  'servings text': savePlan({ 1: { breakfast: [L(taco.id, 'tres')] } }),
  '9 dishes in a meal': savePlan({ 1: { breakfast: nine } }),
  'day 8': savePlan({ 8: { breakfast: [L(taco.id, 1)] } }),
  'unknown meal': savePlan({ 1: { brunch: [L(taco.id, 1)] } }),
  'plan not an object': savePlan([L(taco.id, 1)]),
  'an archived dish added new': savePlan({ 1: { breakfast: [L(arch.id, 1)] } }),
};
const codes = {}; for (const [k, p] of Object.entries(bad)) codes[k] = (await p).status;
check('P3 each of these is refused with 400: ' + Object.keys(bad).join(', '), Object.values(codes).every((c) => c === 400), JSON.stringify(codes));
check('P3 the diet is unchanged after all the refusals (still 378.36)', near((await api(`/api/collections/diets/records/${diet.id}`)).json.plan_calc.days['1'].total.kcal, 378.36));
check('P3 quarter servings and 20 are accepted (0.25, 1.75, 20)', (await savePlan({ 1: { breakfast: [L(taco.id, 0.25)], lunch: [L(taco.id, 1.75)], dinner: [L(taco.id, 20)] } })).status === 200);
await savePlan(MON);

// forged numbers
r = await savePlan({ 1: { breakfast: [{ dish: taco.id, servings: 3, name: 'Fake', unit: 'x', kcal: 1 }] } }, { plan_calc: { days: { 1: { total: { kcal: 1 } } }, dishes: {} } });
check("P4 a forged name, unit, kcal on a line and a forged plan_calc are replaced by the server's", r.status === 200 && r.json.plan['1'].breakfast[0].name === 'Taco plan' && !('kcal' in r.json.plan['1'].breakfast[0]) && near(r.json.plan_calc.days['1'].total.kcal, 378.36), JSON.stringify(r.json));

// the dish changes later
await api(`/api/collections/dishes/records/${taco.id}`, { method: 'PATCH', body: { items: [line(ing[9101], 2, 'tortilla'), line(ing[9102], 50, 'g'), line(ing[9103], 10, 'g')] } });   // 178.44
r = await savePlan({ 1: { breakfast: [L(taco.id, 3)] }, 2: { breakfast: [L(taco.id, 1)] } }, { title: 'otro título' });
check('P5 the dish got bigger (178.44), but the saved diet keeps 126.12: Monday still 378.36, and a NEW Tuesday line uses the same old snapshot (126.12)',
  r.status === 200 && near(r.json.plan_calc.days['1'].total.kcal, 378.36) && near(r.json.plan_calc.days['2'].total.kcal, 126.12), JSON.stringify(r.json.plan_calc?.days));
r = await savePlan({ 1: { breakfast: [L(taco.id, 3)] }, 2: { breakfast: [L(taco.id, 1)] } }, { plan_refresh: [huevo.id] });
check('P5 refreshing a different dish leaves this one alone', near(r.json.plan_calc.days['1'].total.kcal, 378.36));
r = await savePlan({ 1: { breakfast: [L(taco.id, 3)] }, 2: { breakfast: [L(taco.id, 1)] } }, { plan_refresh: [taco.id] });
check('P5 "Actualizar" for that dish renews it everywhere: Monday 3 x 178.44 = 535.32, Tuesday 178.44', near(r.json.plan_calc.days['1'].total.kcal, 535.32) && near(r.json.plan_calc.days['2'].total.kcal, 178.44), JSON.stringify(r.json.plan_calc?.days));
await api(`/api/collections/dishes/records/${taco.id}`, { method: 'PATCH', body: { items: [line(ing[9101], 1, 'tortilla'), line(ing[9102], 50, 'g'), line(ing[9103], 10, 'g')] } });   // back to 126.12
r = await savePlan({ 1: { breakfast: [L(taco.id, 3)] }, 2: { breakfast: [L(taco.id, 1)] } }, { plan_refresh: 'all' });
check('P5 "all" renews every dish (back to 126.12: Monday 378.36)', near(r.json.plan_calc.days['1'].total.kcal, 378.36) && near(r.json.plan_calc.days['2'].total.kcal, 126.12));

// archived / deleted dishes already in a diet
await savePlan({ 1: { breakfast: [L(taco.id, 3)], lunch: [L(huevo.id, 2)] } });
await api(`/api/collections/dishes/records/${huevo.id}`, { method: 'PATCH', body: { archived_at: '2000-01-01 00:00:00.000Z' } });
r = await savePlan({ 1: { breakfast: [L(taco.id, 3)], lunch: [L(huevo.id, 2)] } }, { title: 'con archivada' });
check("P6 an archived dish already in the diet stays (2 x 155 = 310 kcal at lunch) and the diet still saves", r.status === 200 && near(r.json.plan_calc.days['1'].slots.lunch.kcal, 310), JSON.stringify(r.json?.plan_calc?.days));
await api(`/api/collections/dishes/records/${huevo.id}`, { method: 'DELETE' });
r = await savePlan({ 1: { breakfast: [L(taco.id, 3)], lunch: [L(huevo.id, 2)] } }, { title: 'con borrada' });
check('P6 a deleted dish: the snapshot stays (310 kcal) and the diet saves', r.status === 200 && near(r.json.plan_calc.days['1'].slots.lunch.kcal, 310) && r.json.plan_calc.dishes[huevo.id].name === 'Huevo plan', JSON.stringify(r.json?.plan_calc?.dishes));
await savePlan({ 1: { breakfast: [L(taco.id, 3)] } });

// snacks hide meals
r = await savePlan({ 1: { breakfast: [L(taco.id, 1)], snack_early: [L(taco.id, 1)] } }, { snacks: 2 });
check('P7 a meal that is not shown (snack_early with 2 colaciones) is kept in the plan but not counted: day = 126.12', near(r.json.plan_calc.days['1'].total.kcal, 126.12) && !r.json.plan_calc.days['1'].slots.snack_early && !!r.json.plan['1'].snack_early, JSON.stringify(r.json.plan_calc?.days));
r = await savePlan({ 1: { breakfast: [L(taco.id, 1)], snack_early: [L(taco.id, 1)] } }, { snacks: 4 });
check('P7 with 4 colaciones the same meal counts: day = 252.24', near(r.json.plan_calc.days['1'].total.kcal, 252.24), JSON.stringify(r.json.plan_calc?.days));
await savePlan(MON, { snacks: 2 });

// patient view
let pv = await api(`/api/collections/diets/records/${diet.id}`, { token: A });
check('N1 switch OFF (default): the patient gets the dish names and servings, but the raw response has no plan_calc and none of its numbers', pv.status === 200 && pv.json.plan['1'].breakfast[0].name === 'Taco plan' && !('plan_calc' in pv.json) && !pv.raw.includes('plan_calc') && !pv.raw.includes('378.36') && !pv.raw.includes('126.12'), pv.raw.slice(0, 400));
const pl = await api('/api/collections/diets/records', { token: A });
check('N1 the same on the LIST route', pl.status === 200 && !pl.raw.includes('plan_calc') && pl.json.items.length === 1);
check('N1 show_numbers is false by default', (await api(`/api/collections/patients/records/${anaId}`)).json.show_numbers === false);
const self = await api(`/api/collections/patients/records/${anaId}`, { method: 'PATCH', token: A, body: { show_numbers: true } });
check('N1 the patient cannot switch it on themselves', [400, 403, 404].includes(self.status) && (await api(`/api/collections/patients/records/${anaId}`)).json.show_numbers === false, self.status);
const forgedDiet = await api(`/api/collections/diets/records/${diet.id}`, { method: 'PATCH', token: A, body: { plan: { 1: { breakfast: [L(taco.id, 1)] } } } });
check('N1 the patient cannot change the diet or its plan', [400, 403, 404].includes(forgedDiet.status), forgedDiet.status);
const on = await api(`/api/collections/patients/records/${anaId}`, { method: 'PATCH', body: { show_numbers: true } });
pv = await api(`/api/collections/diets/records/${diet.id}`, { token: A });
check('N2 switch ON (by the nutritionist): the patient now gets plan_calc (378.36 kcal on Monday)', on.status === 200 && pv.status === 200 && near(pv.json.plan_calc.days['1'].total.kcal, 378.36), pv.raw.slice(0, 300));
check('N2 a nutritionist always sees plan_calc', near((await api(`/api/collections/diets/records/${diet.id}`)).json.plan_calc.days['1'].total.kcal, 378.36));
await api(`/api/collections/patients/records/${anaId}`, { method: 'PATCH', body: { show_numbers: false } });

// templates and a new diet
const tpl = await api('/api/collections/diet_templates/records', { method: 'POST', body: { nutritionist: NID, title: 'Plantilla con recetas', snacks: 0, meals: {}, plan: { 1: { breakfast: [L(taco.id, 2)], snack_am: [L(taco.id, 1)] } } } });
check('T1 a template keeps a plan too: breakfast 2 x 126.12 = 252.24; snack_am is hidden with 0 colaciones, so not counted', tpl.status === 200 && near(tpl.json.plan_calc.days['1'].total.kcal, 252.24) && !!tpl.json.plan['1'].snack_am, JSON.stringify(tpl.json));
const tpl2 = await api('/api/collections/diet_templates/records', { method: 'POST', token: O.token, body: { nutritionist: O.record.id, title: 'Robo', snacks: 0, meals: {}, plan: { 1: { breakfast: [L(taco.id, 1)] } } } });
check("T1 another nutritionist cannot put my dish into their template", tpl2.status === 400, tpl2.status);
const carlosDiet = (await api(`/api/collections/diets/records?filter=${encodeURIComponent(`patient = '${carlosId}'`)}`)).json.items[0];
if (carlosDiet) await api(`/api/collections/diets/records/${carlosDiet.id}`, { method: 'DELETE', token: SU });
const fresh = await api('/api/collections/diets/records', { method: 'POST', body: { patient: carlosId, title: 'Nueva con plan', meals: {}, plan: tpl.json.plan } });
check('T1 a NEW diet with a plan (a template applied) gets its own snapshot and totals; it defaults to 2 colaciones, so snack_am counts now: 252.24 + 126.12 = 378.36', fresh.status === 200 && near(fresh.json.plan_calc.days['1'].total.kcal, 378.36) && fresh.json.snacks === 2, JSON.stringify(fresh.json?.plan_calc));
check('T1 a diet saved without any plan reads fine: empty plan, no error', (await api(`/api/collections/diets/records/${diet.id}`)).status === 200);

const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
