// home.js — the nutritionist's home (spec "Feature: Patient activity dashboard", slice 3).
// Banner (own photo + live text) · tabs with counts · Hoy summary · cards for the selected tab.
// Not live: refreshes when you come back to the tab, and with "Actualizar" (decision 1).
import { requireRole, list, count, update, photoUrl, signOut, q, SLOT_LABEL, localDate, dateOnly, isCheck } from './api.js';
import { h, icon, toast, busy, offlineBanner, longDate, shortDate, timeOf } from './ui.js';
import { activitySummary } from './activity.js';
import { POSE_LABEL } from './progress-photos.js';
import { feedbackEl, hasFeedback } from './feedback.js';
import { feedbackControls } from './feedback-dialog.js';
import { weekOf, indexLogs, mondayOf, addDays } from './goals.js';
import { face, moodLabel } from './mood.js';
import { loadRange, timeOf as apptTime, timeRange, dayKey, todayKey } from './appointments.js';

offlineBanner();
const me = await requireRole('nutritionists');
document.getElementById('sign-out').addEventListener('click', signOut);

const COLL = { meal: 'meal_logs', mealphoto: 'meal_logs', mealplain: 'meal_logs', activity: 'activity_logs', progress: 'progress_photos', mood: 'mood_logs' };
// Fotos shows meal logs with a photo only (checks have none); same collection, its own page cursor.
// Mood: only low days or days with a note reach Inicio (spec "Feature: Mood check-in"); good days add no noise.
const MOOD_SHOWN = ' && (mood <= 2 || note != "")';
const EXTRA_FILTER = { mealphoto: ' && photo != ""', mealplain: ' && photo = ""', mood: MOOD_SHOWN };
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
let unseen = { meal: [], activity: [], progress: [], mood: [] };
let withDiet = new Set();
let recentMeals = new Set();
let behind = { meal: [], act: [] }; // last full week below the goal (spec "Weekly goals": grouped, never per-patient rows)
let dishCount = 0, dishArchived = 0, ingredientSample = false, ingredientCount = 0, templateCount = 0, templateArchived = 0, patientArchived = 0;
let upcoming = [];   // today's and tomorrow's appointments (not cancelled)
let pools = null;      // per type: { items, cursor, done }
let limit = PAGE;
let shownItems = [];   // what the cards show now (for "Marcar todo como visto")
let loadedAt = 0;

const typesFor = (tab, filter) => tab === 'activity' ? ['activity']
  : tab === 'photos' ? (filter === 'progress' ? ['progress'] : filter === 'meal' ? ['mealphoto'] : ['mealphoto', 'progress'])
  : ['meal', 'activity', 'progress', 'mood'];

async function fetchPage(type) {
  const p = pools[type];
  // Tie-safe cursor: records saved in the same millisecond share "created", so page on (created, id).
  const c = p.last;
  const after = c ? ` && (created < ${q(c.created)} || (created = ${q(c.created)} && id < ${q(c.id)}))` : '';
  const items = await list(COLL[type], { filter: `patient.archived_at = ""${EXTRA_FILTER[type] || ''}${after}`, sort: '-created,-id', perPage: PAGE });
  for (const x of items) x.type = type === 'mealphoto' || type === 'mealplain' ? 'meal' : type;
  p.items.push(...items);
  if (items.length) p.last = items.at(-1);
  if (items.length < PAGE) p.done = true;
}

