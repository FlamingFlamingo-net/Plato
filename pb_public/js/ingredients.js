// ingredients.js — Catálogo → Ingredientes (spec "Feature: Ingredients, slice (a)" + "SMAE and USDA side by side").
// Read-only platform data per 100 g. One tab per data source (SMAE | USDA | Otros, only those present) with its own search,
// filters, sort and tags, plus the Equivalentes tab (SMAE groups). CSV of the tab, and a JSON list for an AI assistant.
import { requireRole, signOut } from './api.js';
import { h, icon, num } from './ui.js';
import { listAll, loadTags, linksFor, mountTagChips, tagBadges, openTagDialog, normText } from './tags.js';
import { SOURCES, sourceOf, SOURCE_TAB, SOURCE_SHORT, SOURCE_LINE, equivalentText, fiberMissing } from './sources.js';

const me = await requireRole('nutritionists');
document.getElementById('who').textContent = me.name;
document.getElementById('sign-out').addEventListener('click', signOut);

const statusEl = document.getElementById('status');
const view = document.getElementById('ing-view');
// SMAE's own order of groups
// (the older sample names sit where their SMAE group is)
const GROUP_ORDER = ['Verduras', 'Frutas', 'Cereales', 'Cereales y tubérculos · sin grasa', 'Cereales y tubérculos · con grasa', 'Leguminosas',
  'Carnes', 'Alimentos de origen animal · muy bajo aporte de grasa', 'Alimentos de origen animal · bajo aporte de grasa',
  'Alimentos de origen animal · moderado aporte de grasa', 'Alimentos de origen animal · alto aporte de grasa',
  'Lácteos', 'Leche · descremada', 'Leche · semidescremada', 'Leche · entera', 'Leche · con azúcar', 'Leche · productos Yakult',
  'Grasas', 'Aceites y grasas · sin proteína', 'Aceites y grasas · con proteína', 'Azúcares · sin grasa', 'Azúcares · con grasa',
  'Libres en energía', 'Bebidas alcohólicas'];
const SORTS = {
  name: ['Nombre (A–Z)', null], kcal: ['Más calorías primero', 'kcal'], protein: ['Más proteína primero', 'protein_g'],
  fat: ['Más grasa primero', 'fat_g'], carbs: ['Más carbohidratos primero', 'carbs_g'], fiber: ['Más fibra primero', 'fiber_g'],
};
const EXTRA_LABEL = { sodium_mg: 'Sodio (mg)', calcium_mg: 'Calcio (mg)', iron_mg: 'Hierro (mg)', potassium_mg: 'Potasio (mg)', vitamin_a_ug: 'Vitamina A (µg)',
  vitamin_c_mg: 'Vitamina C (mg)', folate_ug: 'Ácido fólico (µg)', cholesterol_mg: 'Colesterol (mg)', saturated_fat_g: 'Grasa saturada (g)',
  polyunsaturated_fat_g: 'Grasa poliinsaturada (g)', sugars_g: 'Azúcares (g)', selenium_ug: 'Selenio (µg)', ethanol_g: 'Alcohol (g)',
  phosphorus_mg: 'Fósforo (mg)', glycemic_index: 'Índice glucémico', magnesium_mg: 'Magnesio (mg)', zinc_mg: 'Zinc (mg)', vitamin_b12_ug: 'Vitamina B12 (µg)', vitamin_d_ug: 'Vitamina D (µg)' };
const FLAGS = new Set(['fiber_assumed_zero', 'fiber_missing', 'por_confirmar']);
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const TAB_KEY = 'plato.ingredients.tab';

let rows = [], tags = [];
try {
  [rows, tags] = await Promise.all([listAll('ingredients'), loadTags()]);
} catch (e) { statusEl.textContent = e.message; throw e; }
const sample = rows.some((r) => r.dataset === 'ejemplo');
document.getElementById('sample-banner').hidden = !sample;
const bySource = Object.fromEntries(SOURCES.map((s) => [s, rows.filter((r) => sourceOf(r) === s)]));
const present = SOURCES.filter((s) => bySource[s].length);
const TABS = [...present, 'equivalentes'];
const withGroups = rows.filter((r) => Array.isArray(r.groups) && r.groups.length);

