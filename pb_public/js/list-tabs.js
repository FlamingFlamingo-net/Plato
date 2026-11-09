// list-tabs.js — the bar on every catalogue list page (spec "Feature: Archive and restore catalogue items"):
// tabs Activos (N) | Archivados (N) and "Ordenar". The tab and the sort live in the address (?view=archived&sort=…)
// and the sort is remembered per list and tab on this computer. Sorting runs here: lists load whole, and the
// server's SQLite cannot compare names ignoring accents (Álvarez with the A's).
import { h } from './ui.js';

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });
const SORTS = ['name', '-name', '-created', 'created', '-archived', 'kcal'];

export function sortItems(items, sort, { name = 'name', archived = 'archived_at' } = {}) {
  const byName = (a, b) => collator.compare(a[name] || '', b[name] || '');
  const byText = (k) => (a, b) => String(a[k] || '').localeCompare(String(b[k] || ''));
  if (sort === 'kcal') return [...items].sort((a, b) => (Number(b.nutrition?.kcal) || 0) - (Number(a.nutrition?.kcal) || 0) || byName(a, b));   // dishes only
  const key = sort.replace(/^-/, ''), dir = sort.startsWith('-') ? -1 : 1;
  const cmp = key === 'name' ? byName : byText(key === 'archived' ? archived : 'created');
  return [...items].sort((a, b) => dir * cmp(a, b) || byName(a, b));
}

const storeKey = (key, view) => `plato.sort.${key}.${view}`;
const defaultSort = (view) => (view === 'archived' ? '-archived' : 'name');
const allowed = (s, view) => SORTS.includes(s) && (s !== '-archived' || view === 'archived');

// { view: 'active' | 'archived', sort } from the address, else this computer's choice, else the default.
export function listState(key) {
  const p = new URL(location.href).searchParams;
  const view = p.get('view') === 'archived' ? 'archived' : 'active';
  return { view, sort: sortFor(key, view, p.get('sort')) };
}
function sortFor(key, view, fromUrl) {
  if (allowed(fromUrl, view)) return fromUrl;
  const stored = localStorage.getItem(storeKey(key, view));
  return allowed(stored, view) ? stored : defaultSort(view);
}
function writeUrl(state) {
  const u = new URL(location.href);
  if (state.view === 'archived') u.searchParams.set('view', 'archived'); else u.searchParams.delete('view');
  if (state.sort === defaultSort(state.view)) u.searchParams.delete('sort'); else u.searchParams.set('sort', state.sort);
  history.replaceState(null, '', u);
}

// labels: { active: 'Activos', archived: 'Archivados', recent: 'Archivados recientemente', what: 'pacientes' }
// Returns { setCounts({ active, archived }) }. onChange(state) runs after every tab or sort change.
export function mountListBar(el, { key, labels, state, panel, onChange, calories = false }) {
  let counts = { active: null, archived: null };
  const names = {
    name: 'Nombre (A–Z)', '-name': 'Nombre (Z–A)', '-created': 'Más nuevos primero', created: 'Más antiguos primero', '-archived': labels.recent, kcal: 'Más calorías primero',
  };
  const spoken = { name: 'por nombre, de la A a la Z', '-name': 'por nombre, de la Z a la A', '-created': 'los más nuevos primero', created: 'los más antiguos primero', '-archived': 'los archivados más recientes primero', kcal: 'las de más calorías primero' };
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });
  const tab = (view) => h('button', {
    class: 'plato-list-tab', type: 'button', role: 'tab', id: `tab-${view}`, 'aria-controls': panel,
    onclick: () => select(view, true),
  });
  const tabs = { active: tab('active'), archived: tab('archived') };
  const sel = h('select', { class: 'select', id: 'list-sort', 'aria-label': `Ordenar ${labels.what}` });
  sel.addEventListener('change', () => {
    state.sort = sel.value;
    localStorage.setItem(storeKey(key, state.view), state.sort);
    writeUrl(state);
    live.textContent = `Ordenado: ${spoken[state.sort]}.`;
    onChange(state);
  });
  const list = h('div', { class: 'plato-list-tabs', role: 'tablist', 'aria-label': `Mostrar ${labels.what}` }, tabs.active, tabs.archived);
  list.addEventListener('keydown', (e) => {
    const order = ['active', 'archived'], i = order.indexOf(state.view);
    const next = { ArrowRight: order[(i + 1) % 2], ArrowLeft: order[(i + 1) % 2], Home: 'active', End: 'archived' }[e.key];
    if (!next) return;
    e.preventDefault();
    select(next, true);
    tabs[next].focus();
  });
  el.replaceChildren(h('div', { class: 'plato-list-bar' }, list,
    h('label', { class: 'plato-list-sort', for: 'list-sort' }, h('span', { class: 'plato-muted plato-small', text: 'Ordenar' }), sel)), live);

  function paint() {
    for (const v of ['active', 'archived']) {
      const on = v === state.view, n = counts[v];
      tabs[v].setAttribute('aria-selected', String(on));
      tabs[v].tabIndex = on ? 0 : -1;
      tabs[v].replaceChildren(labels[v], n == null ? '' : h('span', { class: 'plato-list-tab-count', text: ` (${n})` }));
      tabs[v].setAttribute('aria-label', n == null ? labels[v] : `${labels[v]}, ${n}`);
    }
    sel.replaceChildren(...SORTS.filter((s) => allowed(s, state.view) && (s !== 'kcal' || calories)).map((s) => h('option', { value: s, selected: s === state.sort }, names[s])));
    document.getElementById(panel)?.setAttribute('aria-labelledby', `tab-${state.view}`);
  }
  function select(view, user) {
    if (view === state.view && user) return;
    state.view = view;
    state.sort = sortFor(key, view, null);
    writeUrl(state);
    paint();
    if (user) onChange(state);
  }
  paint();
  return { setCounts(c) { counts = { ...counts, ...c }; paint(); } };
}