// Newest-first across collections without loading everything: an item is safe to show once it is newer than
// the oldest item loaded from every collection that may still have more.
const key = (x) => `${x.created}|${x.id}`;
const TOP = '\uffff'; // "nothing loaded yet": sorts above every key
async function visible(types, lim = limit) {
  for (;;) {
    const merged = types.flatMap((t) => pools[t].items).sort((a, b) => key(b).localeCompare(key(a)));
    // (one pool per collection view, so no record appears twice in one tab)
    const open = types.filter((t) => !pools[t].done);
    const edge = (t) => (pools[t].last ? key(pools[t].last) : TOP);
    const boundary = open.length ? open.map(edge).reduce((a, b) => (a > b ? a : b)) : '';
    const safe = boundary ? merged.filter((x) => key(x) >= boundary) : merged;
    if (safe.length > lim || !open.length) return { shown: safe.slice(0, lim), more: safe.length > lim || open.length > 0 };
    await Promise.all(open.filter((t) => edge(t) === boundary).map(fetchPage));
  }
}

async function loadAll() {
  const since = new Date(); since.setDate(since.getDate() - 2); // today and the 2 days before = "3 days"
  // Bare checks (no photo) are not counted as new: they would flood the counts (spec "Weekly goals", slice 1).
  const unseenOf = (t) => list(COLL[t], { filter: `seen_at = "" && patient.archived_at = ""${t === 'meal' ? ' && (photo != "" || slot = "extra")' : t === 'mood' ? MOOD_SHOWN : ''}`, fields: t === 'meal' ? 'id,patient,photo' : 'id,patient', perPage: 500 });
  const [ps, diets, recent, um, ua, up, uo, tpls, archivedPatients, ingredientTotal, ingredientExample, dishTotal, dishOld] = await Promise.all([
    list('patients', { filter: 'archived_at = ""', fields: 'id,name,birth_date,joined,service,meal_goal_days,meal_goal_per_day,activity_goal_days,activity_goal_min,goal_history', sort: 'name', perPage: 500 }),
    list('diets', { fields: 'patient,meals,snacks', perPage: 500 }),
    list('meal_logs', { filter: `date >= ${q(localDate(since))} && patient.archived_at = ""`, fields: 'patient', perPage: 500 }),
    unseenOf('meal'), unseenOf('activity'), unseenOf('progress'), unseenOf('mood'),
    list('diet_templates', { fields: 'id,archived_at', perPage: 500 }),
    count('patients', 'archived_at != ""').catch(() => 0),
    count('ingredients').catch(() => 0),
    count('ingredients', 'dataset = "ejemplo"').catch(() => 0),
    count('dishes', 'archived_at = ""').catch(() => 0),
    count('dishes', 'archived_at != ""').catch(() => 0),
  ]);
  patients = ps;
  pmap = Object.fromEntries(ps.map((p) => [p.id, p]));
  withDiet = new Set(diets.map((d) => d.patient));
  recentMeals = new Set(recent.map((m) => m.patient));
  unseen = { meal: um, activity: ua, progress: up, mood: uo };
  templateCount = tpls.filter((x) => !x.archived_at).length;
  templateArchived = tpls.length - templateCount;
  patientArchived = archivedPatients;
  dishCount = dishTotal; dishArchived = dishOld;
  ingredientCount = ingredientTotal;
  ingredientSample = ingredientTotal > 0 && ingredientExample === ingredientTotal;
  try { upcoming = (await loadRange(todayKey(), addDays(todayKey(), 1))).filter((a) => !a.cancelled_at); } catch { upcoming = []; }
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

// ---------- Pendientes (the "pending dashboard"; name and contents confirmed by the client) ----------
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
  { id: 'recent', label: 'Recientes', hint: 'Lo más nuevo', icon: 'clock', count: () => unseenCount(['meal', 'activity', 'progress', 'mood']), unit: 'sin ver' },
  { id: 'activity', label: 'Actividades', hint: 'Ejercicio registrado', icon: 'activity', count: () => unseenCount(['activity']), unit: 'sin ver' },
  { id: 'photos', label: 'Fotos', hint: 'Comidas y progreso', icon: 'image', count: () => unseenCount(['meal', 'progress']), unit: 'sin ver' },
  { id: 'catalog', label: 'Catálogo', hint: 'Tus listas', icon: 'book', count: () => 0 },
  { id: 'pending', label: 'Pendientes', hint: 'Esperan tu acción', icon: 'list', count: () => pendingItems().length + pendingGroups().length, unit: 'pendientes' },
  { id: 'agenda', label: 'Agenda', hint: 'Hoy y mañana', icon: 'calendar', count: () => todayAppts().length, unit: 'citas hoy' },
];
const tabsEl = document.getElementById('tabs');
let current = new URL(location.href).searchParams.get('tab') || 'recent';
if (!TABS.some((t) => t.id === current && !t.disabled)) current = 'recent';
let photoFilter = 'all';
// "Recientes" view (spec "Design: home Recientes by sections"): 'sections' (default, owner 2026-11-25) or 'list'.
// ?view= in the address wins and is remembered; otherwise this device's last choice.
const VIEW_KEY = 'plato-home-view';
const urlView = new URL(location.href).searchParams.get('view');
let recentView = ['list', 'sections'].includes(urlView) ? urlView : (localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'sections');
if (urlView === recentView) localStorage.setItem(VIEW_KEY, recentView);
const SECTIONS = [
  { id: 'photo', label: 'Con foto', types: ['mealphoto', 'progress'], empty: 'Nada nuevo con foto.',
    unseen: () => unseen.meal.filter((m) => m.photo).length + unseen.progress.length },
  { id: 'plain', label: 'Sin foto', types: ['mealplain', 'activity', 'mood'], empty: 'Nada nuevo sin foto.', compact: true,
    unseen: () => unseen.meal.filter((m) => !m.photo).length + unseen.activity.length + unseen.mood.length },
];
const sectionLimit = { photo: PAGE, plain: PAGE };

