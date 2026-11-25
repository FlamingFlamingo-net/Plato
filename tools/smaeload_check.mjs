// SMAE converter + loader (spec "SMAE and USDA side by side", s1). Uses an INVENTED mini table in the SMAE layout:
// the real SMAE file is a copyrighted book and never enters this public repo.
// Usage: node tools/smaeload_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
import { superuser } from './admin.mjs';
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
async function api(path, { method = 'GET', body, token = N } = {}) {
  const headers = token ? { Authorization: token } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const py = (args, env = {}) => { const r = spawnSync('python', args, { env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...env }, encoding: 'utf-8' }); return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }; };
const loader = (args) => py(['tools/load_ingredients.py', '--base', BASE, ...args], { PB_SUPERUSER_TOKEN: SU });
const all = async (filter) => {
  const out = [];
  for (let page = 1; ; page++) {
    const r = (await api(`/api/collections/ingredients/records?perPage=200&page=${page}&filter=${encodeURIComponent(filter)}`, { token: SU })).json;
    out.push(...r.items); if (page >= r.totalPages) return out;
  }
};
const byName = (rows, n) => rows.find((r) => r.name === n);

// ---------- invented SMAE-style rows (one row = one equivalent) ----------
const hdr = 'group,subgroup,name,qty_text,qty,unit,peso_bruto_g,peso_neto_g,kcal,protein_g,fat_g,carbs_g,fiber_g,check,extras';
const ex = (o) => `"${JSON.stringify(o).replace(/"/g, '""')}"`;
const SRC = [hdr,
  `Verduras,,Hoja prueba cruda,2,2.0,taza,120,98,22,2.2,0.1,4.3,3.6,,${ex({ vit_c_mg: 29.5, sodium_mg: 50, glycemic_index: 64, glycemic_load: 2.7 })}`,
  `Verduras,,Hoja prueba cocida,1/2,0.5,taza,72,72,19,1.9,0.1,3.9,2.1,,`,
  `Cereales y tubérculos,sin grasa,Grano prueba cocido,1/2,0.5,taza,80,80,70,2,0.5,15,1.2,,`,
  `Alimentos de origen animal,muy bajo aporte de grasa,Pescado prueba,1,1.0,filete,50,40,40,7,1,0,,,${ex({ cholesterol_mg: 20, sodium_mg: 30 })}`,
  `Leche,entera,Leche prueba,1,1.0,taza,240,240,150,9,8,12,,kcal 150 vs 4P+9G+4C 156,`,
  `Leche,entera,Leche prueba,1/2,0.5,taza,120,120,75,4.5,4,6,,,`,
  `Azúcares,sin grasa,Azúcar prueba,2,2.0,cucharadita,8,8,33,,0,8.4,,,`,
  `Bebidas alcohólicas,,Bebida prueba,60,60.0,ml,60,60,139,,,0,,,${ex({ ethanol_g: 19.9 })}`,
  `Aceites y grasas,con proteína,Semilla prueba,10,10.0,g,10,10,60,2,5,2,1,,`,
  `Cereales y tubérculos,con grasa,Galleta prueba rota,2,2.0,pieza,21,21,91,0.8,25.1,16.5,0.8,,`,
].join('\n') + '\n';
writeFileSync(`${OUT}/smae-mini.csv`, SRC);
const CSV = `${OUT}/smae-mini-out.csv`;

// ---------- converter ----------
let r = py(['tools/smae_to_csv.py', `${OUT}/smae-mini.csv`, CSV]);
check('C1 the converter reads 10 rows, writes 9, leaves 1 out', r.code === 0 && /10 rows read -> 9 ingredients written, 1 left out/.test(r.out), r.out);
const left = readFileSync(CSV.replace('.csv', '-no-cargados.csv'), 'utf8');
check('C1 the impossible row (25 g fat in 21 g) is listed with its reason', /Galleta prueba rota,valores imposibles por 100 g/.test(left), left);

r = loader(['--csv', CSV, '--dataset', 'smae-v4', '--source', 'SMAE 4a edición', '--version', '4']);
check('L1 dry run accepts the file and saves nothing', r.code === 0 && /^9 ingredients/m.test(r.out) && r.out.includes('DRY RUN'), r.out.slice(0, 400));

