// dishes.js — Catálogo → Recetas (spec "Feature: Recetas (dishes), slice (b)"): the nutritionist's own dishes, built from ingredients.
// The server computes and stores the official numbers per serving (pb_hooks/dishes.pb.js); this page shows them live
// while building with the same arithmetic (dish-math.js). Tabs Activas | Archivadas, search, tag chips, duplicate, delete.
import { requireRole, list, create, update, remove, signOut, q } from './api.js';
import { listState, mountListBar, sortItems } from './list-tabs.js';
import { h, icon, toast, busy, num, shortDate, offlineBanner } from './ui.js';
import { listAll, loadTags, linksFor, mountTagChips, tagBadges, openTagDialog, normText } from './tags.js';
import { compute, unitsOf, MAX_LINES } from './dish-math.js';

offlineBanner();
const me = await requireRole('nutritionists');
document.getElementById('who').textContent = me.name;
document.getElementById('sign-out').addEventListener('click', signOut);

const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const search = document.getElementById('dish-q');
const tagBarEl = document.getElementById('tag-bar');
const FIELDS = 'id,name,state,kcal,protein_g,fat_g,carbs_g,fiber_g,piece_g,density_g_ml,portions,fdc_id,dataset,source,version';
let ingredients = [], byId = new Map(), tagList = [], chips = null;
const picked = new Set();
try {
  ingredients = await listAll('ingredients', { fields: FIELDS });
  byId = new Map(ingredients.map((i) => [i.id, i]));
  tagList = await loadTags().catch(() => []);
} catch (e) { statusEl.textContent = e.message; throw e; }
if (ingredients.some((i) => String(i.dataset).startsWith('usda'))) {
  const s = document.getElementById('source-line');
  s.textContent = 'Los valores salen de tus ingredientes (USDA FoodData Central, SR Legacy), por porción.';
  s.hidden = false;
}

const state = listState('dishes');
const bar = mountListBar(document.getElementById('list-bar'), {
  key: 'dishes', state, panel: 'list-panel', calories: true,
  labels: { active: 'Activas', archived: 'Archivadas', recent: 'Archivadas recientemente', what: 'recetas' },
  onChange: () => load(),
});
search.addEventListener('input', () => load());

const kcalOf = (d) => Math.round(Number(d.nutrition?.kcal) || 0);
const stats = (n) => `${num(n.kcal, 0)} kcal · P ${num(n.protein_g)} g · G ${num(n.fat_g)} g · C ${num(n.carbs_g)} g · Fibra ${num(n.fiber_g)} g`;
const now = () => new Date().toISOString().replace('T', ' ');
const unique = (name, all) => {
  const taken = new Set(all.map((d) => d.name.toLowerCase()));
  let c = `${name} (copia)`, i = 2;
  while (taken.has(c.toLowerCase())) c = `${name} (copia ${i++})`;
  return c.slice(0, 120);
};
let all = [];

async function load() {
  const archived = state.view === 'archived';
  try { all = await listAll('dishes'); } catch (e) { statusEl.textContent = e.message; return; }
  bar.setCounts({ active: all.filter((d) => !d.archived_at).length, archived: all.filter((d) => d.archived_at).length });
  let items = all.filter((d) => !!d.archived_at === archived);
  const needle = normText(search.value);
  if (needle) items = items.filter((d) => normText(d.name).includes(needle));
  const linkMap = await linksFor('dish', items.map((d) => d.id)).catch(() => new Map());
  const counts = new Map();
  for (const m of linkMap.values()) for (const id of m.keys()) counts.set(id, (counts.get(id) || 0) + 1);
  if (chips) chips.setCounts(counts); else chips = mountTagChips(tagBarEl, { tags: tagList, counts, selected: picked, onChange: () => load() });
  if (picked.size) items = items.filter((d) => [...picked].every((id) => linkMap.get(d.id)?.has(id)));
  items = sortItems(items, state.sort, { name: 'name' });
  statusEl.textContent = items.length ? `${items.length} ${items.length === 1 ? 'receta' : 'recetas'}${archived ? (items.length === 1 ? ' archivada' : ' archivadas') : ''}` : '';
  if (!items.length) {
    const none = !all.length;
    listEl.replaceChildren(h('li', { class: 'plato-empty-state' },
      h('strong', { text: archived ? 'No hay recetas archivadas' : (needle || picked.size ? 'Ninguna receta coincide' : 'Aún no tienes recetas') }),
      h('span', { text: archived ? 'Archiva las que ya no uses: dejan de aparecer en las listas y puedes restaurarlas cuando quieras.' : (needle || picked.size ? 'Prueba con otra palabra o quita los filtros.' : 'Arma tu primera receta con los ingredientes del catálogo: la plataforma calcula calorías y macros por porción.') }),
      none && !archived ? h('button', { class: 'btn', type: 'button', onclick: () => openBuilder(null) }, 'Nueva receta') : null));
    return;
  }
  listEl.replaceChildren(...items.map((d) => card(d, linkMap.get(d.id))));
}

