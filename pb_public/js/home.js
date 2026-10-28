// home.js — the nutritionist's home (spec "Feature: Patient activity dashboard", slice 3).
// Banner (own photo + live text) · tabs with counts · Hoy summary · cards for the selected tab.
// Not live: refreshes when you come back to the tab, and with "Actualizar" (decision 1).
import { requireRole, list, update, photoUrl, signOut, q, SLOT_LABEL, localDate, dateOnly, isCheck } from './api.js';
import { h, icon, toast, busy, offlineBanner, longDate, shortDate, timeOf } from './ui.js';
import { activitySummary } from './activity.js';
import { POSE_LABEL } from './progress-photos.js';
import { feedbackEl, hasFeedback } from './feedback.js';
import { feedbackControls } from './feedback-dialog.js';
import { weekOf, indexLogs, mondayOf, addDays } from './goals.js';

offlineBanner();
const me = await requireRole('nutritionists');
document.getElementById('sign-out').addEventListener('click', signOut);

const COLL = { meal: 'meal_logs', mealphoto: 'meal_logs', activity: 'activity_logs', progress: 'progress_photos' };
// Fotos shows meal logs with a photo only (checks have none); same collection, its own page cursor.
const EXTRA_FILTER = { mealphoto: ' && photo != ""' };
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
let behind = { meal: [], act: [] }; // last full week below the goal (spec "Weekly goals": grouped, never per-patient rows)
let templateCount = 0;
let pools = null;      // per type: { items, cursor, done }
let limit = PAGE;
let shownItems = [];   // what the cards show now (for "Marcar todo como visto")
let loadedAt = 0;

const typesFor = (tab, filter) => tab === 'activity' ? ['activity']
  : tab === 'photos' ? (filter === 'progress' ? ['progress'] : filter === 'meal' ? ['mealphoto'] : ['mealphoto', 'progress'])
  : ['meal', 'activity', 'progress'];