// ---------- state: one per source tab (search, state, sort, tags), plus the Equivalentes search ----------
const P = new URL(location.href).searchParams;
const blank = () => ({ q: '', state: '', sort: 'name', selected: new Set(), shown: 60 });
const per = Object.fromEntries(present.map((s) => [s, blank()]));
const eqState = { q: '' };
const askedTab = P.get('tab') === 'lista' ? present[0] : P.get('tab');
let saved = null; try { saved = localStorage.getItem(TAB_KEY); } catch {}
let tab = TABS.includes(askedTab) ? askedTab : (TABS.includes(saved) ? saved : TABS[0]);
if (per[tab]) Object.assign(per[tab], { q: P.get('q') || '', state: P.get('estado') || '', sort: SORTS[P.get('orden')] ? P.get('orden') : 'name', selected: new Set((P.get('etiquetas') || '').split(',').filter(Boolean)) });
if (tab === 'equivalentes') eqState.q = P.get('q') || '';
const cur = () => per[tab];
const sync = () => {
  const u = new URL(location.href), s = cur();
  const set = (k, v) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
  set('tab', tab === TABS[0] ? '' : tab);
  set('q', s ? s.q : eqState.q); set('estado', s?.state); set('orden', s && s.sort !== 'name' ? s.sort : ''); set('etiquetas', s ? [...s.selected].join(',') : '');
  history.replaceState(null, '', u);
  try { localStorage.setItem(TAB_KEY, tab); } catch {}
};

// ---------- tag links of all ingredients (counts per tab are counted here, on the device) ----------
let tagItems = new Map();   // tagId → Set(itemId)
async function loadLinks() {
  const ls = await listAll('item_tags', { filter: 'kind = "ingredient"', fields: 'tag,item' }).catch(() => []);
  tagItems = new Map();
  for (const l of ls) (tagItems.get(l.tag) || tagItems.set(l.tag, new Set()).get(l.tag)).add(l.item);
}
await loadLinks();
const countsFor = (src) => {
  const ids = new Set(bySource[src].map((r) => r.id));
  return new Map(tags.map((t) => [t.id, [...(tagItems.get(t.id) || [])].filter((i) => ids.has(i)).length]));
};

