// patient.js — one patient, seen by their nutritionist: measurements, diet, meal photos, private notes, access link.
import {
  requireRole, view, list, create, update, remove, newInvite, closeAccount, reopenAccount, photoUrl, signOut, q,
  SLOTS, SLOT_LABEL, WEEKDAYS, localDate, dateOnly,
} from './api.js';
import { h, icon, toast, formError, busy, offlineBanner, wireTabs, age, longDate, shortDate, timeOf, num } from './ui.js';
import { activitySummary } from './activity.js';
import { weekList, cleanMeals, daysFilled } from './week.js';
import { POSE_LABEL } from './progress-photos.js';
import { weightChart } from './charts.js';

offlineBanner();
const me = await requireRole('nutritionists');
document.getElementById('clinic').textContent = me.clinic_name || '';
document.getElementById('sign-out').addEventListener('click', signOut);

const id = new URL(location.href).searchParams.get('id') || '';
const statusEl = document.getElementById('status');
let patient;
try {
  patient = await view('patients', id);
} catch (e) {
  statusEl.textContent = e.status === 404 ? 'No encontrado. Este paciente no existe o no es tuyo.' : e.message;
  await new Promise(() => {}); // stop here: the message is the whole page (no uncaught error)
}
statusEl.hidden = true;
document.getElementById('content').hidden = false;
document.title = `${patient.name} — Plato`;

const pid = q(patient.id);
// A closed (archived) account is read-only: no edit controls anywhere. The server rules enforce it too.
const closed = !!patient.archived_at;

// ---------- Header ----------
function renderHead() {
  document.getElementById('p-name').textContent = patient.name;
  document.getElementById('p-initials').textContent = patient.name.split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('');
  const a = age(dateOnly(patient.birth_date));
  document.getElementById('p-meta').textContent = [
    patient.sex === 'female' ? 'Mujer' : 'Hombre',
    a != null ? `${a} años` : null,
    patient.height_cm ? `${num(patient.height_cm)} cm` : null,
    closed ? `Cuenta cerrada el ${shortDate(patient.archived_at)}` : patient.joined ? 'Usa la app' : 'Aún sin app',
  ].filter(Boolean).join(' · ');
  document.getElementById('closed-banner').hidden = !closed;
  if (closed) document.getElementById('closed-title').textContent = `Cuenta cerrada el ${longDate(patient.archived_at).toLowerCase()}`;
}
renderHead();

// ---------- Overview / measurements ----------
let measurements = [];
const mForm = document.getElementById('m-form');
mForm.date.value = localDate();
mForm.hidden = closed;

async function loadMeasurements() {
  measurements = await list('measurements', { filter: `patient = ${pid}`, sort: 'date,created' });
  renderMeasurements();
}

function renderMeasurements() {
  const last = measurements.at(-1);
  const first = measurements[0];
  const stats = document.getElementById('stats');
  const bmi = last && patient.height_cm ? last.weight_kg / (patient.height_cm / 100) ** 2 : null;
  const stat = (label, value) => h('div', { class: 'plato-stat' }, h('span', { text: label }), h('strong', { text: value }));
  stats.replaceChildren(
    stat('Peso actual', last ? `${num(last.weight_kg)} kg` : '—'),
    stat('Cambio total', last && first !== last ? `${last.weight_kg - first.weight_kg > 0 ? '+' : ''}${num(last.weight_kg - first.weight_kg)} kg` : '—'),
    stat('Grasa', last?.body_fat_pct ? `${num(last.body_fat_pct)} %` : '—'),
    stat('Cintura', last?.waist_cm ? `${num(last.waist_cm)} cm` : '—'),
    stat('IMC', bmi ? num(bmi) : '—'),
  );
  document.getElementById('chart').replaceChildren(weightChart(measurements));
  const rows = document.getElementById('m-rows');
  rows.replaceChildren();
  if (!measurements.length) {
    rows.append(h('tr', {}, h('td', { colspan: 5, class: 'plato-muted', text: closed ? 'Sin mediciones.' : 'Aún no hay mediciones. Agrega la primera arriba.' })));
  }
  for (const m of [...measurements].reverse()) {
    const d = dateOnly(m.date);
    rows.append(h('tr', {},
      h('td', { text: shortDate(d) }),
      h('td', { class: 'num', text: num(m.weight_kg) }),
      h('td', { class: 'num', text: m.body_fat_pct ? num(m.body_fat_pct) : '—' }),
      h('td', { class: 'num', text: m.waist_cm ? num(m.waist_cm) : '—' }),
      h('td', { class: 'num' }, closed ? null : h('button', {
        class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button',
        'aria-label': `Borrar medición del ${shortDate(d)}`,
        onclick: async () => {
          if (!confirm(`¿Borrar la medición del ${shortDate(d)}?`)) return;
          try { await remove('measurements', m.id); } catch (e) { toast(e.message, 'error'); return; }
          await loadMeasurements();
          toast('Medición borrada.');
        },
      }, icon('trash', 16)))));
  }
}

mForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(mForm, '');
  if (!mForm.reportValidity()) return;
  const d = Object.fromEntries(new FormData(mForm));
  const body = { patient: patient.id, date: `${d.date} 12:00:00.000Z`, weight_kg: Number(d.weight_kg) };
  if (d.body_fat_pct) body.body_fat_pct = Number(d.body_fat_pct);
  if (d.waist_cm) body.waist_cm = Number(d.waist_cm);
  try {
    await busy(mForm.querySelector('[type=submit]'), () => create('measurements', body));
  } catch (err) { formError(mForm, err.message); return; }
  mForm.reset();
  mForm.date.value = localDate();
  await loadMeasurements();
  toast('Medición guardada.');
});

// ---------- Diet ----------
const dietForm = document.getElementById('diet-form');
const dayBtns = document.getElementById('days');
const mealFields = document.getElementById('meal-fields');
const dietState = document.getElementById('diet-state');
let diet = null;
let meals = {};
let day = 1;
let dirty = false;

const dayMeals = (d) => (meals[d] ||= {});
const filledSlots = (d) => SLOTS.filter(([k]) => (meals[d]?.[k] || '').trim()).length;

function setDirty(v) {
  dirty = v;
  dietState.textContent = v ? 'Cambios sin guardar' : diet ? `Guardada ${shortDate(diet.updated)}` : 'Aún no hay dieta';
}
addEventListener('beforeunload', (e) => { if (dirty) e.preventDefault(); });

function renderDays() {
  dayBtns.replaceChildren(...WEEKDAYS.map((name, i) => {
    const d = i + 1;
    const n = filledSlots(d);
    return h('button', {
      class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', type: 'button', 'aria-pressed': String(d === day),
      'aria-label': `${name}, ${n} de 5 comidas`,
      onclick: () => { day = d; renderDays(); renderMeals(); },
    }, name.slice(0, 3), n ? h('span', { class: 'plato-day-dot', 'aria-hidden': 'true' }) : null);
  }));
}

function renderMeals() {
  document.getElementById('day-title').textContent = WEEKDAYS[day - 1];
  mealFields.replaceChildren(...SLOTS.map(([key, label]) => {
    const fid = `meal-${key}`;
    const ta = h('textarea', { class: 'textarea', id: fid, rows: 2, maxlength: 600, placeholder: key.startsWith('snack') ? 'Ej. 1 manzana y 10 almendras' : 'Ej. 2 huevos a la mexicana, 2 tortillas, 1 taza de papaya' });
    ta.value = dayMeals(day)[key] || '';
    ta.readOnly = closed;
    ta.addEventListener('input', () => {
      dayMeals(day)[key] = ta.value;
      setDirty(true);
      renderDays();
    });
    return h('div', { class: 'plato-meal-field' },
      h('label', { for: fid }, h('span', { class: 'plato-swatch', style: `--swatch: var(--slot-${key})`, 'aria-hidden': 'true' }), label),
      ta);
  }));
}

