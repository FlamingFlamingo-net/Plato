// home.js — the nutritionist's home (spec "Feature: Patient activity dashboard", slice 3).
// Banner (own photo + live text) · tabs with counts · Hoy summary · cards for the selected tab.
// Not live: refreshes when you come back to the tab, and with "Actualizar" (decision 1).
import { requireRole, list, update, photoUrl, signOut, q, SLOT_LABEL, localDate, dateOnly } from './api.js';
import { h, icon, toast, busy, offlineBanner, longDate, shortDate, timeOf } from './ui.js';
import { activitySummary } from './activity.js';
import { POSE_LABEL } from './progress-photos.js';
import { feedbackEl, hasFeedback } from './feedback.js';
import { feedbackControls } from './feedback-dialog.js';

offlineBanner();
const me = await requireRole('nutritionists');
document.getElementById('sign-out').addEventListener('click', signOut);

const COLL = { meal: 'meal_logs', activity: 'activity_logs', progress: 'progress_photos' };
const PAGE = 50;
const initials = (s) => String(s || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');
const nowIso = () => new Date().toISOString().replace('T', ' ');

// ---------- Banner (upgrades 1 + 2) ----------
function renderBanner() {
  document.getElementById('banner-name').textContent = me.name;
  document.getElementById('banner-clinic').textContent = me.clinic_name || 'Nutrióloga/o';
  document.getElementById('banner-logo').textContent = initials(me.clinic_name || me.name);
  const contact = document.getElementById('banner-contact');
  contact.replaceChildren(
    me.whatsapp ? h('span', {}, icon('message', 15), `WhatsApp ${me.whatsapp}`) : null,
    me.instagram ? h('span', {}, icon('user', 15), me.instagram.startsWith('@') ? me.instagram : `@${me.instagram}`) : null);
  contact.hidden = !me.whatsapp && !me.instagram;
  document.getElementById('banner-edit-label').textContent = me.cover ? 'Cambiar portada' : 'Agregar foto de portada';
  if (me.cover) {
    photoUrl(me, '1600x0', 'cover').then((u) => {
      const el = document.getElementById('banner-photo');
      el.style.backgroundImage = `url("${u}")`;
      el.classList.add('has-photo');
    }).catch(() => {});
  }
}
renderBanner();

// ---------- Data ----------
let patients = [];
let pmap = {};
let unseen = { meal: [], activity: [], progress: [] };
let withDiet = new Set();
let recentMeals = new Set();
let templateCount = 0;
let pools = null;      // per type: { items, cursor, done }
let limit = PAGE;
let shownItems = [];   // what the cards show now (for "Marcar todo como visto")
let loadedAt = 0;

const typesFor = (tab, filter) => tab === 'activity' ? ['activity']
  : tab === 'photos' ? (filter === 'progress' ? ['progress'] : filter === 'meal' ? ['meal'] : ['meal', 'progress'])
  : ['meal', 'activity', 'progress'];

async function fetchPage(type) {
  const p = pools[type];
  // Tie-safe cursor: records saved in the same millisecond share "created", so page on (created, id).
  const c = p.last;
  const after = c ? ` && (created < ${q(c.created)} || (created = ${q(c.created)} && id < ${q(c.id)}))` : '';
  const items = await list(COLL[type], { filter: `patient.archived_at = ""${after}`, sort: '-created,-id', perPage: PAGE });
  for (const x of items) x.type = type;
  p.items.push(...items);
  if (items.length) p.last = items.at(-1);
  if (items.length < PAGE) p.done = true;
}

// Newest-first across collections without loading everything: an item is safe to show once it is newer than
// the oldest item loaded from every collection that may still have more.
const key = (x) => `${x.created}|${x.id}`;
const TOP = '\uffff'; // "nothing loaded yet": sorts above every key
async function visible(types) {
  for (;;) {
    const merged = types.flatMap((t) => pools[t].items).sort((a, b) => key(b).localeCompare(key(a)));
    const open = types.filter((t) => !pools[t].done);
    const edge = (t) => (pools[t].last ? key(pools[t].last) : TOP);
    const boundary = open.length ? open.map(edge).reduce((a, b) => (a > b ? a : b)) : '';
    const safe = boundary ? merged.filter((x) => key(x) >= boundary) : merged;
    if (safe.length > limit || !open.length) return { shown: safe.slice(0, limit), more: safe.length > limit || open.length > 0 };
    await Promise.all(open.filter((t) => edge(t) === boundary).map(fetchPage));
  }
}

async function loadAll() {
  const since = new Date(); since.setDate(since.getDate() - 2); // today and the 2 days before = "3 days"
  const unseenOf = (t) => list(COLL[t], { filter: 'seen_at = "" && patient.archived_at = ""', fields: 'id,patient', perPage: 500 });
  const [ps, diets, recent, um, ua, up, tpls] = await Promise.all([
    list('patients', { filter: 'archived_at = ""', fields: 'id,name,birth_date,joined', sort: 'name', perPage: 500 }),
    list('diets', { fields: 'patient', perPage: 500 }),
    list('meal_logs', { filter: `date >= ${q(localDate(since))} && patient.archived_at = ""`, fields: 'patient', perPage: 500 }),
    unseenOf('meal'), unseenOf('activity'), unseenOf('progress'),
    list('diet_templates', { fields: 'id', perPage: 500 }),
  ]);
  patients = ps;
  pmap = Object.fromEntries(ps.map((p) => [p.id, p]));
  withDiet = new Set(diets.map((d) => d.patient));
  recentMeals = new Set(recent.map((m) => m.patient));
  unseen = { meal: um, activity: ua, progress: up };
  templateCount = tpls.length;
  pools = { meal: { items: [], last: null, done: false }, activity: { items: [], last: null, done: false }, progress: { items: [], last: null, done: false } };
  loadedAt = Date.now();
}

// ---------- Pendientes (placeholder for the "pending dashboard"; the client still defines it) ----------
function pendingItems() {
  const per = {};
  for (const t of Object.keys(unseen)) for (const r of unseen[t]) per[r.patient] = (per[r.patient] || 0) + 1;
  const items = [];
  for (const p of patients) {
    const n = per[p.id];
    if (n) items.push({ warn: false, p, text: `${n} ${n === 1 ? 'registro sin ver' : 'registros sin ver'}.`, action: 'Ver registros', href: `/patient.html?id=${encodeURIComponent(p.id)}&tab=log` });
  }
  for (const p of patients) {
    const go = (tab) => `/patient.html?id=${encodeURIComponent(p.id)}${tab ? `&tab=${tab}` : ''}`;
    if (!p.joined) items.push({ warn: true, p, text: 'Aún no usa la app. Mándale su enlace.', action: 'Crear enlace', href: go('access') });
    if (!withDiet.has(p.id)) items.push({ warn: true, p, text: 'No tiene dieta asignada.', action: 'Asignar dieta', href: go('diet') });
    if (p.joined && !recentMeals.has(p.id)) items.push({ warn: true, p, text: 'No registra comidas desde hace 3 días o más.', action: 'Ver paciente', href: go('log') });
    if (!dateOnly(p.birth_date)) items.push({ warn: true, p, text: 'Falta su fecha de nacimiento.', action: 'Agregar', href: go('') });
  }
  return items;
}

// ---------- Tabs (upgrades 3, 4, 6, 7, 8) ----------
const unseenCount = (types) => types.reduce((n, t) => n + unseen[t].length, 0);
const TABS = [
  { id: 'recent', label: 'Recientes', hint: 'Lo más nuevo', icon: 'clock', count: () => unseenCount(['meal', 'activity', 'progress']), unit: 'sin ver' },
  { id: 'activity', label: 'Actividades', hint: 'Ejercicio registrado', icon: 'activity', count: () => unseenCount(['activity']), unit: 'sin ver' },
  { id: 'photos', label: 'Fotos', hint: 'Comidas y progreso', icon: 'image', count: () => unseenCount(['meal', 'progress']), unit: 'sin ver' },
  { id: 'catalog', label: 'Catálogo', hint: 'Tus listas', icon: 'book', count: () => 0 },
  { id: 'pending', label: 'Pendientes', hint: 'Esperan tu acción', icon: 'list', count: () => pendingItems().length, unit: 'pendientes' },
  { id: 'agenda', label: 'Agenda', hint: 'Próximamente', icon: 'calendar', disabled: true },
];
const tabsEl = document.getElementById('tabs');
let current = new URL(location.href).searchParams.get('tab') || 'recent';
if (!TABS.some((t) => t.id === current && !t.disabled)) current = 'recent';
let photoFilter = 'all';

function renderTabs() {
  tabsEl.replaceChildren(...TABS.map((t) => {
    const n = t.count ? t.count() : 0;
    const b = h('button', {
      class: 'plato-home-tab', type: 'button', role: 'tab', id: `tab-${t.id}`, 'aria-controls': 'feed',
      'aria-selected': String(t.id === current), tabindex: t.id === current ? '0' : '-1', 'aria-disabled': t.disabled ? 'true' : null,
      'aria-label': `${t.label}${t.disabled ? ', no disponible todavía' : n ? `, ${n} ${t.unit}` : ''}`,
      onclick: () => { if (!t.disabled) select(t.id, false); },
    },
    h('span', { class: 'plato-home-tab-icon' }, icon(t.icon, 18)),
    h('span', { class: 'plato-home-tab-text' }, h('strong', { text: t.label }), h('small', { text: t.hint })),
    t.disabled ? h('span', { class: 'plato-home-tab-lock', title: 'Disponible cuando exista la agenda' }, icon('lock', 16))
      : n ? h('span', { class: 'plato-home-count', 'aria-hidden': 'true', text: String(n) }) : null);
    return b;
  }));
}
tabsEl.addEventListener('keydown', (e) => {
  const order = TABS.filter((t) => !t.disabled).map((t) => t.id);
  let i = order.indexOf(document.activeElement?.id?.replace('tab-', '') || current);
  if (i < 0) i = order.indexOf(current);
  if (['ArrowRight', 'ArrowDown'].includes(e.key)) i = (i + 1) % order.length;
  else if (['ArrowLeft', 'ArrowUp'].includes(e.key)) i = (i - 1 + order.length) % order.length;
  else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = order.length - 1;
  else return;
  e.preventDefault();
  select(order[i], true);
});
function select(id, focus) {
  current = id;
  limit = PAGE;
  const u = new URL(location.href);
  u.searchParams.set('tab', id);
  history.replaceState(null, '', u);
  renderTabs();
  renderFeed();
  if (focus) document.getElementById(`tab-${id}`).focus();
}

// ---------- Hoy (upgrade 5) ----------
function renderToday() {
  const all = ['meal', 'activity', 'progress'].flatMap((t) => unseen[t]);
  const people = new Set(all.map((r) => r.patient)).size;
  const quiet = patients.filter((p) => p.joined && !recentMeals.has(p.id)).length;
  const noApp = patients.filter((p) => !p.joined).length;
  const line = (cls, n, text) => h('li', { class: cls }, h('span', { class: 'plato-home-dot', 'aria-hidden': 'true' }), n == null ? null : h('b', { text: String(n) }), h('span', { text }));
  document.getElementById('today').replaceChildren(
    line('', all.length, `${all.length === 1 ? 'registro sin ver' : 'registros sin ver'}${people ? ` de ${people} ${people === 1 ? 'paciente' : 'pacientes'}` : ''}`),
    line(quiet ? 'is-warn' : '', quiet, `${quiet === 1 ? 'paciente' : 'pacientes'} sin registrar comidas en 3 días`),
    line(noApp ? 'is-warn' : '', noApp, `${noApp === 1 ? 'paciente' : 'pacientes'} sin la app`),
    h('li', { class: 'is-off' }, h('span', { class: 'plato-home-dot', 'aria-hidden': 'true' }), icon('lock', 14), h('span', { text: 'Citas de hoy: cuando exista la agenda' })));
}

// ---------- Cards ----------
const photoDialog = document.getElementById('photo-dialog');
document.getElementById('ph-close').addEventListener('click', () => photoDialog.close());
photoDialog.addEventListener('click', (e) => { if (e.target === photoDialog) photoDialog.close(); });

function head(l) {
  const p = pmap[l.patient];
  return h('div', { class: 'plato-row plato-row--between' },
    h('a', { class: 'plato-home-person', href: `/patient.html?id=${encodeURIComponent(l.patient)}&tab=log` },
      h('span', { class: 'plato-avatar plato-avatar--sm', 'aria-hidden': 'true', text: initials(p?.name) }),
      h('strong', { text: p?.name || 'Paciente' })),
    h('span', { class: 'plato-muted plato-small', text: `${timeOf(l.created)}${l.date !== dayOf(l.created) ? ` · del ${shortDate(l.date)}` : ''}` }));
}
const dayOf = (created) => localDate(new Date(created.replace(' ', 'T')));

function seenControl(l) {
  if (l.seen_at) return h('span', { class: 'badge', 'data-variant': 'secondary' }, icon('check', 14), 'Vista');
  return h('button', {
    class: 'btn', 'data-size': 'sm', type: 'button', 'aria-label': `Marcar vista: ${titleOf(l)} de ${pmap[l.patient]?.name || 'tu paciente'}`,
    onclick: async (ev) => {
      try { await busy(ev.currentTarget, () => update(COLL[l.type], l.id, { seen_at: nowIso() })); } catch (e) { toast(e.message, 'error'); return; }
      markSeenLocally([l]);
      toast('Marcada como vista. Tu paciente lo verá.');
    },
  }, icon('eye', 16), 'Marcar vista');
}
const titleOf = (l) => l.type === 'meal' ? SLOT_LABEL[l.slot] : l.type === 'progress' ? `Foto de progreso · ${POSE_LABEL[l.pose]}` : 'Actividad física';

function card(l) {
  if (l.type === 'activity') {
    return h('li', { class: 'plato-log-card plato-log-card--activity', dataset: { id: l.id } },
      head(l),
      h('span', { class: 'plato-row' }, h('span', { class: 'plato-activity-icon' }, icon('activity', 18)), h('strong', { text: 'Actividad física' })),
      h('p', { class: 'plato-activity-summary', text: activitySummary(l) }),
      l.note ? h('p', { class: 'plato-log-note', text: l.note }) : null,
      h('div', {}, seenControl(l)));
  }
  const title = titleOf(l);
  const img = h('img', { alt: `${title} de ${pmap[l.patient]?.name || 'tu paciente'}`, loading: 'lazy', width: 400, height: 300 });
  photoUrl(l).then((u) => { img.src = u; }).catch(() => {});
  return h('li', { class: `plato-log-card${l.type === 'progress' ? ' plato-log-card--progress' : ''}`, dataset: { id: l.id } },
    h('button', {
      class: 'plato-photo-btn', type: 'button', 'aria-label': `Ver foto grande: ${title}, ${pmap[l.patient]?.name || ''}`,
      onclick: async () => {
        document.getElementById('ph-title').textContent = `${title} · ${pmap[l.patient]?.name || ''}`;
        document.getElementById('ph-sub').textContent = `${longDate(l.date)} · ${timeOf(l.created)}${l.note ? ` · “${l.note}”` : ''}`;
        const big = document.getElementById('ph-img');
        big.alt = img.alt;
        big.src = await photoUrl(l, '');
        photoDialog.showModal();
      },
    }, img),
    h('div', { class: 'plato-log-body' },
      head(l),
      h('strong', { text: title }),
      l.note ? h('p', { class: 'plato-log-note', text: l.note }) : null,
      feedbackEl(l),
      feedbackControls(l, { title, onSaved: () => reload() }),
      hasFeedback(l) ? null : h('div', {}, seenControl(l))));
}

function byDay(items) {
  const out = [];
  let last = '';
  const today = localDate();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const yesterday = localDate(y);
  for (const l of items) {
    const d = dayOf(l.created);
    if (d !== last) {
      last = d;
      out.push(h('li', { class: 'plato-feed-day', text: d === today ? 'Hoy' : d === yesterday ? 'Ayer' : longDate(d) }));
    }
    out.push(card(l));
  }
  return out;
}

// ---------- Catálogo (client, 2026-10-26) ----------
function catalogCards() {
  const live = (name, desc, href, ic) => h('li', {}, h('a', { class: 'plato-catalog-card', href }, h('span', { class: 'plato-home-tab-icon' }, icon(ic, 18)),
    h('span', { class: 'plato-home-tab-text' }, h('strong', { text: name, title: name }), h('small', { text: desc, title: desc }))));
  const soon = (name, why, ic) => h('li', {}, h('div', { class: 'plato-catalog-card is-locked', 'aria-disabled': 'true' },
    h('span', { class: 'plato-home-tab-icon' }, icon(ic, 18)),
    h('span', { class: 'plato-home-tab-text' }, h('strong', { text: name, title: name }), h('small', { text: `Próximamente · ${why}`, title: `Próximamente · ${why}` })),
    h('span', { class: 'plato-home-tab-lock' }, icon('lock', 16))));
  return [
    live('Pacientes', `${patients.length} ${patients.length === 1 ? 'activo' : 'activos'}`, '/patients.html', 'user'),
    soon('Ingredientes', 'cuando elijamos la fuente de datos', 'list'),
    soon('Recetas', 'con el catálogo de alimentos', 'book'),
    soon('Planes de comidas', 'un día de comidas, con el catálogo', 'clock'),
    live('Dietas', `${templateCount} ${templateCount === 1 ? 'plantilla semanal' : 'plantillas semanales'}`, '/templates.html', 'calendar'),
    soon('Cuestionarios', 'con los formularios de Google del cliente', 'message'),
    soon('Planes de ejercicio', 'con la hoja de Excel del cliente', 'activity'),
  ];
}

function pendingCards() {
  const items = pendingItems();
  if (!items.length) return [h('li', { class: 'plato-empty-state' }, h('strong', { text: 'Todo al día' }), h('span', { text: 'No hay nada esperando tu acción.' }))];
  return items.map((x) => h('li', { class: `plato-pending${x.warn ? ' is-warn' : ''}` },
    h('span', { class: 'plato-activity-icon' }, icon(x.warn ? 'alert' : 'eye', 18)),
    h('div', {}, h('strong', { text: x.p.name, title: x.p.name }), h('p', { text: x.text, title: x.text })),
    h('a', { class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', href: x.href }, x.action)));
}

// ---------- Feed ----------
const SUBS = {
  recent: 'Comidas, actividad y fotos de progreso de tus pacientes, lo más nuevo primero.',
  activity: 'Ejercicio que registraron tus pacientes. La velocidad se calcula sola.',
  photos: 'Fotos de comidas y de progreso. Puedes dar retroalimentación en cada una.',
  catalog: 'Tus listas. Las que dicen “Próximamente” llegan con sus funciones.',
  pending: 'Todo lo que espera una acción tuya. Propuesta: el cliente aún define este tablero.',
};
let renderToken = 0;
async function renderFeed() {
  const token = ++renderToken;
  const t = TABS.find((x) => x.id === current);
  document.getElementById('feed').setAttribute('aria-labelledby', `tab-${current}`);
  document.getElementById('feed-title').textContent = t.label;
  document.getElementById('feed-sub').textContent = SUBS[current];
  const chips = document.getElementById('chips');
  const cards = document.getElementById('cards');
  const status = document.getElementById('feed-status');
  const more = document.getElementById('more');
  chips.replaceChildren();
  more.hidden = true;
  shownItems = [];
  cards.classList.toggle('plato-feed--list', current === 'pending' || current === 'catalog');
  if (current === 'photos') {
    chips.replaceChildren(...[['all', 'Todas'], ['progress', 'Progreso'], ['meal', 'Comidas']].map(([k, l]) =>
      h('button', { class: 'plato-chip', type: 'button', 'aria-pressed': String(photoFilter === k), onclick: () => { photoFilter = k; limit = PAGE; renderFeed(); } }, l)));
  }
  if (current === 'catalog') { status.textContent = ''; cards.replaceChildren(...catalogCards()); renderAllSeen(); return; }
  if (current === 'pending') { status.textContent = ''; cards.replaceChildren(...pendingCards()); renderAllSeen(); return; }
  status.textContent = 'Cargando…';
  let res;
  try { res = await visible(typesFor(current, photoFilter)); } catch (e) { status.textContent = e.message; return; }
  if (token !== renderToken) return; // a newer render started meanwhile
  shownItems = res.shown;
  status.textContent = res.shown.length ? '' : (patients.length ? 'Nada nuevo por aquí todavía.' : 'Aún no tienes pacientes. Agrega el primero en Pacientes.');
  cards.replaceChildren(...byDay(res.shown));
  more.hidden = !res.more;
  renderAllSeen();
}
document.getElementById('more').addEventListener('click', async (ev) => {
  limit += PAGE;
  await busy(ev.currentTarget, () => renderFeed());
});

// "Marcar todo como visto": only what the selected tab shows (layout decision); greyed out when nothing to mark.
const allSeen = document.getElementById('all-seen');
function renderAllSeen() {
  const todo = shownItems.filter((l) => !l.seen_at);
  allSeen.disabled = !todo.length;
  allSeen.replaceChildren(icon('check', 16), `Marcar todo como visto${todo.length ? ` (${todo.length})` : ''}`);
}
allSeen.addEventListener('click', async () => {
  const todo = shownItems.filter((l) => !l.seen_at);
  if (!todo.length || !confirm(`¿Marcar ${todo.length} ${todo.length === 1 ? 'registro' : 'registros'} como ${todo.length === 1 ? 'visto' : 'vistos'}?`)) return;
  const at = nowIso();
  try {
    await busy(allSeen, () => Promise.all(todo.map((l) => update(COLL[l.type], l.id, { seen_at: at }))));
  } catch (e) { toast(e.message, 'error'); await reload(); return; }
  markSeenLocally(todo, at);
  toast('Listo: marcados como vistos.');
});

function markSeenLocally(items, at = nowIso()) {
  const ids = new Set(items.map((l) => l.id));
  for (const l of items) l.seen_at = at;
  for (const t of Object.keys(unseen)) unseen[t] = unseen[t].filter((r) => !ids.has(r.id));
  renderTabs();
  renderToday();
  renderFeed();
}

// ---------- Load / refresh ----------
async function reload() {
  try { await loadAll(); } catch (e) { document.getElementById('feed-status').textContent = e.message; return; }
  renderTabs();
  renderToday();
  await renderFeed();
}
document.getElementById('refresh').addEventListener('click', async (ev) => { await busy(ev.currentTarget, reload); toast('Actualizado.'); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - loadedAt > 30_000) reload(); });

renderTabs();
await reload();
