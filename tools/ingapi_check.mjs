// Ingredients + tags, server side (spec "Feature: Ingredients, slice (a)"): loader, rules, tags, links, cleanup.
// Usage: node tools/ingapi_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
import { createNutritionist, superuser } from './admin.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const N = t.nutritionist.token, NID = t.nutritionist.record.id;
const SU = await superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
async function api(path, { method = 'GET', body, token = N } = {}) {
  const headers = token ? { Authorization: token } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const loader = (args, csv) => {
  const r = spawnSync('python', ['tools/load_ingredients.py', '--base', BASE, ...args], { env: { ...process.env, PB_SUPERUSER_TOKEN: SU, PYTHONIOENCODING: 'utf-8' }, encoding: 'utf-8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const count = async (coll, filter = '') => (await api(`/api/collections/${coll}/records?perPage=1${filter ? `&filter=${encodeURIComponent(filter)}` : ''}`, { token: SU })).json.totalItems;
const EX = 'data/ingredients-ejemplo.csv';

// ---------- Loader ----------
let r = loader(['--csv', EX]);
check('L1 dry run on the example CSV prints a summary and saves nothing', r.code === 0 && /^6\d ingredients, \d+ platform tags/m.test(r.out) && r.out.includes('DRY RUN') && (await count('ingredients')) === 0, r.out.slice(0, 300));
const nWant = Number(r.out.match(/^(\d+) ingredients/m)[1]);
r = loader(['--csv', EX, '--apply']);
const nIng = await count('ingredients'), nTag = await count('tags', 'nutritionist = ""'), nLink = await count('item_tags', 'nutritionist = ""');
check(`L1 --apply loads the set (${nWant} ingredients, platform tags, links)`, r.code === 0 && nIng === nWant && nTag >= 5 && nLink > nWant, `${r.out.slice(-200)} ${nIng} ${nTag} ${nLink}`);
r = loader(['--csv', EX, '--apply']);
check('L1 loading it a second time replaces instead of duplicating', r.code === 0 && (await count('ingredients')) === nIng && (await count('item_tags', 'nutritionist = ""')) === nLink && r.out.includes('0 new'), r.out.slice(-200));
const sample = (await api(`/api/collections/ingredients/records?filter=${encodeURIComponent('name = "Frijol negro"')}`, { token: SU })).json.items[0];
check('L1 an ingredient has per-100 g numbers, extra nutrients, several groups, source and version',
  sample && sample.kcal === 132 && sample.extra?.sodio_mg === 1 && sample.groups?.length === 2 && sample.source.startsWith('EJEMPLO') && sample.version === '0' && sample.dataset === 'ejemplo', JSON.stringify(sample));

const bad = `${OUT}/bad.csv`;
writeFileSync(bad, 'name,state,kcal,protein_g,fat_g,carbs_g,fiber_g,piece_g,density_g_ml,extra:sodio_mg,groups,tags\nPan,otro,250,9,3,49,2,,,,Cereales:30,\nPan,otro,250,9,3,49,2,,,,,\n,otro,1,1,1,1,1,,,,,\nLeche,otro,abc,3,3,5,0,,,,,\nQueso,otro,100,5,5,5,0,,,,Lácteos,\nAgua,frio,0,0,0,0,0,,,,,\n');
r = loader(['--csv', bad, '--dataset', 'prueba', '--apply']);
check('L2 a broken file is refused with line numbers and nothing is loaded',
  r.code === 1 && /Line 3: 'Pan' \(otro\) is repeated/.test(r.out) && /Line 4: name is empty/.test(r.out) && /Line 5: 'kcal' is not a number/.test(r.out) && /Line 6: groups must look like/.test(r.out) && /Line 7: state must be/.test(r.out) && (await count('ingredients', 'dataset = "prueba"')) === 0, r.out);

// ---------- Rules ----------
const list = await api('/api/collections/ingredients/records?perPage=100&sort=name');
check('R1 a nutritionist reads the ingredients and can search', list.status === 200 && list.json.totalItems === nIng && (await api(`/api/collections/ingredients/records?filter=${encodeURIComponent('name ~ "arroz"')}`)).json.totalItems === 2);
const first = list.json.items[0];
const w = [await api('/api/collections/ingredients/records', { method: 'POST', body: { name: 'Mío', state: 'crudo', kcal: 1, protein_g: 0, fat_g: 0, carbs_g: 0, fiber_g: 0, dataset: 'x' } }),
  await api(`/api/collections/ingredients/records/${first.id}`, { method: 'PATCH', body: { kcal: 1 } }), await api(`/api/collections/ingredients/records/${first.id}`, { method: 'DELETE' })];
check('R1 …but cannot create, change or delete one', w.every((x) => x.status === 403 || x.status === 404 || x.status === 400), w.map((x) => x.status).join(' '));
const nothing = [];
for (const c of ['ingredients', 'tags', 'item_tags']) for (const tok of [t.ana.token, null]) { const x = await api(`/api/collections/${c}/records`, { token: tok }); nothing.push(x.status === 200 ? x.json.totalItems : x.status); }
check('R2 a patient and a visitor get nothing from ingredients, tags and links (refused or empty)', nothing.every((v) => v === 0 || v === 403 || v === 401), nothing.join(' '));

// ---------- Tags ----------
const mk = async (name, token = N, nid = NID, extra = {}) => api('/api/collections/tags/records', { method: 'POST', token, body: { name, nutritionist: nid, ...extra } });
const platform = (await api('/api/collections/tags/records?perPage=50')).json.items;
const fibra = platform.find((x) => x.name === 'fibra');
check('T1 starter tags are visible to a nutritionist (fibra, alta en proteína, …)', platform.length >= 5 && fibra && ['alta en proteína', 'bajo en sodio', 'económico', 'sin gluten', 'sin lactosa'].every((n) => platform.some((x) => x.name === n)), platform.map((x) => x.name).join());
const post = await mk('  Post-entreno ');
check('T2 a nutritionist creates their own tag (trimmed)', post.status === 200 && post.json.name === 'Post-entreno' && post.json.nutritionist === NID && !post.json.dataset, JSON.stringify(post));
const dups = [await mk('post-ENTRENO'), await mk('FÍBRA'), await mk('x'.repeat(31)), await mk('   ')];
check('T2 duplicates (capitals/accents), a starter name, 31 characters and an empty name are refused', dups.every((x) => x.status === 400), dups.map((x) => `${x.status}:${x.json?.message}`).join(' | '));
check('T2 a nutritionist cannot make a platform tag (dataset) or a tag for someone else', (await mk('Con dataset', N, NID, { dataset: 'ejemplo' })).status === 400);

const arroz = list.json.items.find((x) => x.name === 'Arroz blanco' && x.state === 'cocido') || (await api(`/api/collections/ingredients/records?filter=${encodeURIComponent('name = "Arroz blanco"')}`)).json.items[0];
const huevo = (await api(`/api/collections/ingredients/records?filter=${encodeURIComponent('name = "Huevo entero"')}`)).json.items[0];
const link = (tag, item, kind = 'ingredient', token = N, nid = NID) => api('/api/collections/item_tags/records', { method: 'POST', token, body: { tag, item, kind, nutritionist: nid } });
const l1 = await link(post.json.id, arroz.id), l2 = await link(post.json.id, huevo.id), l3 = await link(fibra.id, arroz.id);
check('T3 my tag and a starter tag can be put on ingredients', [l1, l2, l3].every((x) => x.status === 200), [l1, l2, l3].map((x) => x.status).join(' '));
check('T3 the same link twice is refused', (await link(post.json.id, arroz.id)).status === 400);
const bad2 = [await link(post.json.id, 'zzzzzzzzzzzzzzz'), await link(post.json.id, arroz.id, 'template'), await link('zzzzzzzzzzzzzzz', arroz.id)];
check('T3 a link to an item or tag that does not exist is refused', bad2.every((x) => x.status === 400), bad2.map((x) => x.status).join(' '));
const byTag = (await api(`/api/collections/item_tags/records?perPage=200&filter=${encodeURIComponent(`tag = "${post.json.id}"`)}`)).json;
check('T3 filtering links by my tag finds the 2 ingredients', byTag.totalItems === 2);

// templates
const tpl = (title) => api('/api/collections/diet_templates/records', { method: 'POST', body: { nutritionist: NID, title, meals: {} } });
const tp = (await tpl('Plantilla A')).json;
check('T4 a tag can go on my own template, and it is just a link (the template has no tag data)', (await link(post.json.id, tp.id, 'template')).status === 200 && !('tags' in tp));
check('T4 the ingredient tag "fibra" on Arroz changed nothing on the template (no inheritance)', (await api(`/api/collections/item_tags/records?filter=${encodeURIComponent(`kind = "template" && item = "${tp.id}"`)}`)).json.totalItems === 1);

// the other nutritionist
await createNutritionist(BASE, { name: 'Otra', email: 'otra-tags@test.local', password: 'OtraTags12345' });
const O = (await api('/api/collections/nutritionists/auth-with-password', { method: 'POST', token: null, body: { identity: 'otra-tags@test.local', password: 'OtraTags12345' } })).json;
const otags = (await api('/api/collections/tags/records?perPage=100', { token: O.token })).json.items;
const olinks = (await api('/api/collections/item_tags/records?perPage=500', { token: O.token })).json;
check('T5 another nutritionist sees the starter tags and their links, but not my tag or my links',
  otags.some((x) => x.name === 'fibra') && !otags.some((x) => x.name === 'Post-entreno') && olinks.items.every((l) => !l.nutritionist) && olinks.items.length > 0, otags.map((x) => x.name).join());
const x1 = await link(post.json.id, arroz.id, 'ingredient', O.token, O.record.id), x2 = await link(fibra.id, tp.id, 'template', O.token, O.record.id), x3 = await link(fibra.id, arroz.id, 'ingredient', O.token, NID);
const x4 = await api(`/api/collections/tags/records/${post.json.id}`, { method: 'DELETE', token: O.token });
check('T5 they cannot use my tag, tag my template, link as me, or delete my tag', [x1, x2, x3].every((x) => x.status === 400 || x.status === 403) && [403, 404].includes(x4.status), [x1, x2, x3, x4].map((x) => x.status).join(' '));
const pl = (await api('/api/collections/item_tags/records?filter=' + encodeURIComponent('nutritionist = ""&&kind="ingredient"'))).json.items[0];
const y = [await api(`/api/collections/tags/records/${fibra.id}`, { method: 'DELETE' }), await api(`/api/collections/item_tags/records/${pl.id}`, { method: 'DELETE' }), await api(`/api/collections/tags/records/${fibra.id}`, { method: 'PATCH', body: { name: 'otra' } })];
check('T6 starter tags and starter links cannot be deleted or renamed by a nutritionist', y.every((x) => [403, 404].includes(x.status)), y.map((x) => x.status).join(' '));

// updating the dataset keeps my links (same name + state = same row)
const csv2 = readFileSync(EX, 'utf8').replace('Arroz blanco,cocido,130,', 'Arroz blanco,cocido,131,');
writeFileSync(`${OUT}/ex2.csv`, csv2);
r = loader(['--csv', `${OUT}/ex2.csv`, '--apply']);
const after = (await api(`/api/collections/ingredients/records/${arroz.id}`)).json;
check('L3 loading an updated file changes the numbers but keeps the row and my tag links', r.code === 0 && after.kcal === 131 && (await api(`/api/collections/item_tags/records?filter=${encodeURIComponent(`tag = "${post.json.id}" && item = "${arroz.id}"`)}`)).json.totalItems === 1, r.out.slice(-200));

// ---------- USDA fields: fdc_id and portions ----------
const H = 'name,state,kcal,protein_g,fat_g,carbs_g,fiber_g,fdc_id,portions,tags';
const NL = String.fromCharCode(10);
const usda = (rows) => `${H}${NL}${rows.join(NL)}${NL}`;
const U = (csv, extra = []) => { writeFileSync(`${OUT}/usda.csv`, csv); return loader(['--csv', `${OUT}/usda.csv`, '--dataset', 'usdatest', '--source', 'USDA FoodData Central, SR Legacy', '--version', '2018', ...extra]); };
r = U(usda(['"Egg, whole, cooked",cocido,155,12.6,10.6,1.1,0,748967,large:50,alta en proteína', 'Bananas raw,crudo,89,1.1,0.3,22.8,2.6,173944,"NLEA serving:126;cup, sliced:150",']), ['--apply']);
const egg = (await api(`/api/collections/ingredients/records?filter=${encodeURIComponent('dataset = "usdatest" && fdc_id = 748967')}`, { token: SU })).json.items[0];
check('U1 a USDA row keeps its fdc_id, a list of household portions, the source and the version',
  r.code === 0 && egg && egg.fdc_id === 748967 && egg.portions.length === 1 && egg.portions[0].label === 'large' && egg.source.startsWith('USDA') && egg.version === '2018', `${r.out.slice(-200)} ${JSON.stringify(egg)}`);
const banana = (await api(`/api/collections/ingredients/records?filter=${encodeURIComponent('dataset = "usdatest" && fdc_id = 173944')}`, { token: SU })).json.items[0];
check('U1 portions with a space or comma in the label are kept (cup, sliced = 150 g)', banana && banana.portions.length === 2 && banana.portions[1].label === 'cup, sliced' && banana.portions[1].grams === 150, JSON.stringify(banana?.portions));
const ids0 = egg.id;
await link(post.json.id, ids0);
r = U(usda(['"Egg, whole, cooked (hard-boiled)",cocido,155,12.6,10.6,1.1,0,748967,large:50;tbsp:8.5,alta en proteína', 'Bananas raw,crudo,89,1.1,0.3,22.8,2.6,173944,"NLEA serving:126;cup, sliced:150",']), ['--apply']);
const egg2 = (await api(`/api/collections/ingredients/records/${ids0}`, { token: SU }));
check('U2 a food renamed in the file stays the SAME row (matched by fdc_id): new name, same id, new portions, my tag link kept',
  r.code === 0 && egg2.status === 200 && egg2.json.name.endsWith('(hard-boiled)') && egg2.json.portions.length === 2 && (await count('item_tags', `item = "${ids0}" && nutritionist = "${NID}"`)) === 1, `${r.out.slice(-200)} ${egg2.status}`);
const bad3 = [
  usda(['A,crudo,1,1,1,1,1,111,,', 'B,crudo,1,1,1,1,1,111,,']),
  usda(['A,crudo,1,1,1,1,1,abc,,']),
  usda(['A,crudo,1,1,1,1,1,111,cup-172,']),
  usda(['A,crudo,1,1,1,1,1,111,cup:0,']),
];
const outs = bad3.map((c) => U(c, ['--apply']));
const lineOf = (o) => o.out.split(NL).find((l) => l.includes('Line')) || '';
check('U3 a repeated fdc_id, a non-numeric fdc_id and a broken portion are each refused with the line number, nothing changes',
  outs.every((o) => o.code === 1 && /Line [0-9]/.test(o.out)) && /fdc_id 111 is repeated/.test(outs[0].out) && /fdc_id must be a whole number/.test(outs[1].out) && /portions must look like/.test(outs[2].out) && /portions must look like/.test(outs[3].out) && (await count('ingredients', 'dataset = "usdatest"')) === 2, outs.map(lineOf).join(' | '));
check('U4 the ejemplo set has no fdc_id and no portions (0 and empty)', (await api(`/api/collections/ingredients/records?perPage=5&filter=${encodeURIComponent('dataset = "ejemplo"')}`, { token: SU })).json.items.every((x) => x.fdc_id === 0 && (x.portions == null || x.portions === '')));
const w2 = await api(`/api/collections/ingredients/records/${ids0}`, { method: 'PATCH', body: { fdc_id: 1, portions: [] } });
check('U5 a nutritionist cannot change fdc_id or portions', [403, 404].includes(w2.status), w2.status);
r = loader(['--remove-dataset', 'usdatest', '--apply']);
check('U6 --remove-dataset usdatest removes its rows and the links on them', r.code === 0 && (await count('ingredients', 'dataset = "usdatest"')) === 0 && (await count('item_tags', `item = "${ids0}"`)) === 0, r.out);

check('U6 a starter tag shared with another dataset (alta en proteína, also in ejemplo) is NOT deleted with usdatest', (await count('tags', 'nutritionist = "" && name = "alta en proteína"')) === 1 && (await count('item_tags', 'nutritionist = "" && tag.name = "alta en proteína"')) > 0);

// cleanup rules
const gone = await api(`/api/collections/ingredients/records/${huevo.id}`, { method: 'DELETE', token: SU });
check('C1 deleting an ingredient (admin) removes the links on it', gone.status === 204 && (await count('item_tags', `item = "${huevo.id}"`)) === 0);
await api(`/api/collections/diet_templates/records/${tp.id}`, { method: 'DELETE' });
check('C1 deleting my template removes its tag link', (await count('item_tags', `item = "${tp.id}"`)) === 0);
const own = await mk('Para borrar');
await link(own.json.id, arroz.id);
await api(`/api/collections/tags/records/${own.json.id}`, { method: 'DELETE' });
check('C2 deleting my tag removes it from every item', (await count('item_tags', `tag = "${own.json.id}"`)) === 0 && (await count('tags', `id = "${own.json.id}"`)) === 0);

// limit of 200
let lastStatus = 200, made = 0;
for (let i = 0; i < 205 && lastStatus === 200; i++) { const x = await mk(`lim ${i}`, O.token, O.record.id); lastStatus = x.status; if (x.status === 200) made++; }
check('T7 at most 200 own tags', made === 200 && lastStatus === 400, `${made} ${lastStatus}`);

// remove the dataset
r = loader(['--remove-dataset', 'ejemplo']);
check('D1 --remove-dataset without --apply is a dry run', r.code === 0 && r.out.includes('DRY RUN') && (await count('ingredients')) > 0, r.out);
r = loader(['--remove-dataset', 'ejemplo', '--apply']);
check('D1 --apply empties ingredients, starter tags and their links; my own tags stay',
  r.code === 0 && (await count('ingredients')) === 0 && (await count('tags', 'nutritionist = ""')) === 0 && (await count('item_tags', 'nutritionist = ""')) === 0 && (await count('item_tags')) === 0 && (await count('tags', `nutritionist = "${NID}"`)) === 1, r.out);

const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