document.getElementById('copy-day').addEventListener('click', () => {
  if (!confirm(`¿Copiar las comidas del ${WEEKDAYS[day - 1].toLowerCase()} a todos los días? Reemplaza lo que haya.`)) return;
  for (let d = 1; d <= 7; d++) if (d !== day) meals[d] = { ...dayMeals(day) };
  setDirty(true);
  renderDays();
  toast('Copiado a toda la semana. Falta guardar.');
});

dietForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(dietForm, '');
  // Trim and drop empty slots so the patient app only shows planned meals.
  const clean = cleanMeals(meals);
  const body = { title: dietForm.title.value.trim(), meals: clean };
  try {
    diet = await busy(dietForm.querySelector('[type=submit]'), () =>
      diet ? update('diets', diet.id, body) : create('diets', { ...body, patient: patient.id }));
  } catch (err) { formError(dietForm, err.message); return; }
  meals = structuredClone(clean);
  setDirty(false);
  renderDays();
  renderMeals();
  toast('Dieta guardada. Tu paciente ya la ve en su app.');
});

// ---------- Templates (spec "Saved diet templates") ----------
// Save what is on screen as a private template; or copy a template into the editor (unsaved until "Guardar dieta").
const stDialog = document.getElementById('st-dialog');
const stForm = document.getElementById('st-form');
const stName = document.getElementById('st-name');
const stConflict = document.getElementById('st-conflict');
let stExisting = null;
for (const id of ['st-cancel', 'st-x']) document.getElementById(id).addEventListener('click', () => stDialog.close());
stDialog.addEventListener('click', (e) => { if (e.target === stDialog) stDialog.close(); });
// While the name is taken, the choice is Reemplazar or Guardar como copia (the main button hides).
const showConflict = (on) => { stConflict.hidden = !on; document.getElementById('st-save').hidden = on; };
stName.addEventListener('input', () => { showConflict(false); stExisting = null; });

document.getElementById('save-template').addEventListener('click', () => {
  if (!Object.keys(cleanMeals(meals)).length) { toast('La semana está vacía. Escribe al menos una comida.', 'error'); return; }
  stForm.reset();
  formError(stForm, '');
  showConflict(false);
  stExisting = null;
  stName.value = dietForm.title.value.trim();
  stDialog.showModal();
  stName.focus();
  stName.select();
});

async function saveTemplate(mode) {
  const title = stName.value.trim();
  const body = { title, meals: cleanMeals(meals) };
  if (mode === 'replace') return update('diet_templates', stExisting.id, body);
  if (mode === 'copy') {
    const taken = new Set((await list('diet_templates', { fields: 'title', perPage: 500 })).map((t) => t.title));
    let n = 1, name;
    do { name = `${title} (copia${n > 1 ? ` ${n}` : ''})`; n++; } while (taken.has(name));
    return create('diet_templates', { ...body, title: name.slice(0, 120), nutritionist: me.id });
  }
  return create('diet_templates', { ...body, nutritionist: me.id });
}
async function finishSave(mode, button) {
  formError(stForm, '');
  try {
    const t = await busy(button, () => saveTemplate(mode));
    stDialog.close();
    toast(`Plantilla guardada: ${t.title}`);
  } catch (err) { formError(stForm, err.message); }
}
stForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(stForm, '');
  if (!stForm.reportValidity()) return;
  const title = stName.value.trim();
  if (!title) { stName.setCustomValidity('Escribe un nombre.'); stForm.reportValidity(); stName.setCustomValidity(''); return; }
  try {
    [stExisting] = await list('diet_templates', { filter: `title = ${q(title)}`, perPage: 1 });
  } catch (err) { formError(stForm, err.message); return; }
  if (stExisting) {
    document.getElementById('st-conflict-title').textContent = `Ya tienes una plantilla llamada “${title}”.`;
    showConflict(true);
    document.getElementById('st-replace').focus();
    return;
  }
  await finishSave('new', document.getElementById('st-save'));
});
document.getElementById('st-replace').addEventListener('click', (e) => finishSave('replace', e.currentTarget));
document.getElementById('st-copy').addEventListener('click', (e) => finishSave('copy', e.currentTarget));

