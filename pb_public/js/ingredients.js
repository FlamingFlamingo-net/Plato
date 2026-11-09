// ingredients.js — Catálogo → Ingredientes (spec "Feature: Ingredients, slice (a)"). Read-only platform data per 100 g,
// search, filters, sort, tags (starter + mine), the Equivalentes tab, and a CSV download.
import { requireRole, signOut } from './api.js';
import { h, icon, num } from './ui.js';
import { listAll, loadTags, linksFor, itemsWithTag, tagCount, mountTagChips, tagBadges, openTagDialog, normText } from './tags.js';

const me = await requireRole('nutritionists');
document.getElementById('who').textContent = me.name;
document.getElementById('sign-out').addEventListener('click', signOut);

const statusEl = document.getElementById('status');
const view = document.getElementById('ing-view');
const GROUP_ORDER = ['Cereales', 'Verduras', 'Frutas', 'Leguminosas', 'Carnes', 'Lácteos', 'Grasas'];
const SORTS = {
  name: ['Nombre (A–Z)', null], kcal: ['Más calorías primero', 'kcal'], protein: ['Más proteína primero', 'protein_g'],
  fat: ['Más grasa primero', 'fat_g'], carbs: ['Más carbohidratos primero', 'carbs_g'], fiber: ['Más fibra primero', 'fiber_g'],
};
const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const P = new URL(location.href).searchParams;
const st = { tab: P.get('tab') === 'equivalentes' ? 'equivalentes' : 'lista', q: P.get('q') || '', state: P.get('estado') || '', sort: SORTS[P.get('orden')] ? P.get('orden') : 'name', shown: 60 };
const selected = new Set((P.get('etiquetas') || '').split(',').filter(Boolean));
const sync = () => {
  const u = new URL(location.href);
  const set = (k, v) => (v ? u.searchParams.set(k, v) : u.searchParams.delete(k));
  set('tab', st.tab === 'equivalentes' ? 'equivalentes' : ''); set('q', st.q); set('estado', st.state); set('orden', st.sort === 'name' ? '' : st.sort); set('etiquetas', [...selected].join(','));
  history.replaceState(null, '', u);
};

let rows = [], tags = [], links = new Map(), counts = new Map(), chips;
try {
  [rows, tags] = await Promise.all([listAll('ingredients'), loadTags()]);
} catch (e) { statusEl.textContent = e.message; throw e; }
const sample = rows.some((r) => r.dataset === 'ejemplo');
document.getElementById('sample-banner').hidden = !sample;
// Where the real numbers come from (spec "Plan: USDA FoodData Central"): shown whenever USDA rows are present.
const fromUsda = rows.some((r) => String(r.dataset).startsWith('usda'));
const srcLine = document.getElementById('source-line');
if (fromUsda) {
  srcLine.textContent = 'Fuente: USDA FoodData Central (SR Legacy). Valores promedio por 100 g, no de una marca. Los nombres están en inglés por ahora.';
  srcLine.hidden = false;
}
const tagById = () => Object.fromEntries(tags.map((t) => [t.id, t]));
const withGroups = rows.filter((r) => Array.isArray(r.groups) && r.groups.length);

// ---------- tabs ----------
const tabsEl = document.getElementById('ing-tabs');
const tabBtn = (key, label, n) => h('button', { class: 'plato-list-tab', type: 'button', role: 'tab', id: `tab-${key}`, 'aria-controls': 'ing-panel', 'aria-selected': String(st.tab === key), tabindex: st.tab === key ? '0' : '-1',
  'aria-label': `${label}${n != null ? `, ${n}` : ''}`, onclick: () => { st.tab = key; sync(); paintTabs(); render(); } }, label, n != null ? h('span', { class: 'plato-list-tab-count', text: ` (${n})` }) : null);