// USDA beside it (the real public-domain file in the repo), loaded first
r = loader(['--csv', 'data/ingredients-usda.csv', '--dataset', 'usda-sr-legacy', '--source', 'USDA FoodData Central SR Legacy (CC0)', '--apply']);
const usda0 = await all('dataset = "usda-sr-legacy"');
check('L2 USDA set loaded beside it (420 foods)', r.code === 0 && usda0.length === 420, `${r.out.slice(-200)} ${usda0.length}`);

r = loader(['--csv', CSV, '--dataset', 'smae-v4', '--source', 'SMAE 4a edición', '--version', '4', '--apply']);
const smae = await all('dataset = "smae-v4"');
check('L3 --apply loads 9 SMAE foods as their own data set', r.code === 0 && smae.length === 9 && smae.every((x) => x.source === 'SMAE 4a edición' && x.version === '4' && !x.fdc_id), `${r.out.slice(-300)} ${smae.length}`);

const hoja = byName(smae, 'Hoja prueba cruda');
check('M1 per 100 g = value / net weight x 100 (22 kcal in 98 g -> 22.449; protein 2.2449, fibre 3.6735)',
  hoja && near(hoja.kcal, 22.449) && near(hoja.protein_g, 2.2449) && near(hoja.fiber_g, 3.6735) && near(hoja.carbs_g, 4.3878), JSON.stringify(hoja));
check('M1 one equivalent: group Verduras = 98 g; units equivalente 98 g and taza 49 g; state crudo from the name',
  hoja && hoja.state === 'crudo' && JSON.stringify(hoja.groups) === JSON.stringify([{ group: 'Verduras', portion_g: 98 }]) &&
  hoja.portions.some((p) => p.label === 'equivalente' && p.grams === 98) && hoja.portions.some((p) => p.label === 'taza' && p.grams === 49), JSON.stringify(hoja && [hoja.groups, hoja.portions]));
check('M1 other nutrients per 100 g, same names as USDA (vitamin_c_mg 30.102, sodium_mg 51.0204); glycemic index kept as is; glycemic load dropped',
  hoja && near(hoja.extra.vitamin_c_mg, 30.102) && near(hoja.extra.sodium_mg, 51.0204) && hoja.extra.glycemic_index === 64 && !('glycemic_load' in hoja.extra), JSON.stringify(hoja?.extra));
const coc = byName(smae, 'Hoja prueba cocida'), grano = byName(smae, 'Grano prueba cocido');
check('M2 "1/2 taza = 72 g" -> taza = 144 g; cooked from the name', coc && coc.state === 'cocido' && coc.portions.some((p) => p.label === 'taza' && p.grams === 144), JSON.stringify(coc?.portions));
check('M2 a subgroup goes into the group name ("Cereales y tubérculos · sin grasa": 80 g)', grano && grano.groups[0].group === 'Cereales y tubérculos · sin grasa' && grano.groups[0].portion_g === 80, JSON.stringify(grano?.groups));
const pez = byName(smae, 'Pescado prueba');
check('F1 no fibre in the book -> 0 with fiber_missing = 1 (never an exact-looking 0 alone)', pez && pez.fiber_g === 0 && pez.extra.fiber_missing === 1 && !hoja.extra.fiber_missing, JSON.stringify(pez?.extra));
const tagsOf = async (id) => (await api(`/api/collections/item_tags/records?perPage=50&expand=tag&filter=${encodeURIComponent(`item = "${id}"`)}`, { token: SU })).json.items.map((l) => l.expand?.tag?.name).sort();
const tp = await tagsOf(pez.id), th = await tagsOf(hoja.id);
check('T1 starter tags with the USDA thresholds (Pescado: protein 17.5 g < 20, sodium 75 mg -> only "bajo en sodio"; Hoja: no fibre tag at 3.7 g, sodium 51 -> "bajo en sodio")',
  JSON.stringify(tp) === '["bajo en sodio"]' && JSON.stringify(th) === '["bajo en sodio"]', `${tp} | ${th}`);