const utDialog = document.getElementById('ut-dialog');
const utList = document.getElementById('ut-list');
const utPreview = document.getElementById('ut-preview');
const utStatus = document.getElementById('ut-status');
const utUse = document.getElementById('ut-use');
let utTemplates = [];
for (const id of ['ut-cancel', 'ut-x']) document.getElementById(id).addEventListener('click', () => utDialog.close());
utDialog.addEventListener('click', (e) => { if (e.target === utDialog) utDialog.close(); });

document.getElementById('use-template').addEventListener('click', async () => {
  utList.querySelectorAll('label').forEach((l) => l.remove());
  utPreview.replaceChildren();
  utUse.disabled = true;
  utStatus.hidden = false;
  utStatus.textContent = 'Cargando…';
  utDialog.showModal();
  try {
    utTemplates = await list('diet_templates', { sort: 'title', perPage: 200 });
  } catch (err) { utStatus.textContent = err.message; return; }
  if (!utTemplates.length) {
    utStatus.textContent = 'Aún no tienes plantillas. Abre la dieta de un paciente y toca “Guardar como plantilla”.';
    return;
  }
  utStatus.hidden = true;
  for (const t of utTemplates) {
    const input = h('input', { type: 'radio', name: 'ut-pick', value: t.id });
    input.addEventListener('change', () => {
      utPreview.replaceChildren(weekList(t.meals || {}));
      utUse.disabled = false;
    });
    const n = daysFilled(t.meals);
    utList.append(h('label', { class: 'plato-template-option' }, input,
      h('span', { class: 'plato-stack-sm' },
        h('strong', { text: t.title }),
        h('span', { class: 'plato-muted plato-small', text: `${n} ${n === 1 ? 'día' : 'días'} con comidas · cambiada ${shortDate(t.updated)}` }))));
  }
});

utUse.addEventListener('click', () => {
  const t = utTemplates.find((x) => x.id === utList.querySelector('input:checked')?.value);
  if (!t) return;
  const hasCurrent = !!diet || Object.keys(cleanMeals(meals)).length > 0;
  if (hasCurrent && !confirm(`¿Reemplazar la dieta actual de ${patient.name} con esta plantilla? Podrás revisarla antes de guardar.`)) return;
  meals = structuredClone(t.meals || {});
  dietForm.title.value = t.title;
  day = 1;
  setDirty(true);
  renderDays();
  renderMeals();
  utDialog.close();
  toast('Plantilla copiada. Revísala y toca “Guardar dieta”.');
});

async function loadDiet() {
  [diet] = await list('diets', { filter: `patient = ${pid}` });
  meals = structuredClone(diet?.meals || {});
  dietForm.title.value = diet?.title || '';
  dietForm.title.readOnly = closed;
  document.getElementById('copy-day').hidden = closed;
  document.getElementById('use-template').hidden = closed;
  dietForm.querySelector('[type=submit]').hidden = closed;
  setDirty(false);
  renderDays();
  renderMeals();
}

// ---------- Meal photos ----------
const feed = document.getElementById('feed');
const logStatus = document.getElementById('log-status');
const logCount = document.getElementById('log-count');
const photoDialog = document.getElementById('photo-dialog');
document.getElementById('ph-close').addEventListener('click', () => photoDialog.close());
photoDialog.addEventListener('click', (e) => { if (e.target === photoDialog) photoDialog.close(); });

// Meals and physical activity in one feed, newest first (date, then time sent).
let logs = [];
async function loadLogs() {
  const [meals, acts, progress] = await Promise.all([
    list('meal_logs', { filter: `patient = ${pid}`, sort: '-date,-created', perPage: 120 }),
    list('activity_logs', { filter: `patient = ${pid}`, sort: '-date,-created', perPage: 120 }),
    list('progress_photos', { filter: `patient = ${pid}`, sort: '-date,-created', perPage: 120 }),
  ]);
  logs = [...meals.map((l) => ({ ...l, type: 'meal' })), ...acts.map((a) => ({ ...a, type: 'activity' })),
    ...progress.map((p) => ({ ...p, type: 'progress' }))]
    .sort((x, y) => (y.date + y.created).localeCompare(x.date + x.created));
  const unseen = logs.filter((l) => !l.seen_at).length;
  logCount.hidden = !unseen;
  logCount.textContent = String(unseen);
  logCount.setAttribute('aria-label', `${unseen} sin ver`);
  await renderLogs();
}