function paintTabs() {
  tabsEl.replaceChildren(tabBtn('lista', 'Ingredientes', rows.length), tabBtn('equivalentes', sample ? 'Equivalentes (ejemplo)' : 'Equivalentes', null));
  document.getElementById('ing-controls').hidden = st.tab !== 'lista';
  document.getElementById('tag-bar').hidden = st.tab !== 'lista' || !tags.length;
}
tabsEl.addEventListener('keydown', (e) => {
  const next = { ArrowRight: 'equivalentes', ArrowLeft: 'lista', Home: 'lista', End: 'equivalentes' }[e.key];
  if (!next) return; e.preventDefault(); st.tab = next; sync(); paintTabs(); render(); document.getElementById(`tab-${next}`).focus();
});

// ---------- controls ----------
const search = h('input', { class: 'input', type: 'search', id: 'ing-q', value: st.q, placeholder: 'Buscar por nombre', autocomplete: 'off', 'aria-label': 'Buscar ingredientes por nombre' });
const stateSel = h('select', { class: 'select', id: 'ing-state', 'aria-label': 'Filtrar por estado' }, ...[['', 'Estado: todos'], ['crudo', 'Crudo'], ['cocido', 'Cocido'], ['otro', 'Otro']].map(([v, l]) => h('option', { value: v, selected: v === st.state }, l)));
const sortSel = h('select', { class: 'select', id: 'ing-sort', 'aria-label': 'Ordenar ingredientes' }, ...Object.entries(SORTS).map(([k, [l]]) => h('option', { value: k, selected: k === st.sort }, l)));
search.addEventListener('input', () => { st.q = search.value; st.shown = 60; sync(); render(); });
stateSel.addEventListener('change', () => { st.state = stateSel.value; st.shown = 60; sync(); render(); });
sortSel.addEventListener('change', () => { st.sort = sortSel.value; sync(); render(); });
const csvBtn = h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', onclick: downloadCsv }, icon('copy', 16), 'Descargar lista (CSV)');
const aiBtn = h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', id: 'ing-ai', onclick: downloadForAi, title: 'Un archivo JSON con los ingredientes, para pegarlo en tu asistente de IA' }, icon('copy', 16), 'Lista para IA (JSON)');
document.getElementById('ing-controls').replaceChildren(search, stateSel, sortSel, csvBtn, aiBtn);

// ---------- tag chips (counts come from the server) ----------
const tagBar = document.getElementById('tag-bar');
const tagIds = new Map();   // tagId → Set(itemId), loaded when picked
async function refreshCounts() {
  counts = new Map(await Promise.all(tags.map(async (t) => [t.id, await tagCount('ingredient', t.id)])));
  tagIds.clear();
  if (chips) chips.setCounts(counts);
  else chips = mountTagChips(tagBar, { tags, counts, selected, onChange: () => { st.shown = 60; sync(); render(); } });
}
await refreshCounts();

// ---------- list ----------
const detailText = (r) => {
  const bits = [];
  if (r.piece_g) bits.push(`1 pieza ≈ ${num(r.piece_g, 0)} g`);
  if (r.portions?.length) bits.push(`Porciones: ${r.portions.map((p) => `${p.label} = ${num(p.grams, 1)} g`).join(' · ')}`);
  if (r.density_g_ml) bits.push(`Densidad ${num(r.density_g_ml, 2)} g/ml`);
  if (r.extra?.fiber_assumed_zero) bits.push('Fibra: USDA no da este dato; se muestra 0.');
  for (const [k, v] of Object.entries(r.extra || {})) if (k !== 'fiber_assumed_zero') bits.push(`${k.replace(/_/g, ' ')}: ${num(v, 1)}`);
  if (r.groups?.length) bits.push(`Equivalentes: ${r.groups.map((g) => `${g.group} (${num(g.portion_g, 0)} g)`).join(', ')}`);
  bits.push(`Fuente: ${r.source || '—'}${r.version ? ` · versión ${r.version}` : ''}${r.fdc_id ? ` · FDC ${r.fdc_id}` : ''}`);
  return bits;
};