// the "Vista" switch: a radio group with arrow keys
function viewSwitch() {
  const opts = [['list', 'Una lista'], ['sections', 'Por secciones']];
  const pick = (v, focus) => {
    recentView = v; localStorage.setItem(VIEW_KEY, v);
    const u = new URL(location.href); u.searchParams.delete('view'); history.replaceState(null, '', u);
    renderFeed().then(() => { if (focus) document.querySelector(`#view-switch [data-view="${v}"]`)?.focus(); });
  };
  const btns = opts.map(([v, l]) => h('button', {
    class: 'plato-chip', type: 'button', role: 'radio', dataset: { view: v },
    'aria-checked': String(recentView === v), 'aria-pressed': String(recentView === v), tabindex: recentView === v ? '0' : '-1',
    onclick: () => { if (recentView !== v) pick(v, false); },
    onkeydown: (ev) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(ev.key)) return;
      ev.preventDefault();
      const other = opts.find(([x]) => x !== v)[0];
      pick(other, true);
    },
  }, l));
  return h('div', { class: 'plato-view-switch', id: 'view-switch', role: 'radiogroup', 'aria-label': 'Vista' },
    h('span', { class: 'plato-muted plato-small', text: 'Vista:' }), ...btns);
}
function sectionHead(s) {
  const n = s.unseen();
  return h('li', { class: 'plato-feed-section', dataset: { section: s.id } },
    h('h3', { id: `sec-${s.id}` }, s.label, n ? h('span', { class: 'plato-muted', text: ` (${n})`, 'aria-label': `, ${n} sin ver` }) : null));
}

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
  const all = ['meal', 'activity', 'progress', 'mood'].flatMap((t) => unseen[t]);
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
    (() => { const tc = todayAppts(), now = Date.now();
      const next = tc.find((a) => new Date(a.starts_at.replace(' ', 'T')).getTime() + a.duration_min * 60000 > now);
      return h('li', {}, h('span', { class: 'plato-home-dot', 'aria-hidden': 'true' }), h('b', { text: String(tc.length) }),
        h('span', { text: `${tc.length === 1 ? 'cita' : 'citas'} hoy${next ? ` · la próxima a las ${apptTime(next.starts_at)} con ${next.expand?.patient?.name || 'tu paciente'}` : ''}` }),
        h('a', { class: 'plato-home-today-link', href: '/agenda.html', text: 'Ver agenda' })); })());
}
const todayAppts = () => upcoming.filter((a) => dayKey(a.starts_at) === todayKey());

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
    h('span', { class: 'plato-log-when plato-muted plato-small' },
      l.seen_at ? h('span', { class: 'plato-seen-mark', title: 'Vista', role: 'img', 'aria-label': 'Vista' }, icon('check', 14), h('span', { class: 'sr-only', text: 'Vista' })) : null,
      h('span', { text: timeOf(l.created) })));
}
// "24 nov" (the year only when it is not this year): keeps the header short enough for the patient's name
const dayMonth = (d) => { const [y, m, dd] = d.slice(0, 10).split('-').map(Number); return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', ...(y !== new Date().getFullYear() ? { year: 'numeric' } : {}) }).format(new Date(y, m - 1, dd)).replace('.', ''); };
const dayOf = (created) => localDate(new Date(created.replace(' ', 'T')));

// Seen: the header shows a small check next to the time (head), so the card needs no row for it.
function seenControl(l) {
  if (l.seen_at) return null;
  return h('button', {
    class: 'btn', 'data-size': 'sm', type: 'button', 'aria-label': `Marcar vista: ${titleOf(l)} de ${pmap[l.patient]?.name || 'tu paciente'}`,
    onclick: async (ev) => {
      try { await busy(ev.currentTarget, () => update(COLL[l.type], l.id, { seen_at: nowIso() })); } catch (e) { toast(e.message, 'error'); return; }
      markSeenLocally([l]);
      toast(l.type === 'mood' ? 'Marcada como vista.' : 'Marcada como vista. Tu paciente lo verá.');
    },
  }, icon('eye', 16), 'Marcar vista');
}
const titleOf = (l) => l.type === 'meal' ? SLOT_LABEL[l.slot] : l.type === 'progress' ? `Foto de progreso · ${POSE_LABEL[l.pose]}` : l.type === 'mood' ? `Ánimo: ${moodLabel(l.mood)}` : 'Actividad física';

// Every card has the same anatomy (owner comments, 2026-11-25): header / photo (photo cards) / title / detail / note or feedback /
// one row of buttons in the same style. Only what is inside changes from one kind to another.
function card(l) {
  const photo = !!l.photo;
  const title = l.type === 'meal' && !photo ? (l.slot === 'extra' ? 'Comida extra' : SLOT_LABEL[l.slot]) : l.type === 'mood' ? 'Ánimo' : titleOf(l);
  const detail = l.type === 'mood' ? h('p', { class: 'plato-log-detail' }, face(l.mood, 18), h('span', { text: moodLabel(l.mood) }))
    : l.type === 'activity' ? h('p', { class: 'plato-log-detail plato-activity-summary', text: activitySummary(l) })
    : l.type === 'meal' && !photo && l.slot !== 'extra' ? h('p', { class: 'plato-log-detail' }, h('span', { class: 'plato-ate', text: 'lo comió' }))
    : null;
  const note = l.note ? h('p', { class: 'plato-log-note', text: l.type === 'mood' ? `“${l.note}”` : l.note }) : null;
  const kind = l.type === 'mood' ? ' plato-log-card--mood' : l.type === 'activity' ? ' plato-log-card--activity' : l.type === 'progress' ? ' plato-log-card--progress' : !photo ? ' plato-log-card--check' : '';
  let pic = null;
  if (photo) {
    const img = h('img', { alt: `${title} de ${pmap[l.patient]?.name || 'tu paciente'}`, loading: 'lazy', width: 400, height: 300 });
    photoUrl(l).then((u) => { img.src = u; }).catch(() => {});
    pic = h('button', {
      class: 'plato-photo-btn', type: 'button', 'aria-label': `Ver foto grande: ${title}, ${pmap[l.patient]?.name || ''}`,
      onclick: async () => {
        document.getElementById('ph-title').textContent = `${title} · ${pmap[l.patient]?.name || ''}`;
        document.getElementById('ph-sub').textContent = `${longDate(l.date)} · ${timeOf(l.created)}${l.note ? ` · “${l.note}”` : ''}`;
        const big = document.getElementById('ph-img');
        big.alt = img.alt;
        big.src = await photoUrl(l, '');
        photoDialog.showModal();
      },
    }, img);
  }
  const feedback = photo ? feedbackEl(l) : null;
  const buttons = photo ? actions(feedbackControls(l, { title, onSaved: () => reload() }), hasFeedback(l) ? null : seenControl(l)) : actions(seenControl(l));
  return h('li', { class: `plato-log-card${kind}`, dataset: { id: l.id } },
    head(l), pic,
    h('div', { class: 'plato-log-body' },
      h('p', { class: 'plato-log-title' }, h('strong', { text: title }), l.date !== dayOf(l.created) ? h('span', { class: 'plato-muted plato-small', text: ` · del ${dayMonth(l.date)}` }) : null),
      detail, note, feedback),
    buttons);
}
// one row of buttons, every one the same style (outline, small) whatever module made it
function actions(...items) {
  const row = h('div', { class: 'plato-log-actions' }, ...items.filter(Boolean));
  for (const b of row.querySelectorAll('button')) { b.dataset.variant = 'outline'; b.dataset.size = 'sm'; }
  return row;
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
    live('Pacientes', `${patients.length} ${patients.length === 1 ? 'activo' : 'activos'}${patientArchived ? ` · ${patientArchived} ${patientArchived === 1 ? 'archivado' : 'archivados'}` : ''}`, '/patients.html', 'user'),
    live('Ingredientes', `${ingredientCount} ${ingredientCount === 1 ? 'ingrediente' : 'ingredientes'}${ingredientSample ? ' · de ejemplo' : ''}`, '/ingredients.html', 'list'),
    live('Recetas', `${dishCount} ${dishCount === 1 ? 'receta' : 'recetas'}${dishArchived ? ` · ${dishArchived} ${dishArchived === 1 ? 'archivada' : 'archivadas'}` : ''}`, '/dishes.html', 'book'),
    soon('Planes de comidas', 'un día de comidas, con el catálogo', 'clock'),
    live('Dietas', `${templateCount} ${templateCount === 1 ? 'plantilla semanal' : 'plantillas semanales'}${templateArchived ? ` · ${templateArchived} ${templateArchived === 1 ? 'archivada' : 'archivadas'}` : ''}`, '/templates.html', 'calendar'),
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

// ---------- Agenda tab: today's and tomorrow's appointments ----------
function agendaCards() {
  const today = todayKey(), tomorrow = addDays(today, 1);
  const group = (ymd, title) => {
    const items = upcoming.filter((a) => dayKey(a.starts_at) === ymd);
    return h('li', { class: 'plato-agenda-day' },
      h('h3', { class: 'plato-agenda-group', text: title }),
      items.length
        ? h('ul', { class: 'plato-appts' }, ...items.map((a) => h('li', { class: 'plato-appt', dataset: { appt: a.id } },
          h('div', { class: 'plato-appt-time' }, h('strong', { text: apptTime(a.starts_at) }), h('small', { text: `${a.duration_min} min` })),
          h('span', { class: 'plato-avatar plato-avatar--sm', 'aria-hidden': 'true', text: initials(a.expand?.patient?.name) }),
          h('div', { class: 'plato-appt-body' },
            h('p', { class: 'plato-appt-line' }, 'Cita con ', a.expand?.patient
              ? h('a', { href: `/patient.html?id=${encodeURIComponent(a.patient)}`, text: a.expand.patient.name }) : h('span', { text: 'paciente' })),
            h('div', { class: 'plato-row' }, h('span', { class: 'badge plato-appt-type', text: a.type }))),
          h('div', { class: 'plato-appt-actions' },
            h('a', { class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', href: `/agenda.html?day=${ymd}`, 'aria-label': `Ver el ${title.toLowerCase()} en la agenda` }, 'Ver día')))))
        : h('p', { class: 'plato-muted plato-small', style: 'margin:0', text: 'Sin citas.' }));
  };
  return [group(today, 'Hoy'), group(tomorrow, 'Mañana'),
    h('li', { class: 'plato-row' }, h('a', { class: 'btn', href: '/agenda.html' }, icon('calendar', 16), 'Abrir la agenda'),
      h('a', { class: 'btn', 'data-variant': 'outline', href: '/agenda.html?new=1' }, 'Nueva cita'))];
}

// ---------- Feed ----------
const SUBS = {
  recent: 'Comidas, actividad y fotos de progreso de tus pacientes, lo más nuevo primero.',
  activity: 'Ejercicio que registraron tus pacientes. La velocidad se calcula sola.',
  photos: 'Fotos de comidas y de progreso. Puedes dar retroalimentación en cada una.',
  catalog: 'Tus listas. Las que dicen “Próximamente” llegan con sus funciones.',
  pending: 'Todo lo que espera una acción tuya.',
  agenda: 'Tus citas de hoy y de mañana. La agenda completa tiene el calendario.',
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
  cards.classList.toggle('plato-feed--agenda', current === 'agenda');
  if (current === 'photos') {
    chips.replaceChildren(...[['all', 'Todas'], ['progress', 'Progreso'], ['meal', 'Comidas']].map(([k, l]) =>
      h('button', { class: 'plato-chip', type: 'button', 'aria-pressed': String(photoFilter === k), onclick: () => { photoFilter = k; limit = PAGE; renderFeed(); } }, l)));
  }
  if (current === 'recent') chips.replaceChildren(viewSwitch());
  cards.classList.toggle('plato-feed--sections', current === 'recent' && recentView === 'sections');
  if (current === 'recent' && recentView === 'sections') return renderSections(token);
  if (current === 'agenda') { status.textContent = ''; cards.replaceChildren(...agendaCards()); return; }
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
// "Por secciones": Con foto first, then Sin foto; each newest first with its own day labels and its own "Ver más"
async function renderSections(token) {
  const cards = document.getElementById('cards');
  const status = document.getElementById('feed-status');
  status.textContent = 'Cargando…';
  let res;
  try { res = await Promise.all(SECTIONS.map((s) => visible(s.types, sectionLimit[s.id]))); } catch (e) { status.textContent = e.message; return; }
  if (token !== renderToken) return;
  status.textContent = patients.length ? '' : 'Aún no tienes pacientes. Agrega el primero en Pacientes.';
  shownItems = res.flatMap((r) => r.shown);
  const out = [];
  SECTIONS.forEach((s, i) => {
    const r = res[i];
    out.push(sectionHead(s));
    if (!r.shown.length) out.push(h('li', { class: 'plato-feed-none plato-muted', dataset: { section: s.id }, text: s.empty }));
    for (const el of byDay(r.shown)) {
      el.dataset.section = s.id;
      if (s.compact && el.classList.contains('plato-log-card')) el.classList.add('plato-log-card--compact');
      out.push(el);
    }
    if (r.more) out.push(h('li', { class: 'plato-feed-more', dataset: { section: s.id } },
      h('button', { class: 'btn', type: 'button', dataset: { variant: 'outline' }, 'aria-label': `Ver más: ${s.label}`,
        onclick: async (ev) => { sectionLimit[s.id] += PAGE; await busy(ev.currentTarget, () => renderFeed()); } }, 'Ver más')));
  });
  cards.replaceChildren(...out);
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