function card(d, links) {
  const items = Array.isArray(d.items) ? d.items : [];
  const flagged = items.filter((x) => x.missing || x.problem);
  const detail = h('section', { class: 'plato-dish-lines', hidden: true },
    h('ul', {}, ...items.map((x) => h('li', {}, h('span', { text: `${x.name || 'Ingrediente'}${x.state && x.state !== 'otro' ? ` (${x.state})` : ''}` }),
      h('b', { text: x.missing ? 'ya no existe' : `${num(x.amount, 2)} ${x.unit}${x.unit !== 'g' && x.grams ? ` = ${num(x.grams, 1)} g` : ''}` })))),
    d.notes ? h('p', { class: 'plato-muted plato-small', text: d.notes }) : null);
  const toggle = h('button', { class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', type: 'button', 'aria-expanded': 'false',
    onclick: () => { detail.hidden = !detail.hidden; toggle.setAttribute('aria-expanded', String(!detail.hidden)); toggle.lastChild.textContent = detail.hidden ? 'Ver ingredientes' : 'Ocultar ingredientes'; } },
  icon('eye', 16), h('span', { text: 'Ver ingredientes' }));
  const act = (label, ic, fn, extra = {}) => h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', ...extra, onclick: (ev) => fn(ev.currentTarget) }, ic ? icon(ic, 16) : null, label);
  return h('li', { class: 'card plato-dish', dataset: { id: d.id } },
    h('header', { class: 'plato-row plato-row--between' },
      h('div', {},
        h('h2', { text: d.name }),
        h('p', { class: 'plato-dish-stats', text: `Por 1 ${d.serving_unit}: ${stats(d.nutrition || {})}` }),
        h('p', { class: 'plato-tags-row' }, d.multi_serving ? h('span', { class: 'badge', 'data-variant': 'outline', text: 'Se sirve por piezas' }) : null, tagBadges(tagList, links))),
      h('div', { class: 'plato-row plato-dish-actions' },
        toggle,
        act('Etiquetas', 'plus', () => openTagDialog({ kind: 'dish', itemId: d.id, itemName: d.name, tags: tagList, myId: me.id, onClose: () => load() }), { 'data-action': 'tags', 'aria-label': `Etiquetas de ${d.name}` }),
        d.archived_at ? null : act('Editar', null, () => openBuilder(d), { 'data-action': 'edit', 'aria-label': `Editar ${d.name}` }),
        d.archived_at ? null : act('Duplicar', 'copy', () => duplicate(d), { 'data-action': 'duplicate', 'aria-label': `Duplicar ${d.name}` }),
        d.archived_at
          ? act('Restaurar', 'undo', (b) => setArchived(d, false, b), { 'data-action': 'restore', 'aria-label': `Restaurar ${d.name}` })
          : act('Archivar', 'archive', (b) => setArchived(d, true, b), { 'data-action': 'archive', 'aria-label': `Archivar ${d.name}` }),
        h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'aria-label': `Borrar la receta ${d.name}`, 'data-action': 'delete',
          onclick: async (ev) => {
            if (!confirm(`¿Borrar la receta “${d.name}”? No cambia las dietas de tus pacientes.`)) return;
            try { await busy(ev.currentTarget, () => remove('dishes', d.id)); } catch (e) { toast(e.message, 'error'); return; }
            toast('Receta borrada.'); load();
          } }, icon('trash', 16)))),
    d.values_updated_at ? h('p', { class: 'plato-dish-note', role: 'status', text: `Valores actualizados el ${shortDate(d.values_updated_at)}: cambiaron los datos de un ingrediente.` }) : null,
    flagged.length ? h('p', { class: 'plato-dish-warn', role: 'alert', text: flagged.some((x) => x.missing) ? 'Falta un ingrediente: la receta conserva sus últimos valores. Edítala para cambiarlo o quitarlo.' : `Revisa: ${flagged[0].problem}` }) : null,
    detail);
}