async function renderLogs() {
  feed.replaceChildren();
  logStatus.textContent = logs.length ? '' : (patient.joined
    ? 'Tu paciente aún no ha registrado comidas, actividad ni fotos de progreso.'
    : 'Tu paciente aún no tiene la app. Mándale su enlace desde la pestaña Acceso.');
  let lastDay = '';
  for (const l of logs) {
    if (l.date !== lastDay) {
      lastDay = l.date;
      feed.append(h('li', { class: 'plato-feed-day', text: longDate(l.date) }));
    }
    const coll = { meal: 'meal_logs', activity: 'activity_logs', progress: 'progress_photos' }[l.type];
    const seenBtn = seenControl(l, coll);
    if (l.type === 'activity') {
      feed.append(h('li', { class: 'plato-log-card plato-log-card--activity' },
        h('div', { class: 'plato-row plato-row--between' },
          h('span', { class: 'plato-row' }, h('span', { class: 'plato-activity-icon' }, icon('activity', 18)), h('strong', { text: 'Actividad física' })),
          h('span', { class: 'plato-muted plato-small', text: timeOf(l.created) })),
        h('p', { class: 'plato-activity-summary', text: activitySummary(l) }),
        l.note ? h('p', { class: 'plato-log-note', text: l.note }) : null,
        h('div', {}, seenBtn)));
      continue;
    }
    const title = l.type === 'meal' ? SLOT_LABEL[l.slot] : `Foto de progreso · ${POSE_LABEL[l.pose]}`;
    const alt = l.type === 'meal' ? `Foto de ${SLOT_LABEL[l.slot].toLowerCase()}` : `Foto de progreso: ${POSE_LABEL[l.pose].toLowerCase()}`;
    const img = h('img', { alt, loading: 'lazy', width: 400, height: 300 });
    photoUrl(l).then((u) => { img.src = u; }).catch(() => {});
    // The nutritionist can always delete a progress photo (wrong upload, or the patient asks).
    const del = l.type !== 'progress' ? null : h('button', {
      class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'aria-label': `Borrar ${title.toLowerCase()}`,
      onclick: async (ev) => {
        if (!confirm('¿Borrar esta foto de progreso? No se puede deshacer.')) return;
        try { await busy(ev.currentTarget, () => remove('progress_photos', l.id)); } catch (e) { toast(e.message, 'error'); return; }
        await loadLogs();
        toast('Foto de progreso borrada.');
      },
    }, icon('trash', 14));
    feed.append(h('li', { class: `plato-log-card${l.type === 'progress' ? ' plato-log-card--progress' : ''}` },
      h('button', {
        class: 'plato-photo-btn', type: 'button', 'aria-label': `Ver foto grande: ${title}`,
        onclick: async () => {
          document.getElementById('ph-title').textContent = title;
          document.getElementById('ph-sub').textContent = `${longDate(l.date)} · ${timeOf(l.created)}${l.note ? ` · “${l.note}”` : ''}`;
          const big = document.getElementById('ph-img');
          big.alt = alt;
          big.src = await photoUrl(l, '');
          photoDialog.showModal();
        },
      }, img),
      h('div', { class: 'plato-log-body' },
        h('div', { class: 'plato-row plato-row--between' },
          h('strong', { text: title }),
          h('span', { class: 'plato-muted plato-small', text: timeOf(l.created) })),
        l.note ? h('p', { class: 'plato-log-note', text: l.note }) : null,
        h('div', { class: 'plato-row plato-row--between' }, seenBtn, del))));
  }
}

