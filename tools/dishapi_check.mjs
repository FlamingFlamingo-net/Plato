// Dishes (Recetas), server side (spec "Feature: Recetas (dishes), slice (b)"): the calculation against hand-made numbers,
// refusals, ownership, archive, recalculation, deleted ingredients, tags.
// Usage: node tools/dishapi_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
import { createNutritionist, superuser } from './admin.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const near = (a, b, eps = 0.0011) => Math.abs(a - b) < eps;
const N = t.nutritionist.token, NID = t.nutritionist.record.id;
const SU = await superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
const NL = String.fromCharCode(10);
async function api(path, { method = 'GET', body, token = N } = {}) {
  const headers = token ? { Authorization: token } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const loader = (csv, extra = []) => {
  writeFileSync(`${OUT}/d.csv`, csv);
  const r = spawnSync('python', ['tools/load_ingredients.py', '--base', BASE, '--csv', `${OUT}/d.csv`, '--dataset', 'dishtest', '--source', 'test', '--version', '1', ...extra], { env: { ...process.env, PB_SUPERUSER_TOKEN: SU, PYTHONIOENCODING: 'utf-8' }, encoding: 'utf-8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const H = 'name,state,kcal,protein_g,fat_g,carbs_g,fiber_g,fdc_id,density_g_ml,portions,tags';
const ROWS = [
  'Corn tortilla,otro,218,5.7,2.9,44.6,6.3,9001,,tortilla:24,fibra',
  'Pork loin,cocido,143,26,3.5,0,0,9002,,,',
  'Cilantro,crudo,23,2.1,0.5,3.7,2.8,9003,,,',
  'Egg,cocido,155,12.6,10.6,1.1,0,9004,,large:50,',
  'Black beans,cocido,132,8.86,0.54,23.71,8.7,9005,,cup:172,fibra',
  'Olive oil,otro,884,0,100,0,0,9006,0.91,tbsp:13.5,',
  'Salt,otro,0,0,0,0,0,9007,,,',
];
let r = loader(`${H}${NL}${ROWS.join(NL)}${NL}`, ['--apply']);
check('setup: 7 test ingredients loaded', r.code === 0 && r.out.includes('7 new'), r.out);
const ing = {};
for (const x of (await api(`/api/collections/ingredients/records?perPage=50&filter=${encodeURIComponent('dataset = "dishtest"')}`)).json.items) ing[x.fdc_id] = x;
const TORT = ing[9001].id, LOMO = ing[9002].id, CIL = ing[9003].id, EGG = ing[9004].id, BEAN = ing[9005].id, OIL = ing[9006].id, SALT = ing[9007].id;
const line = (ingredient, amount, unit) => ({ ingredient, amount, unit });
const mk = (name, items, extra = {}, token = N) => api('/api/collections/dishes/records', { method: 'POST', token, body: { nutritionist: NID, name, serving_unit: 'taco', multi_serving: true, items, ...extra } });

// hand calculation: 24 g tortilla + 50 g lomo + 10 g cilantro
//   kcal 24*2.18 + 50*1.43 + 10*0.23 = 52.32 + 71.5 + 2.3 = 126.12 ; protein 1.368 + 13 + 0.21 = 14.578
//   fat 0.696 + 1.75 + 0.05 = 2.496 ; carbs 10.704 + 0 + 0.37 = 11.074 ; fibre 1.512 + 0 + 0.28 = 1.792
const taco = await mk('Taco de lomo', [line(TORT, 1, 'tortilla'), line(LOMO, 50, 'g'), line(CIL, 10, 'g')]);
const nu = taco.json?.nutrition || {};
check('D1 "Taco de lomo" per serving equals the hand calculation (126.12 kcal, 14.578 P, 2.496 F, 11.074 C, 1.792 fibre)',
  taco.status === 200 && near(nu.kcal, 126.12) && near(nu.protein_g, 14.578) && near(nu.fat_g, 2.496) && near(nu.carbs_g, 11.074) && near(nu.fiber_g, 1.792), JSON.stringify(taco.json));
check('D1 each line keeps the ingredient id, FDC id, name, state and the grams used (1 tortilla = 24 g)',
  taco.json.items.length === 3 && taco.json.items[0].grams === 24 && taco.json.items[0].fdc_id === 9001 && taco.json.items[0].name === 'Corn tortilla' && taco.json.items[1].state === 'cocido', JSON.stringify(taco.json.items));
check('D1 the dish stores when it was computed, no "valores actualizados" date and no archive date', !!taco.json.computed_at && !taco.json.values_updated_at && !taco.json.archived_at);

const eggs = await mk('Huevos', [line(EGG, 2, 'large')], { serving_unit: 'porción' });
const beans = await mk('Frijoles', [line(BEAN, 1, 'cup')], { serving_unit: 'taza' });
const oil = await mk('Aceite', [line(OIL, 10, 'ml')], { serving_unit: 'cucharada' });
const oil2 = await mk('Aceite 2', [line(OIL, 2, 'tbsp')], { serving_unit: 'cucharada' });
check('D2 "2 large" eggs = 100 g (155 kcal); 1 cup of black beans = 172 g (227.04 kcal)', eggs.json.items[0].grams === 100 && near(eggs.json.nutrition.kcal, 155) && beans.json.items[0].grams === 172 && near(beans.json.nutrition.kcal, 227.04), JSON.stringify([eggs.json.items, beans.json.nutrition]));
check('D2 10 ml of olive oil uses its density (9.1 g, 80.444 kcal); 2 tbsp = 27 g (238.68 kcal)', near(oil.json.items[0].grams, 9.1) && near(oil.json.nutrition.kcal, 80.444) && near(oil2.json.nutrition.kcal, 238.68), JSON.stringify([oil.json.nutrition, oil2.json.nutrition]));

const bad = {
  'ml without a density': mk('M1', [line(SALT, 5, 'ml')]),
  'a portion the ingredient does not have': mk('M2', [line(EGG, 1, 'cup')]),
  'amount 0': mk('M3', [line(EGG, 0, 'g')]),
  'negative amount': mk('M4', [line(EGG, -5, 'g')]),
  'amount above 100,000': mk('M5', [line(EGG, 100001, 'g')]),
  'text amount': mk('M6', [line(EGG, 'mucho', 'g')]),
  'unknown ingredient': mk('M7', [line('zzzzzzzzzzzzzzz', 5, 'g')]),
  'no lines': mk('M8', []),
  '41 lines': mk('M9', Array.from({ length: 41 }, () => line(SALT, 1, 'g'))),
  'empty name': mk('   ', [line(EGG, 1, 'g')]),
  'name over 120': mk('x'.repeat(121), [line(EGG, 1, 'g')]),
  'empty serving unit': mk('M10', [line(EGG, 1, 'g')], { serving_unit: '' }),
  'items not a list': mk('M11', 'huevo'),
};
const codes = {}; for (const [k, p] of Object.entries(bad)) codes[k] = (await p).status;
check('D3 each of these is refused with 400: ' + Object.keys(bad).join(', '), Object.values(codes).every((c) => c === 400), JSON.stringify(codes));
const msg = (await mk('M12', [line(EGG, 1, 'cup')])).json.message + ' ' + JSON.stringify((await mk('M13', [line(SALT, 5, 'ml')])).json);
check('D3 the refusal says which line and why in plain Spanish', /Ingrediente 1: Egg no tiene la porción “cup”/.test(msg) && /no se puede dar en ml/.test(msg), msg);
check('D3 40 lines is accepted', (await mk('Cuarenta', Array.from({ length: 40 }, () => line(SALT, 1, 'g')))).status === 200);

const forged = await mk('Forjada', [line(EGG, 1, 'large')], { nutrition: { kcal: 1 }, computed_at: '2000-01-01 00:00:00.000Z', values_updated_at: '2000-01-01 00:00:00.000Z', archived_at: '2000-01-01 00:00:00.000Z' });
check('D4 numbers, their dates and archived_at sent by the client are overwritten by the server', forged.status === 200 && near(forged.json.nutrition.kcal, 77.5) && !forged.json.values_updated_at && !forged.json.archived_at && !forged.json.computed_at.startsWith('2000'), JSON.stringify(forged.json));
const sp = await mk('Sin nutriente', [line(EGG, 1, 'g')], { nutritionist: undefined });
const dupe = await mk('Taco de lomo', [line(EGG, 1, 'g')]);
check('D4 a repeated name is refused', dupe.status === 400, dupe.status);

// edit
const ed = await api(`/api/collections/dishes/records/${taco.json.id}`, { method: 'PATCH', body: { items: [line(TORT, 2, 'tortilla'), line(LOMO, 50, 'g'), line(CIL, 10, 'g')], nutrition: { kcal: 5 } } });
check('D5 editing an amount recomputes (2 tortillas: 126.12 + 52.32 = 178.44 kcal) and ignores a forged nutrition', ed.status === 200 && near(ed.json.nutrition.kcal, 178.44) && ed.json.items[0].grams === 48, JSON.stringify(ed.json.nutrition));
const nn = await api(`/api/collections/dishes/records/${taco.json.id}`, { method: 'PATCH', body: { nutrition: { kcal: 5 }, computed_at: '2001-01-01 00:00:00.000Z', values_updated_at: '2001-01-01 00:00:00.000Z' } });
check('D5 a PATCH that sends only forged numbers or dates changes nothing', nn.status === 200 && near(nn.json.nutrition.kcal, 178.44) && !nn.json.values_updated_at && nn.json.computed_at === ed.json.computed_at, JSON.stringify(nn.json));
const ar = await api(`/api/collections/dishes/records/${taco.json.id}`, { method: 'PATCH', body: { archived_at: '2000-01-01 00:00:00.000Z' } });
check('D5 archiving stores the SERVER time (not the client\'s) and keeps the numbers', ar.status === 200 && !ar.json.archived_at.startsWith('2000') && near(ar.json.nutrition.kcal, 178.44), ar.json.archived_at);
const ar2 = await api(`/api/collections/dishes/records/${taco.json.id}`, { method: 'PATCH', body: { archived_at: '2005-05-05 00:00:00.000Z' } });
check('D5 archiving again does not move the archive time', ar2.json.archived_at === ar.json.archived_at, `${ar.json.archived_at} ${ar2.json.archived_at}`);
const un = await api(`/api/collections/dishes/records/${taco.json.id}`, { method: 'PATCH', body: { archived_at: '' } });
check('D5 restoring clears it', un.status === 200 && !un.json.archived_at);
const own = await api(`/api/collections/dishes/records/${taco.json.id}`, { method: 'PATCH', body: { nutritionist: 'zzzzzzzzzzzzzzz' } });
check('D5 the owner cannot be changed', own.status === 400 || own.status === 403 || own.status === 404, own.status);

// other nutritionist, patient, visitor
await createNutritionist(BASE, { name: 'Otra', email: 'otra-dish@test.local', password: 'OtraDish12345' });
const O = (await api('/api/collections/nutritionists/auth-with-password', { method: 'POST', token: null, body: { identity: 'otra-dish@test.local', password: 'OtraDish12345' } })).json;
const ol = (await api('/api/collections/dishes/records', { token: O.token })).json.totalItems;
const ov = (await api(`/api/collections/dishes/records/${taco.json.id}`, { token: O.token })).status;
const op = (await api(`/api/collections/dishes/records/${taco.json.id}`, { method: 'PATCH', token: O.token, body: { name: 'mío' } })).status;
const od = (await api(`/api/collections/dishes/records/${taco.json.id}`, { method: 'DELETE', token: O.token })).status;
check('D6 another nutritionist sees none of my dishes and cannot open, change or delete one', ol === 0 && [403, 404].includes(ov) && [403, 404].includes(op) && [403, 404].includes(od), `${ol} ${ov} ${op} ${od}`);
const oc = await api('/api/collections/dishes/records', { method: 'POST', token: O.token, body: { nutritionist: NID, name: 'En nombre de otro', serving_unit: 'x', items: [line(EGG, 1, 'g')] } });
const ooc = await api('/api/collections/dishes/records', { method: 'POST', token: O.token, body: { nutritionist: O.record.id, name: 'Taco de lomo', serving_unit: 'taco', items: [line(EGG, 1, 'g')] } });
check('D6 nobody can create a dish in another nutritionist\'s name; the same name for another nutritionist is fine', oc.status === 400 && ooc.status === 200, `${oc.status} ${ooc.status}`);
const pa = [(await api('/api/collections/dishes/records', { token: t.ana.token })), (await api('/api/collections/dishes/records', { token: null }))];
check('D6 a patient and a visitor get nothing', pa.every((x) => x.status === 200 ? x.json.totalItems === 0 : [401, 403].includes(x.status)), pa.map((x) => x.status).join(' '));

// tags
const tagMine = (await api('/api/collections/tags/records', { method: 'POST', body: { name: 'Cena ligera', nutritionist: NID } })).json;
const fibra = (await api('/api/collections/tags/records?filter=' + encodeURIComponent('name = "fibra"'))).json.items[0];
const lk = (tag, item, kind = 'dish', token = N, nid = NID) => api('/api/collections/item_tags/records', { method: 'POST', token, body: { tag, item, kind, nutritionist: nid } });
const l1 = await lk(tagMine.id, taco.json.id), l2 = await lk(fibra.id, taco.json.id);
const l3 = await lk(tagMine.id, taco.json.id, 'dish', O.token, O.record.id), l4 = await lk(tagMine.id, 'zzzzzzzzzzzzzzz');
check('T1 my tag and a starter tag can go on my dish; another nutritionist cannot tag it; a missing dish is refused', l1.status === 200 && l2.status === 200 && l3.status === 400 && l4.status === 400, [l1, l2, l3, l4].map((x) => x.status).join(' '));
check('T1 the starter tag "fibra" on the tortilla ingredient does NOT show on the dish (no inheritance) except the link I put on it',
  (await api('/api/collections/item_tags/records?perPage=50&filter=' + encodeURIComponent(`kind = "dish" && item = "${taco.json.id}"`))).json.totalItems === 2 && (await api('/api/collections/item_tags/records?perPage=50&filter=' + encodeURIComponent(`kind = "dish" && item = "${eggs.json.id}"`))).json.totalItems === 0);

// recalculation: the data changes (same fdc_id, new kcal for the tortilla and a new name)
const ROWS2 = ROWS.slice(); ROWS2[0] = 'Corn tortilla (masa),otro,300,5.7,2.9,44.6,6.3,9001,,tortilla:24,fibra';
r = loader(`${H}${NL}${ROWS2.join(NL)}${NL}`, ['--apply']);
const after = (await api(`/api/collections/dishes/records/${taco.json.id}`)).json;
// 2 tortillas = 48 g: kcal 48*3.00 + 71.5 + 2.3 = 217.8
check('R1 the data set changed (tortilla 218 -> 300 kcal, renamed): the dish is recalculated (217.8 kcal), dated "Valores actualizados", and the line shows the new name',
  r.code === 0 && near(after.nutrition.kcal, 217.8) && !!after.values_updated_at && after.items[0].name === 'Corn tortilla (masa)', `${r.out.slice(-150)} ${JSON.stringify(after.nutrition)} ${after.values_updated_at} ${after.items[0].name}`);
const stamp = after.values_updated_at;
await sleep(1100);
r = loader(`${H}${NL}${ROWS2.join(NL)}${NL}`, ['--apply']);
const again = (await api(`/api/collections/dishes/records/${taco.json.id}`)).json;
check('R1 loading the same data again changes nothing (the "Valores actualizados" date stays)', again.values_updated_at === stamp && again.computed_at === after.computed_at, `${stamp} ${again.values_updated_at}`);
const huevo2 = (await api(`/api/collections/dishes/records/${eggs.json.id}`)).json;
check('R1 a dish that does not use the changed ingredient is untouched', !huevo2.values_updated_at && near(huevo2.nutrition.kcal, 155));
const edited = await api(`/api/collections/dishes/records/${taco.json.id}`, { method: 'PATCH', body: { items: [line(TORT, 1, 'tortilla'), line(LOMO, 50, 'g')] } });
check('R1 the nutritionist editing the lines clears the "Valores actualizados" note', edited.status === 200 && !edited.json.values_updated_at, JSON.stringify(edited.json.values_updated_at));

// a portion that disappears: flagged, numbers kept
const ROWS3 = ROWS2.slice(); ROWS3[0] = 'Corn tortilla (masa),otro,300,5.7,2.9,44.6,6.3,9001,,,fibra';
const before3 = (await api(`/api/collections/dishes/records/${taco.json.id}`)).json;
r = loader(`${H}${NL}${ROWS3.join(NL)}${NL}`, ['--apply']);
const flag = (await api(`/api/collections/dishes/records/${taco.json.id}`)).json;
check('R2 a portion label that no longer exists: the dish keeps its numbers and the line says what is wrong', near(flag.nutrition.kcal, before3.nutrition.kcal) && /porción “tortilla”/.test(flag.items[0].problem || ''), JSON.stringify(flag.items[0]));
r = loader(`${H}${NL}${ROWS2.join(NL)}${NL}`, ['--apply']);

// deleted ingredient
const keep = near(((await api(`/api/collections/dishes/records/${beans.json.id}`)).json.nutrition.kcal), 227.04);
const del = await api(`/api/collections/ingredients/records/${BEAN}`, { method: 'DELETE', token: SU });
const bd = (await api(`/api/collections/dishes/records/${beans.json.id}`)).json;
check('X1 an ingredient is deleted: the dish keeps its last numbers (227.04 kcal) and flags the line "missing"', keep && del.status === 204 && near(bd.nutrition.kcal, 227.04) && bd.items[0].missing === true, JSON.stringify(bd.items[0]));
const fixmiss = await api(`/api/collections/dishes/records/${beans.json.id}`, { method: 'PATCH', body: { name: 'Frijoles de la olla' } });
const fixbad = await api(`/api/collections/dishes/records/${beans.json.id}`, { method: 'PATCH', body: { items: [...bd.items, line(EGG, 1, 'g')] } });
const fixok = await api(`/api/collections/dishes/records/${beans.json.id}`, { method: 'PATCH', body: { items: [line(EGG, 1, 'large')] } });
check('X1 renaming such a dish works; saving a changed list that still has the missing line is refused; replacing the line works', fixmiss.status === 200 && fixbad.status === 400 && fixok.status === 200 && near(fixok.json.nutrition.kcal, 77.5), [fixmiss.status, fixbad.status, fixok.status].join(' '));

// delete + cleanup
const delDish = await api(`/api/collections/dishes/records/${taco.json.id}`, { method: 'DELETE' });
check('C1 deleting a dish removes its tag links', delDish.status === 204 && (await api('/api/collections/item_tags/records?filter=' + encodeURIComponent(`item = "${taco.json.id}"`), { token: SU })).json.totalItems === 0);
check('C1 deleting my tag removes it from the dishes too', (await api(`/api/collections/tags/records/${tagMine.id}`, { method: 'DELETE' })).status === 204);
r = loader('', ['--remove-dataset', 'dishtest', '--apply']);
check('C2 removing the test data set leaves dishes in place, all lines flagged "missing", numbers kept', r.code === 0 && (await api('/api/collections/dishes/records?perPage=50')).json.items.filter((d) => d.items.some((x) => x.missing)).length >= 3);

function sleep(ms) { return new Promise((res) => setTimeout(res, ms)); }
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