// ---------- tabs ----------
const tabsEl = document.getElementById('ing-tabs');
const tabBtn = (key) => {
  const label = key === 'equivalentes' ? (sample && !bySource.smae.length ? 'Equivalentes (ejemplo)' : 'Equivalentes') : SOURCE_TAB[key];
  const n = key === 'equivalentes' ? null : bySource[key].length;
  return h('button', { class: 'plato-list-tab', type: 'button', role: 'tab', id: `tab-${key}`, 'aria-controls': 'ing-panel', 'aria-selected': String(tab === key), tabindex: tab === key ? '0' : '-1',
    'aria-label': `${label}${n != null ? `, ${n}` : ''}`, onclick: () => go(key) },
    ...(/ \(/.test(label) ? [label.replace(/ \(.*$/, ''), h('span', { class: 'plato-tab-sub', text: label.replace(/^[^(]*/, ' ') })] : [label]),   // "(español)" hides on small phones
    n != null ? h('span', { class: 'plato-list-tab-count', text: ` (${n})` }) : null);
};
function go(key, focus = false) { tab = key; sync(); paint(); render(); if (focus) document.getElementById(`tab-${key}`).focus(); }
tabsEl.addEventListener('keydown', (e) => {
  const i = TABS.indexOf(tab);
  const next = { ArrowRight: TABS[(i + 1) % TABS.length], ArrowLeft: TABS[(i - 1 + TABS.length) % TABS.length], Home: TABS[0], End: TABS[TABS.length - 1] }[e.key];
  if (!next) return; e.preventDefault(); go(next, true);
});

// ---------- controls (one set of inputs, filled from the active tab's state) ----------
const search = h('input', { class: 'input', type: 'search', id: 'ing-q', placeholder: 'Buscar por nombre', autocomplete: 'off', 'aria-label': 'Buscar ingredientes por nombre' });
const stateSel = h('select', { class: 'select', id: 'ing-state', 'aria-label': 'Filtrar por estado' }, ...[['', 'Estado: todos'], ['crudo', 'Crudo'], ['cocido', 'Cocido'], ['otro', 'Otro']].map(([v, l]) => h('option', { value: v }, l)));
const sortSel = h('select', { class: 'select', id: 'ing-sort', 'aria-label': 'Ordenar ingredientes' }, ...Object.entries(SORTS).map(([k, [l]]) => h('option', { value: k }, l)));
search.addEventListener('input', () => { if (cur()) { cur().q = search.value; cur().shown = 60; } else eqState.q = search.value; sync(); render(); });
stateSel.addEventListener('change', () => { cur().state = stateSel.value; cur().shown = 60; sync(); render(); });
sortSel.addEventListener('change', () => { cur().sort = sortSel.value; sync(); render(); });
const csvBtn = h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', onclick: downloadCsv }, icon('copy', 16), 'Descargar lista (CSV)');
const aiBtn = h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', id: 'ing-ai', onclick: downloadForAi, title: 'Un archivo JSON con los ingredientes de todas las fuentes, para pegarlo en tu asistente de IA' }, icon('copy', 16), 'Lista para IA (JSON)');
const controls = document.getElementById('ing-controls');
const tagBar = document.getElementById('tag-bar');
const srcLine = document.getElementById('source-line');
let chips = null;

function paint() {
  tabsEl.replaceChildren(...TABS.map(tabBtn));
  const s = cur();
  search.value = s ? s.q : eqState.q;
  search.placeholder = tab === 'equivalentes' ? 'Buscar en los grupos' : tab === 'usda' ? 'Buscar por nombre (en inglés)' : 'Buscar por nombre';
  controls.classList.toggle('plato-ing-controls--eq', !s);
  controls.replaceChildren(...(s ? [search, stateSel, sortSel, csvBtn, aiBtn] : [search]));
  if (s) { stateSel.value = s.state; sortSel.value = s.sort; }
  const line = s ? SOURCE_LINE[tab] : (bySource.smae.length ? 'Grupos del SMAE: la porción en gramos es 1 equivalente de ese grupo.' : '');
  srcLine.textContent = line; srcLine.hidden = !line;
  tagBar.replaceChildren(); chips = null;
  tagBar.hidden = !s || !tags.length;
  if (s && tags.length) chips = mountTagChips(tagBar, { tags, counts: countsFor(tab), selected: s.selected, onChange: () => { s.shown = 60; sync(); render(); } });
}

// ---------- list ----------
const detailText = (r) => {
  const bits = [];
  const eq = equivalentText(r);
  if (eq) bits.push(eq);
  if (r.piece_g) bits.push(`1 pieza ≈ ${num(r.piece_g, 0)} g`);
  const ports = (r.portions || []).filter((p) => p.label !== 'equivalente');
  if (ports.length) bits.push(`Porciones: ${ports.map((p) => `${p.label} = ${num(p.grams, 1)} g`).join(' · ')}`);
  if (r.density_g_ml) bits.push(`Densidad ${num(r.density_g_ml, 2)} g/ml`);
  if (r.extra?.fiber_assumed_zero) bits.push('Fibra: USDA no da este dato; se muestra 0.');
  if (fiberMissing(r)) bits.push('Fibra: el SMAE no da este dato. Una receta con este ingrediente dirá “Fibra: incompleta”.');
  if (r.extra?.por_confirmar) bits.push('Por confirmar: en el libro las calorías no cuadran con los macros, o el valor se redondeó a 100 g.');
  for (const [k, v] of Object.entries(r.extra || {})) if (!FLAGS.has(k)) bits.push(`${EXTRA_LABEL[k] || k.replace(/_/g, ' ')}: ${num(v, 1)}${k === 'glycemic_index' ? '' : ' por 100 g'}`);
  if (r.groups?.length) bits.push(`Equivalentes: ${r.groups.map((g) => `${g.group} (${num(g.portion_g, 0)} g)`).join(', ')}`);
  bits.push(`Fuente: ${r.source || '—'}${r.version ? ` · versión ${r.version}` : ''}${r.fdc_id ? ` · FDC ${r.fdc_id}` : ''}`);
  return bits;
};

let seq = 0;   // a slower, older render must never overwrite a newer one
async function render() {
  const mine = ++seq;
  if (tab === 'equivalentes') { renderGroups(); return; }
  const s = cur(), needle = normText(s.q);
  let out = bySource[tab].filter((r) => (!s.state || r.state === s.state) && (!needle || normText(r.name).includes(needle)));
  if (s.selected.size) out = out.filter((r) => [...s.selected].every((id) => tagItems.get(id)?.has(r.id)));
  const key = SORTS[s.sort][1];
  const val = (r) => (key === 'fiber_g' && fiberMissing(r) ? -1 : r[key]);
  out.sort((a, b) => (key ? (val(b) - val(a)) : 0) || collator.compare(a.name, b.name));
  const page = out.slice(0, s.shown);
  const links = await linksFor('ingredient', page.map((r) => r.id)).catch(() => new Map());
  if (mine !== seq) return;
  statusEl.textContent = out.length ? `${out.length} ${out.length === 1 ? 'ingrediente' : 'ingredientes'}` : '';
  if (!out.length) { view.replaceChildren(h('div', { class: 'plato-empty-state' }, h('strong', { text: 'Ningún ingrediente coincide' }), h('span', { text: tab === 'usda' ? 'Los nombres de USDA están en inglés: prueba “beans”, “rice”… o busca en la pestaña SMAE.' : 'Prueba con otra palabra o quita los filtros.' }))); return; }
  const tb = h('tbody', {});
  for (const r of page) {
    const detail = h('tr', { class: 'plato-ing-detail', hidden: true }, h('td', { colspan: '6' }, h('ul', {}, ...detailText(r).map((x) => h('li', { text: x })))));
    const btn = h('button', { class: 'plato-ing-name', type: 'button', 'aria-expanded': 'false', onclick: () => { detail.hidden = !detail.hidden; btn.setAttribute('aria-expanded', String(!detail.hidden)); } }, r.name);
    const td = (label, v, extra = {}) => h('td', { 'data-label': label, text: v, ...extra });
    const group = r.groups?.[0]?.group, eq = equivalentText(r);
    tb.append(h('tr', {},
      h('th', { scope: 'row', class: 'plato-ing-first' }, btn, ' ', h('span', { class: 'plato-muted plato-small', text: r.state }),
        r.extra?.por_confirmar ? h('span', { class: 'badge plato-confirm', 'data-variant': 'outline', text: 'por confirmar' }) : null,
        group || eq ? h('span', { class: 'plato-ing-eq plato-muted plato-small', text: [group, eq].filter(Boolean).join(' — ') }) : null,
        tagBadges(tags, links.get(r.id)),
        h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', 'aria-label': `Etiquetas de ${r.name}`, onclick: () => openTagDialog({ kind: 'ingredient', itemId: r.id, itemName: `${r.name} (${r.state})`, tags, myId: me.id, onClose: async () => { await loadLinks(); chips?.setCounts(countsFor(tab)); render(); } }) }, icon('plus', 14), 'Etiquetas')),
      td('kcal', num(r.kcal, 0)), td('Proteína (g)', num(r.protein_g)), td('Grasas (g)', num(r.fat_g)), td('Carbohidratos (g)', num(r.carbs_g)),
      fiberMissing(r) ? td('Fibra (g)', '—', { title: 'El SMAE no da este dato', 'aria-label': 'Fibra: sin dato' }) : td('Fibra (g)', num(r.fiber_g))), detail);
  }
  const table = h('table', { class: 'plato-ing-table' }, h('caption', { class: 'sr-only', text: `Ingredientes de ${SOURCE_SHORT[tab]}, valores por 100 gramos` }),
    h('thead', {}, h('tr', {}, ...['Ingrediente', 'kcal', 'Proteína (g)', 'Grasas (g)', 'Carbohidratos (g)', 'Fibra (g)'].map((c) => h('th', { scope: 'col', text: c })))), tb);
  view.replaceChildren(...[table, out.length > page.length ? h('p', { style: 'text-align:center' }, h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', onclick: () => { s.shown += 60; render(); } }, `Mostrar más (${out.length - page.length})`)) : null].filter(Boolean));   // a bare null would print "null"
}

function renderGroups() {
  if (!withGroups.length) { statusEl.textContent = ''; view.replaceChildren(h('div', { class: 'plato-empty-state' }, h('strong', { text: 'Aún no hay equivalentes' }), h('span', { text: 'Llegan junto con la fuente de datos.' }))); return; }
  const needle = normText(eqState.q);
  const by = new Map();
  for (const r of withGroups) for (const g of r.groups) {
    if (needle && !normText(r.name).includes(needle) && !normText(g.group).includes(needle)) continue;
    (by.get(g.group) || by.set(g.group, []).get(g.group)).push({ r, g });
  }
  const rank = (n) => { const i = GROUP_ORDER.indexOf(n); return i < 0 ? 999 : i; };
  const names = [...by.keys()].sort((a, b) => rank(a) - rank(b) || collator.compare(a, b));
  const total = names.reduce((s, n) => s + by.get(n).length, 0);
  statusEl.textContent = needle ? `${total} ${total === 1 ? 'resultado' : 'resultados'} en ${names.length} ${names.length === 1 ? 'grupo' : 'grupos'}` : `${names.length} grupos`;
  if (!names.length) { view.replaceChildren(h('div', { class: 'plato-empty-state' }, h('strong', { text: 'Nada coincide' }), h('span', { text: 'Prueba con otra palabra.' }))); return; }
  view.replaceChildren(h('p', { class: 'plato-muted' }, sample && !bySource.smae.length ? 'Ejemplo: ' : '', 'La porción en gramos es lo que cuenta como 1 equivalente de ese grupo. Abre un grupo para ver sus alimentos.'),
    ...names.map((n) => {
      const items = by.get(n).sort((a, b) => collator.compare(a.r.name, b.r.name));
      return h('details', { class: 'card plato-group', open: !!needle && names.length <= 3, dataset: { group: n } },
        h('summary', {}, h('span', { class: 'plato-group-name', text: n }), h('span', { class: 'plato-muted plato-small', text: `${items.length} ${items.length === 1 ? 'alimento' : 'alimentos'}` })),
        h('ul', { class: 'plato-group-list', 'aria-label': n }, ...items.map(({ r, g }) => {
          const eq = equivalentText(r);
          const household = eq && / \(/.test(eq) ? eq.replace(/^1 equivalente = /, '').replace(/ \(.*$/, '') : '';
          return h('li', {}, h('span', {}, `${r.name}${r.state === 'otro' ? '' : ` (${r.state})`}`, household ? h('span', { class: 'plato-muted plato-small', text: ` · ${household}` }) : null),
            h('b', { text: `${num(g.portion_g, 0)} g` }));
        })));
    }));
}

// ---------- CSV (the tab's rows) ----------
function downloadCsv() {
  const list = bySource[tab] || rows;
  const extraKeys = [...new Set(list.flatMap((r) => Object.keys(r.extra || {})))].sort();
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['name', 'state', 'kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'piece_g', 'density_g_ml', ...extraKeys.map((k) => `extra:${k}`), 'groups', 'portions', 'dataset', 'source', 'version'];
  const lines = [head.join(',')].concat([...list].sort((a, b) => collator.compare(a.name, b.name)).map((r) => [r.name, r.state, r.kcal, r.protein_g, r.fat_g, r.carbs_g, r.fiber_g, r.piece_g || '', r.density_g_ml || '',
    ...extraKeys.map((k) => r.extra?.[k] ?? ''), (r.groups || []).map((g) => `${g.group}:${g.portion_g}`).join(';'), (r.portions || []).map((p) => `${p.label}:${p.grams}`).join(';'), r.dataset, r.source, r.version].map(cell).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `ingredientes-${tab}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// The ingredient list for an AI assistant (spec "Preparing for the natural-language skill"), every source, each item labelled.
async function downloadForAi() {
  const tagName = Object.fromEntries(tags.map((x) => [x.id, x.name]));
  const byItem = new Map();
  for (const [tg, items] of tagItems) { if (!tagName[tg]) continue; for (const it of items) (byItem.get(it) || byItem.set(it, []).get(it)).push(tagName[tg]); }
  const sets = [...new Map(rows.map((r) => [r.dataset, { dataset: r.dataset, source: r.source, version: r.version, label: SOURCE_SHORT[sourceOf(r)] }])).values()];
  const doc = {
    format: 'plato-ingredients', version: 2, generated_at: new Date().toISOString(), datasets: sets,
    how_to_use: 'Each ingredient has a source (USDA or SMAE). Reference a USDA ingredient by fdc_id and an SMAE ingredient (no fdc_id) by ingredient_id = its id. Prefer grams. For SMAE you may use the unit "equivalente" or its household unit when the request counts equivalents or names that unit; copy unit labels exactly from portions. Never write nutrition numbers: the app computes them.',
    ingredients: [...rows].sort((a, b) => collator.compare(a.name, b.name)).map((r) => ({
      source: SOURCE_SHORT[sourceOf(r)], fdc_id: r.fdc_id || null, id: r.id, name: r.name, state: r.state,
      per_100g: { kcal: r.kcal, protein_g: r.protein_g, fat_g: r.fat_g, carbs_g: r.carbs_g, fiber_g: fiberMissing(r) ? null : r.fiber_g },
      portions: (r.portions || []).map((p) => p.label), has_density: r.density_g_ml > 0, groups: (r.groups || []).map((g) => g.group), tags: byItem.get(r.id) || [],
    })),
  };
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'ingredientes-para-ia.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

if (!rows.length) {
  statusEl.textContent = '';
  tabsEl.hidden = true; controls.hidden = true; tagBar.hidden = true;
  view.replaceChildren(h('div', { class: 'plato-empty-state' }, h('strong', { text: 'Aún no hay ingredientes' }), h('span', { text: 'Cuando se cargue la lista de alimentos aparecerá aquí.' })));
} else {
  paint();
  await render();
}