let seq = 0;   // a slower, older render must never overwrite a newer one
async function render() {
  const mine = ++seq;
  if (st.tab === 'equivalentes') { renderGroups(); return; }
  const needle = normText(st.q);
  let out = rows.filter((r) => (!st.state || r.state === st.state) && (!needle || normText(r.name).includes(needle)));
  if (selected.size) {
    const sets = await Promise.all([...selected].map(async (id) => tagIds.get(id) || tagIds.set(id, await itemsWithTag('ingredient', id)).get(id)));
    out = out.filter((r) => sets.every((s) => s.has(r.id)));
    if (mine !== seq) return;
  }
  const key = SORTS[st.sort][1];
  out.sort((a, b) => (key ? (b[key] - a[key]) : 0) || collator.compare(a.name, b.name));
  const page = out.slice(0, st.shown);
  const got = await linksFor('ingredient', page.map((r) => r.id)).catch(() => new Map());
  if (mine !== seq) return;
  links = got;
  statusEl.textContent = out.length ? `${out.length} ${out.length === 1 ? 'ingrediente' : 'ingredientes'}` : '';
  if (!rows.length) { view.replaceChildren(h('div', { class: 'plato-empty-state' }, h('strong', { text: 'Aún no hay ingredientes' }), h('span', { text: 'Cuando se cargue la lista de alimentos aparecerá aquí.' }))); return; }
  if (!out.length) { view.replaceChildren(h('div', { class: 'plato-empty-state' }, h('strong', { text: 'Ningún ingrediente coincide' }), h('span', { text: 'Prueba con otra palabra o quita los filtros.' }))); return; }
  const tb = h('tbody', {});
  for (const r of page) {
    const detail = h('tr', { class: 'plato-ing-detail', hidden: true }, h('td', { colspan: '6' }, h('ul', {}, ...detailText(r).map((x) => h('li', { text: x })))));
    const btn = h('button', { class: 'plato-ing-name', type: 'button', 'aria-expanded': 'false', onclick: () => { detail.hidden = !detail.hidden; btn.setAttribute('aria-expanded', String(!detail.hidden)); } }, r.name);
    const td = (label, v) => h('td', { 'data-label': label, text: v });
    tb.append(h('tr', {},
      h('th', { scope: 'row', class: 'plato-ing-first' }, btn, ' ', h('span', { class: 'plato-muted plato-small', text: r.state }), tagBadges(tags, links.get(r.id)),
        h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', 'aria-label': `Etiquetas de ${r.name}`, onclick: () => openTagDialog({ kind: 'ingredient', itemId: r.id, itemName: `${r.name} (${r.state})`, tags, myId: me.id, onClose: async () => { await refreshCounts(); render(); } }) }, icon('plus', 14), 'Etiquetas')),
      td('kcal', num(r.kcal, 0)), td('Proteína (g)', num(r.protein_g)), td('Grasas (g)', num(r.fat_g)), td('Carbohidratos (g)', num(r.carbs_g)), td('Fibra (g)', num(r.fiber_g))), detail);
  }
  const table = h('table', { class: 'plato-ing-table' }, h('caption', { class: 'sr-only', text: 'Ingredientes, valores por 100 gramos' }),
    h('thead', {}, h('tr', {}, ...['Ingrediente', 'kcal', 'Proteína (g)', 'Grasas (g)', 'Carbohidratos (g)', 'Fibra (g)'].map((c) => h('th', { scope: 'col', text: c })))), tb);
  view.replaceChildren(table, out.length > page.length ? h('p', { style: 'text-align:center' }, h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', onclick: () => { st.shown += 60; render(); } }, `Mostrar más (${out.length - page.length})`)) : null);
}

function renderGroups() {
  statusEl.textContent = '';
  if (!withGroups.length) { view.replaceChildren(h('div', { class: 'plato-empty-state' }, h('strong', { text: 'Aún no hay equivalentes' }), h('span', { text: 'Llegan junto con la fuente de datos.' }))); return; }
  const by = new Map();
  for (const r of withGroups) for (const g of r.groups) (by.get(g.group) || by.set(g.group, []).get(g.group)).push({ r, g });
  const names = [...by.keys()].sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99) || collator.compare(a, b));
  view.replaceChildren(h('p', { class: 'plato-muted' }, sample ? 'Ejemplo: ' : '', 'la porción en gramos es lo que cuenta como 1 equivalente de ese grupo. Un ingrediente aparece en cada grupo al que pertenece.'),
    ...names.map((n) => h('section', { class: 'card plato-group', 'aria-labelledby': `g-${GROUP_ORDER.indexOf(n)}-${normText(n).replace(/\W/g, '')}` },
      h('header', {}, h('h2', { id: `g-${GROUP_ORDER.indexOf(n)}-${normText(n).replace(/\W/g, '')}`, text: n }), h('p', { text: `${by.get(n).length} ${by.get(n).length === 1 ? 'ingrediente' : 'ingredientes'}` })),
      h('section', {}, h('ul', { class: 'plato-group-list' }, ...by.get(n).sort((a, b) => collator.compare(a.r.name, b.r.name)).map(({ r, g }) =>
        h('li', {}, h('span', { text: `${r.name}${r.state === 'otro' ? '' : ` (${r.state})`}` }), h('b', { text: `${num(g.portion_g, 0)} g` }))))))));
}

// ---------- CSV ----------
function downloadCsv() {
  const extraKeys = [...new Set(rows.flatMap((r) => Object.keys(r.extra || {})))].sort();
  const cell = (v) => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['name', 'state', 'kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g', 'piece_g', 'density_g_ml', ...extraKeys.map((k) => `extra:${k}`), 'groups', 'dataset', 'source', 'version'];
  const lines = [head.join(',')].concat([...rows].sort((a, b) => collator.compare(a.name, b.name)).map((r) => [r.name, r.state, r.kcal, r.protein_g, r.fat_g, r.carbs_g, r.fiber_g, r.piece_g || '', r.density_g_ml || '',
    ...extraKeys.map((k) => r.extra?.[k] ?? ''), (r.groups || []).map((g) => `${g.group}:${g.portion_g}`).join(';'), r.dataset, r.source, r.version].map(cell).join(',')));
  const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'ingredientes.csv' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// The ingredient list for an AI assistant (spec "Preparing for the natural-language skill"): ids, exact portion labels, tags.
async function downloadForAi() {
  const links = await listAll('item_tags', { filter: 'kind = "ingredient"', fields: 'tag,item' }).catch(() => []);
  const tagName = Object.fromEntries(tags.map((x) => [x.id, x.name]));
  const byItem = new Map();
  for (const l of links) { if (!tagName[l.tag]) continue; (byItem.get(l.item) || byItem.set(l.item, []).get(l.item)).push(tagName[l.tag]); }
  const sets = [...new Map(rows.map((r) => [r.dataset, { dataset: r.dataset, source: r.source, version: r.version }])).values()];
  const doc = {
    format: 'plato-ingredients', version: 1, generated_at: new Date().toISOString(), datasets: sets,
    how_to_use: 'Reference an ingredient by fdc_id. Prefer grams. Use a household portion only when the request names one (for example 2 eggs) and copy its label exactly from portions. Never write nutrition numbers: the app computes them.',
    ingredients: [...rows].sort((a, b) => collator.compare(a.name, b.name)).map((r) => ({
      fdc_id: r.fdc_id || null, id: r.id, name: r.name, state: r.state,
      per_100g: { kcal: r.kcal, protein_g: r.protein_g, fat_g: r.fat_g, carbs_g: r.carbs_g, fiber_g: r.fiber_g },
      portions: (r.portions || []).map((p) => p.label), has_density: r.density_g_ml > 0, tags: byItem.get(r.id) || [],
    })),
  };
  const blob = new Blob([JSON.stringify(doc, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: 'ingredientes-para-ia.json' });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

paintTabs();
await render();