function seenControl(l, coll) {
  if (l.seen_at) return h('span', { class: 'badge', 'data-variant': 'secondary' }, icon('check', 14), 'Vista');
  if (closed) return h('span', { class: 'badge', 'data-variant': 'outline', text: 'Sin ver' });
  return h('button', {
    class: 'btn', 'data-size': 'sm', type: 'button',
    'aria-label': `Marcar vista: ${l.type === 'meal' ? SLOT_LABEL[l.slot] : l.type === 'progress' ? `foto de progreso, ${POSE_LABEL[l.pose]}` : activitySummary(l)}`,
    onclick: async (ev) => {
      try {
        await busy(ev.currentTarget, () => update(coll, l.id, { seen_at: new Date().toISOString().replace('T', ' ') }));
      } catch (e) { toast(e.message, 'error'); return; }
      await loadLogs();
      toast('Marcada como vista. Tu paciente lo verá.');
    },
  }, icon('eye', 16), 'Marcar vista');
}

// ---------- Notes ----------
const noteForm = document.getElementById('note-form');
noteForm.hidden = closed;
const noteList = document.getElementById('note-list');
async function loadNotes() {
  const notes = await list('patient_notes', { filter: `patient = ${pid}`, sort: '-created' });
  noteList.replaceChildren(...notes.map((n) => h('li', { class: 'plato-note' },
    h('div', { class: 'plato-row plato-row--between' },
      h('span', { class: 'plato-muted plato-small', text: `${shortDate(n.created)} · ${timeOf(n.created)}` }),
      closed ? null : h('button', {
        class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'aria-label': 'Borrar nota',
        onclick: async () => {
          if (!confirm('¿Borrar esta nota?')) return;
          try { await remove('patient_notes', n.id); } catch (e) { toast(e.message, 'error'); return; }
          await loadNotes();
        },
      }, icon('trash', 16))),
    h('p', { text: n.text }))));
  if (!notes.length) noteList.append(h('li', { class: 'plato-muted', text: 'Sin notas todavía.' }));
}
noteForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(noteForm, '');
  if (!noteForm.reportValidity()) return;
  try {
    await busy(noteForm.querySelector('[type=submit]'), () => create('patient_notes', { patient: patient.id, text: noteForm.text.value.trim() }));
  } catch (err) { formError(noteForm, err.message); return; }
  noteForm.reset();
  await loadNotes();
  toast('Nota guardada.');
});

// ---------- Access ----------
const makeLink = document.getElementById('make-link');
function renderAccess() {
  document.getElementById('invite-card').hidden = closed;
  document.getElementById('close-card').hidden = closed;
  document.getElementById('archived-card').hidden = !closed;
  if (closed) document.getElementById('archived-when').textContent = `Cerrada el ${longDate(patient.archived_at).toLowerCase()}. Tu paciente ya no puede entrar.`;
  document.getElementById('access-state').textContent = patient.joined
    ? 'Tu paciente ya entró a su app.'
    : 'Tu paciente aún no tiene acceso.';
  document.getElementById('access-help').textContent = patient.joined
    ? 'Si perdió su contraseña o cambió de teléfono, crea un enlace nuevo. Su sesión y su contraseña actuales dejan de funcionar cuando lo use.'
    : 'Crea un enlace y mándalo por WhatsApp o mensaje. Sirve una sola vez y caduca en 7 días.';
  makeLink.textContent = patient.joined ? 'Restablecer acceso' : 'Crear enlace de invitación';
}
makeLink.addEventListener('click', async () => {
  let inv;
  try { inv = await busy(makeLink, () => newInvite(patient.id)); } catch (e) { toast(e.message, 'error'); return; }
  const url = `${location.origin}/join.html#${inv.token}`;
  document.getElementById('invite-link').value = url;
  document.getElementById('link-expiry').textContent = `Sirve una vez. Caduca el ${shortDate(inv.expires)}. Los enlaces anteriores ya no funcionan.`;
  document.getElementById('link-area').hidden = false;
  document.getElementById('invite-link').select();
});
document.getElementById('copy-link').addEventListener('click', async () => {
  const input = document.getElementById('invite-link');
  try { await navigator.clipboard.writeText(input.value); toast('Enlace copiado. Pégalo en WhatsApp.'); } catch {
    input.select(); toast('Selecciona y copia el enlace.', 'error');
  }
});