async function fetchPage(type) {
  const p = pools[type];
  // Tie-safe cursor: records saved in the same millisecond share "created", so page on (created, id).
  const c = p.last;
  const after = c ? ` && (created < ${q(c.created)} || (created = ${q(c.created)} && id < ${q(c.id)}))` : '';
  const items = await list(COLL[type], { filter: `patient.archived_at = ""${EXTRA_FILTER[type] || ''}${after}`, sort: '-created,-id', perPage: PAGE });
  for (const x of items) x.type = type === 'mealphoto' ? 'meal' : type;
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
    // (one pool per collection view, so no record appears twice in one tab)
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
  // Bare checks (no photo) are not counted as new: they would flood the counts (spec "Weekly goals", slice 1).
  const unseenOf = (t) => list(COLL[t], { filter: `seen_at = "" && patient.archived_at = ""${t === 'meal' ? ' && (photo != "" || slot = "extra")' : ''}`, fields: 'id,patient', perPage: 500 });
  const [ps, diets, recent, um, ua, up, tpls] = await Promise.all([
    list('patients', { filter: 'archived_at = ""', fields: 'id,name,birth_date,joined,service,meal_goal_days,meal_goal_per_day,activity_goal_days,activity_goal_min,goal_history', sort: 'name', perPage: 500 }),
    list('diets', { fields: 'patient,meals', perPage: 500 }),
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
  // Last full week (Monday to Sunday before this one)
  const lastMon = addDays(mondayOf(), -7), lastSun = addDays(lastMon, 6);
  const wf = `date >= ${q(lastMon)} && date <= ${q(lastSun)} && patient.archived_at = ""`;
  const [wm, wa] = await Promise.all([
    list('meal_logs', { filter: wf, fields: 'patient,date,slot', perPage: 1000 }),
    list('activity_logs', { filter: wf, fields: 'patient,date,minutes', perPage: 1000 }),
  ]);
  const by = (rows) => rows.reduce((m, r) => ((m[r.patient] ||= []).push(r), m), {});
  const mm = by(wm), am = by(wa), dm = Object.fromEntries(diets.map((d) => [d.patient, d]));
  behind = { meal: [], act: [] };
  for (const p of ps) {
    if (!p.joined) continue; // not using the app yet: its own setup row
    const idx = indexLogs(mm[p.id] || [], am[p.id] || []);
    for (const k of ['meal', 'act']) {
      const w = weekOf(k, p, dm[p.id], idx, lastMon);
      if (w.goal && w.met < w.goal.days) behind[k].push({ p, met: w.met, days: w.goal.days });
    }
  }
  for (const k of ['meal', 'act']) behind[k].sort((a, b) => a.met - b.met || a.p.name.localeCompare(b.p.name));
  pools = Object.fromEntries(Object.keys(COLL).map((k) => [k, { items: [], last: null, done: false }]));
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
    if (!dateOnly(p.birth_date)) items.push({ warn: true, p, text: 'Falta su fecha de nacimiento.', action: 'Agregar', href: go('') });
  }
  return items;
}

// Grouped rows: one per kind, however many patients (spec "Weekly goals": many patients go "silent").
function pendingGroups() {
  const quiet = patients.filter((p) => p.joined && !recentMeals.has(p.id)).map((p) => ({ p, text: 'Sin comidas desde hace 3 días o más' }));
  const g = [];
  if (behind.meal.length) g.push({ key: 'meal', n: behind.meal.length, title: `${behind.meal.length} ${behind.meal.length === 1 ? 'paciente no cumplió su meta' : 'pacientes no cumplieron su meta'} de comidas la semana pasada`,
    people: behind.meal.map((x) => ({ p: x.p, text: `${x.met} de ${x.days} días` })) });
  if (behind.act.length) g.push({ key: 'act', n: behind.act.length, title: `${behind.act.length} ${behind.act.length === 1 ? 'paciente no cumplió su meta' : 'pacientes no cumplieron su meta'} de actividad la semana pasada`,
    people: behind.act.map((x) => ({ p: x.p, text: `${x.met} de ${x.days} días` })) });
  if (quiet.length) g.push({ key: 'quiet', n: quiet.length, title: `${quiet.length} ${quiet.length === 1 ? 'paciente no registra' : 'pacientes no registran'} comidas desde hace 3 días o más`, people: quiet });
  return g;
}

function groupCard(g) {
  let shown = 10;
  const listEl = h('ol', { class: 'plato-group-list', id: `grp-${g.key}`, hidden: true });
  const more = h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', hidden: true }, 'Ver más');
  const fill = () => {
    listEl.replaceChildren(...g.people.slice(0, shown).map((x) => h('li', {},
      h('a', { href: `/patient.html?id=${encodeURIComponent(x.p.id)}&tab=log` }, x.p.name), h('span', { class: 'plato-muted', text: x.text }))));
    more.hidden = listEl.hidden || g.people.length <= shown;
  };
  more.addEventListener('click', () => { shown += 10; fill(); });
  const toggle = h('button', { class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', type: 'button', 'aria-expanded': 'false', 'aria-controls': `grp-${g.key}` }, 'Ver lista');
  toggle.addEventListener('click', () => {
    listEl.hidden = !listEl.hidden;
    toggle.setAttribute('aria-expanded', String(!listEl.hidden));
    toggle.textContent = listEl.hidden ? 'Ver lista' : 'Ocultar lista';
    fill();
  });
  return h('section', { class: 'plato-pending-group', dataset: { group: g.key } },
    h('div', { class: 'plato-pending-group-head' },
      h('span', { class: 'plato-activity-icon' }, icon(g.key === 'act' ? 'activity' : g.key === 'meal' ? 'list' : 'clock', 18)),
      h('p', { text: g.title }), toggle),
    listEl, more);
}

// ---------- Tabs (upgrades 3, 4, 6, 7, 8) ----------
const unseenCount = (types) => types.reduce((n, t) => n + unseen[t].length, 0);
const TABS = [
  { id: 'recent', label: 'Recientes', hint: 'Lo más nuevo', icon: 'clock', count: () => unseenCount(['meal', 'activity', 'progress']), unit: 'sin ver' },
  { id: 'activity', label: 'Actividades', hint: 'Ejercicio registrado', icon: 'activity', count: () => unseenCount(['activity']), unit: 'sin ver' },
  { id: 'photos', label: 'Fotos', hint: 'Comidas y progreso', icon: 'image', count: () => unseenCount(['meal', 'progress']), unit: 'sin ver' },
  { id: 'catalog', label: 'Catálogo', hint: 'Tus listas', icon: 'book', count: () => 0 },
  { id: 'pending', label: 'Pendientes', hint: 'Esperan tu acción', icon: 'list', count: () => pendingItems().length + pendingGroups().length, unit: 'pendientes' },
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
    (() => { const n = new Set([...behind.meal, ...behind.act].map((x) => x.p.id)).size;
      return line(n ? 'is-warn' : '', n, `${n === 1 ? 'paciente' : 'pacientes'} por debajo de su meta la semana pasada`); })(),
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
  if (l.type === 'meal' && !l.photo) {   // a check ("lo comió") or an extra with only a note
    const extra = l.slot === 'extra';
    return h('li', { class: 'plato-log-card plato-log-card--check', dataset: { id: l.id } },
      head(l),
      h('span', { class: 'plato-row' }, h('span', { class: 'plato-activity-icon' }, icon(extra ? 'plus' : 'check', 16)),
        h('strong', { text: extra ? 'Comida extra' : SLOT_LABEL[l.slot] }), extra ? null : h('span', { class: 'plato-muted plato-small', text: 'lo comió' })),
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
  if (!items.length && pendingGroups().length) return [];
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
  const groupsEl = document.getElementById('groups');
  chips.replaceChildren();
  groupsEl.replaceChildren();
  more.hidden = true;
  shownItems = [];
  cards.classList.toggle('plato-feed--list', current === 'pending' || current === 'catalog');
  if (current === 'photos') {
    chips.replaceChildren(...[['all', 'Todas'], ['progress', 'Progreso'], ['meal', 'Comidas']].map(([k, l]) =>
      h('button', { class: 'plato-chip', type: 'button', 'aria-pressed': String(photoFilter === k), onclick: () => { photoFilter = k; limit = PAGE; renderFeed(); } }, l)));
  }
  if (current === 'catalog') { status.textContent = ''; cards.replaceChildren(...catalogCards()); renderAllSeen(); return; }
  if (current === 'pending') { status.textContent = ''; groupsEl.replaceChildren(...pendingGroups().map(groupCard)); cards.replaceChildren(...pendingCards()); renderAllSeen(); return; }
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