async function setArchived(d, on, button) {
  try { await busy(button, () => update('dishes', d.id, { archived_at: on ? now() : '' })); } catch (e) { toast(e.message, 'error'); return; }
  toast(on ? 'Receta archivada. Está en la pestaña Archivadas.' : 'Receta restaurada.');
  load();
}

async function duplicate(d) {
  if ((d.items || []).some((x) => x.missing || x.problem)) { toast('Esta receta tiene un ingrediente con problema: edítala primero.', 'error'); return; }
  try {
    await create('dishes', { nutritionist: me.id, name: unique(d.name, all), serving_unit: d.serving_unit, multi_serving: !!d.multi_serving, notes: d.notes || '',
      items: d.items.map((x) => ({ ingredient: x.ingredient, amount: x.amount, unit: x.unit })) });
  } catch (e) { toast(e.message, 'error'); return; }
  toast('Receta duplicada.'); load();
}

// ---------------- builder ----------------
let dlg;
function openBuilder(dish) {
  dlg?.remove();
  const editing = !!dish;
  const lines = (dish?.items || []).map((x) => ({ ingredient: x.ingredient, amount: x.amount, unit: x.unit, name: x.name, state: x.state, missing: !!x.missing || !byId.has(x.ingredient) }));
  const nameIn = h('input', { class: 'input', id: 'dish-name', maxlength: 120, required: true, value: dish?.name || '', autocomplete: 'off' });
  const unitIn = h('input', { class: 'input', id: 'dish-unit', maxlength: 30, required: true, value: dish?.serving_unit || '', list: 'dish-units', autocomplete: 'off', 'aria-describedby': 'dish-unit-help' });
  const multiIn = h('input', { type: 'checkbox', class: 'input', id: 'dish-multi', checked: !!dish?.multi_serving });
  const notesIn = h('textarea', { class: 'textarea', id: 'dish-notes', rows: 3, maxlength: 1000 }); notesIn.value = dish?.notes || '';
  const error = h('p', { class: 'plato-form-error', role: 'alert', hidden: true });
  const totals = h('div', { class: 'plato-dish-totals', 'aria-live': 'polite', id: 'dish-totals' });
  const linesEl = h('ul', { class: 'plato-dish-edit-lines', id: 'dish-lines', 'aria-label': 'Ingredientes de la receta' });
  const results = h('ul', { class: 'plato-dish-results', id: 'dish-results', hidden: true });
  const ingQ = h('input', { class: 'input', type: 'search', id: 'dish-ing-q', placeholder: 'Buscar ingrediente (en inglés)', autocomplete: 'off', 'aria-label': 'Buscar un ingrediente para agregarlo', 'aria-controls': 'dish-results' });
  const say = (m) => { error.textContent = m || ''; error.hidden = !m; };

  function renderTotals() {
    const c = compute(lines, byId);
    const un = unitIn.value.trim() || 'porción';
    if (!c.ok) { totals.replaceChildren(h('strong', { text: `Por 1 ${un}` }), h('span', { class: 'plato-muted', text: lines.length ? 'Completa o corrige los ingredientes para ver los valores.' : 'Agrega ingredientes para ver los valores.' })); return c; }
    totals.replaceChildren(h('strong', { text: `Por 1 ${un}` }), h('span', { id: 'dish-totals-text', text: stats(c.nutrition) }));
    return c;
  }
  function renderLines() {
    const c = compute(lines, byId);
    linesEl.replaceChildren(...lines.map((l, i) => {
      const ing = byId.get(l.ingredient), info = c.lines[i] || {};
      if (!ing) return h('li', { class: 'plato-dish-line is-bad' }, h('span', { text: `${l.name || 'Ingrediente'} ya no existe. Quítalo o cámbialo.` }),
        h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', 'aria-label': `Quitar ${l.name || 'ingrediente'}`, onclick: () => { lines.splice(i, 1); renderLines(); } }, icon('trash', 14), 'Quitar'));
      const amount = h('input', { class: 'input', type: 'number', min: '0', step: 'any', inputmode: 'decimal', value: l.amount, 'aria-label': `Cantidad de ${ing.name}`, id: `dl-a-${i}` });
      const unit = h('select', { class: 'select', 'aria-label': `Unidad de ${ing.name}` }, ...unitsOf(ing).map((u) => h('option', { value: u.value, selected: u.value === l.unit }, u.label)));
      const out = h('span', { class: 'plato-muted plato-small', 'aria-live': 'polite' });
      const paint = () => { const cc = compute(lines, byId).lines[i] || {}; out.textContent = cc.error ? cc.error : (cc.grams != null ? `${num(cc.grams, 1)} g · ${num(cc.kcal, 0)} kcal` : ''); out.classList.toggle('is-bad', !!cc.error); renderTotals(); };
      amount.addEventListener('input', () => { l.amount = amount.value === '' ? 0 : Number(amount.value); paint(); });
      unit.addEventListener('change', () => { l.unit = unit.value; paint(); });
      out.textContent = info.error ? info.error : (info.grams != null ? `${num(info.grams, 1)} g · ${num(info.kcal, 0)} kcal` : '');
      if (info.error) out.classList.add('is-bad');
      return h('li', { class: 'plato-dish-line' },
        h('div', { class: 'plato-dish-line-name' }, h('strong', { text: ing.name }), ing.state !== 'otro' ? h('span', { class: 'plato-muted plato-small', text: ` ${ing.state}` }) : null),
        h('div', { class: 'plato-dish-line-inputs' }, amount, unit,
          h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'aria-label': `Quitar ${ing.name}`, onclick: () => { lines.splice(i, 1); renderLines(); ingQ.focus(); } }, icon('trash', 16))),
        out);
    }));
    renderTotals();
  }
  function renderResults() {
    const needle = normText(ingQ.value);
    if (!needle) { results.hidden = true; results.replaceChildren(); return; }
    const found = ingredients.filter((i) => normText(i.name).includes(needle)).slice(0, 8);
    results.hidden = false;
    results.replaceChildren(...(found.length ? found.map((i) => h('li', {}, h('button', { class: 'plato-dish-result', type: 'button', onclick: () => add(i) },
      h('strong', { text: i.name }), h('span', { class: 'plato-muted plato-small', text: ` ${i.state !== 'otro' ? `${i.state} · ` : ''}${num(i.kcal, 0)} kcal / 100 g` })))) : [h('li', { class: 'plato-muted plato-small', text: 'Ningún ingrediente coincide. Prueba en inglés (por ejemplo, “beans”).' })]));
  }
  function add(i) {
    if (lines.length >= MAX_LINES) { say(`Máximo ${MAX_LINES} ingredientes por receta.`); return; }
    say('');
    lines.push({ ingredient: i.id, amount: 100, unit: 'g' });
    ingQ.value = ''; renderResults(); renderLines();
    document.getElementById(`dl-a-${lines.length - 1}`)?.select();
  }
  ingQ.addEventListener('input', renderResults);
  ingQ.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); results.querySelector('button')?.click(); } });
  unitIn.addEventListener('input', renderTotals);

  const save = h('button', { class: 'btn', type: 'submit', id: 'dish-save' }, editing ? 'Guardar cambios' : 'Guardar receta');
  const form = h('form', { class: 'plato-form', novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); say('');
    const name = nameIn.value.replace(/\s+/g, ' ').trim(), unit = unitIn.value.replace(/\s+/g, ' ').trim();
    if (!name) { say('Escribe el nombre de la receta.'); nameIn.focus(); return; }
    if (!unit) { say('Escribe en qué se sirve (taco, pieza, taza, porción…).'); unitIn.focus(); return; }
    if (!lines.length) { say('Agrega al menos un ingrediente.'); ingQ.focus(); return; }
    if (lines.some((l) => !byId.has(l.ingredient))) { say('Hay un ingrediente que ya no existe. Quítalo o cámbialo.'); return; }
    const c = compute(lines, byId);
    if (!c.ok) { say('Corrige los ingredientes marcados en rojo.'); return; }
    const body = { name, serving_unit: unit, multi_serving: multiIn.checked, notes: notesIn.value.trim(), items: lines.map((l) => ({ ingredient: l.ingredient, amount: Number(l.amount), unit: l.unit })) };
    try {
      await busy(save, () => editing ? update('dishes', dish.id, body) : create('dishes', { ...body, nutritionist: me.id }));
    } catch (err) {
      say(err.data?.name?.code === 'validation_not_unique' || /unique/i.test(err.message) ? 'Ya tienes una receta con ese nombre.' : err.message);
      return;
    }
    dlg.close(); toast(editing ? 'Cambios guardados.' : 'Receta guardada.'); load();
  } },
  h('section', { class: 'plato-form' },
    h('div', { class: 'field' }, h('label', { for: 'dish-name', text: 'Nombre' }), nameIn),
    h('div', { class: 'field' }, h('label', { for: 'dish-unit', text: 'Se sirve en (una porción es…)' }), unitIn,
      h('datalist', { id: 'dish-units' }, ...['taco', 'pieza', 'taza', 'porción', 'plato', 'cucharada', 'rebanada', 'vaso', 'tazón'].map((u) => h('option', { value: u }))),
      h('p', { class: 'plato-muted plato-small', id: 'dish-unit-help', style: 'margin:0', text: 'Los ingredientes que pongas abajo son para UNA de estas.' })),
    h('label', { class: 'plato-row plato-dish-switch', for: 'dish-multi', style: 'gap:0.5rem;align-items:flex-start' }, multiIn, h('span', { class: 'plato-stack-sm' }, h('strong', { text: 'Se sirve por piezas' }), h('span', { class: 'plato-muted plato-small', text: 'Una dieta podrá decir × 3.' }))),
    h('div', { class: 'field' }, h('label', { for: 'dish-notes' }, 'Notas ', h('span', { class: 'plato-muted', text: '(opcional, cómo se prepara)' })), notesIn),
    h('fieldset', { class: 'plato-dish-ingredients' }, h('legend', { text: 'Ingredientes' }),
      h('div', { class: 'field' }, ingQ, results), linesEl),
    totals, error),
  h('footer', { class: 'plato-actions' }, h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', onclick: () => dlg.close() }, 'Cancelar'), save));
  dlg = h('dialog', { class: 'dialog plato-dish-dialog', id: 'dish-dialog', 'aria-labelledby': 'dish-title' },
    h('div', {}, h('header', {}, h('h2', { id: 'dish-title', text: editing ? 'Editar receta' : 'Nueva receta' }), h('p', { text: 'Los valores se calculan por una porción.' })), form));
  document.body.append(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  renderLines();
  dlg.showModal();
  nameIn.focus();
}

document.getElementById('new-dish').addEventListener('click', () => openBuilder(null));
await load();