// ---------- Close / reopen / delete (typed-name confirmation) ----------
const norm = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
const firstName = patient.name.trim().split(/\s+/)[0];

function confirmDialog({ dialog, form, input, label, confirm, cancel, x, expected, text, action }) {
  const [d, f, i, b] = [dialog, form, input, confirm].map((el) => document.getElementById(el));
  document.getElementById(label).textContent = text;
  i.addEventListener('input', () => { b.disabled = norm(i.value) !== norm(expected); });
  for (const el of [cancel, x]) document.getElementById(el).addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    formError(f, '');
    if (norm(i.value) !== norm(expected)) return;
    try { await busy(b, action); } catch (err) { formError(f, err.message); }
  });
  return () => { f.reset(); b.disabled = true; formError(f, ''); d.showModal(); i.focus(); };
}

const openClose = confirmDialog({
  dialog: 'close-dialog', form: 'close-form', input: 'cd-name', label: 'cd-label', confirm: 'cd-confirm', cancel: 'cd-cancel', x: 'cd-x',
  expected: firstName, text: `Para confirmar, escribe el nombre: ${firstName}`,
  action: async () => {
    await closeAccount(patient.id);
    location.href = `/patient.html?id=${encodeURIComponent(patient.id)}&tab=access&closed=1`;
  },
});
const openDelete = confirmDialog({
  dialog: 'delete-dialog', form: 'delete-form', input: 'dd-name', label: 'dd-label', confirm: 'dd-confirm', cancel: 'dd-cancel', x: 'dd-x',
  expected: patient.name, text: `Para confirmar, escribe el nombre completo: ${patient.name}`,
  action: async () => {
    await remove('patients', patient.id);
    location.href = '/patients.html?view=archived&deleted=1';
  },
});
document.getElementById('close-open').addEventListener('click', openClose);
document.getElementById('delete-open').addEventListener('click', openDelete);
document.getElementById('reopen').addEventListener('click', async (ev) => {
  if (!confirm(`¿Reactivar la cuenta de ${patient.name}? Después crea un enlace nuevo para tu paciente.`)) return;
  try { await busy(ev.currentTarget, () => reopenAccount(patient.id)); } catch (e) { toast(e.message, 'error'); return; }
  location.href = `/patient.html?id=${encodeURIComponent(patient.id)}&tab=access&reopened=1`;
});
const params = new URL(location.href).searchParams;
if (params.has('closed')) toast('Cuenta cerrada. Sus datos quedan guardados.');
if (params.has('reopened')) toast('Cuenta reactivada. Crea un enlace nuevo para tu paciente.');
if (params.has('closed') || params.has('reopened')) {
  const u = new URL(location.href);
  u.searchParams.delete('closed');
  u.searchParams.delete('reopened');
  history.replaceState(null, '', u);
}

// ---------- Boot ----------
document.getElementById('export-link').href = `/export.html?id=${encodeURIComponent(patient.id)}`;
document.getElementById('print-week').addEventListener('click', () => {
  if (dirty) { toast('Guarda la dieta antes de imprimir.', 'error'); return; }
  location.href = `/diet-print.html?id=${encodeURIComponent(patient.id)}`;
});
renderAccess();
const loaders = { overview: loadMeasurements, diet: loadDiet, log: loadLogs, notes: loadNotes };
const loaded = new Set();
wireTabs(document.getElementById('tabs'), (tab) => {
  if (loaded.has(tab) || !loaders[tab]) return;
  loaded.add(tab);
  loaders[tab]().catch((e) => toast(e.message, 'error'));
});
// Load the unseen-photo badge even when another tab is open first.
if (!loaded.has('log')) { loaded.add('log'); loadLogs().catch(() => {}); }