const leches = smae.filter((x) => x.name.startsWith('Leche prueba')).map((x) => x.name).sort();
check('D1 a repeated name keeps both, with the serving added', JSON.stringify(leches) === JSON.stringify(['Leche prueba (1 taza)', 'Leche prueba (1/2 taza)']), leches.join(' | '));
check('D2 calories that don\'t add up are loaded as printed and marked por_confirmar', byName(smae, 'Leche prueba (1 taza)')?.extra.por_confirmar === 1 && near(byName(smae, 'Leche prueba (1 taza)').kcal, 62.5) && !byName(smae, 'Leche prueba (1/2 taza)').extra?.por_confirmar);
const az = byName(smae, 'Azúcar prueba'), beb = byName(smae, 'Bebida prueba'), sem = byName(smae, 'Semilla prueba');
check('D3 sugar at 105 g per 100 g (the book\'s rounding) -> 100 and por_confirmar; blank protein in sweets = 0', az && az.carbs_g === 100 && az.protein_g === 0 && az.extra.por_confirmar === 1, JSON.stringify(az));
check('D4 a drink: blank protein/fat = 0, ml sets density 1 g/ml, no unit portion; a row measured in g gets only "equivalente"',
  beb && beb.protein_g === 0 && beb.fat_g === 0 && beb.density_g_ml === 1 && beb.portions.length === 1 && sem && sem.portions.length === 1 && sem.portions[0].label === 'equivalente', JSON.stringify([beb?.portions, beb?.density_g_ml, sem?.portions]));

// ---------- repeat, mix in a dish, remove ----------
const stamps = Object.fromEntries(smae.map((x) => [x.id, x.updated]));
r = loader(['--csv', CSV, '--dataset', 'smae-v4', '--source', 'SMAE 4a edición', '--version', '4', '--apply']);
const smae2 = await all('dataset = "smae-v4"');
check('R1 loading it again changes nothing (0 new, same ids)', r.code === 0 && r.out.includes('0 new') && smae2.length === 9 && smae2.every((x) => x.id in stamps), r.out.slice(-200));
const usda1 = await all('dataset = "usda-sr-legacy"');
check('R1 USDA is never touched by an SMAE load (420, same update times)', usda1.length === 420 && usda1.every((x) => usda0.find((y) => y.id === x.id)?.updated === x.updated));

const pork = usda1.find((x) => x.fdc_id && /^Pork/.test(x.name)) || usda1[0];
const dish = await api('/api/collections/dishes/records', { method: 'POST', body: { nutritionist: NID, name: 'Mixto prueba', serving_unit: 'porción', items: [{ ingredient: grano.id, amount: 1, unit: 'equivalente' }, { ingredient: pork.id, amount: 50, unit: 'g' }] } });
const want = 70 + pork.kcal / 2;
check(`X1 a dish mixes 1 equivalente of an SMAE cereal (70 kcal) and 50 g of a USDA food: server total ${want.toFixed(2)} kcal`, dish.status === 200 && near(dish.json.nutrition.kcal, want, 0.01), JSON.stringify(dish.json).slice(0, 300));
r = loader(['--remove-dataset', 'smae-v4', '--apply']);
const after = await api(`/api/collections/dishes/records/${dish.json?.id}`);
check('X2 removing smae-v4 keeps the dish and flags only the SMAE line; USDA stays (420)', r.code === 0 && (await all('dataset = "smae-v4"')).length === 0 && (await all('dataset = "usda-sr-legacy"')).length === 420 &&
  after.status === 200 && after.json.items[0].missing === true && !after.json.items[1].missing, JSON.stringify(after.json?.items));

// ---------- the book's data stays out of the public repo ----------
const tracked = spawnSync('git', ['ls-files'], { encoding: 'utf-8' }).stdout.split('\n').filter((f) => /smae/i.test(f));
check('P1 no SMAE data file is tracked in git (only the converter and this check)', tracked.every((f) => ['tools/smae_to_csv.py', 'tools/smaeload_check.mjs'].includes(f)), tracked.join(' '));

const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
process.exit(ok === results.length ? 0 : 1);
