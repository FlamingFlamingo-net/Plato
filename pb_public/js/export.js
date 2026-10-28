// export.js — everything Plato holds about one patient: printable A4 (portrait) + a JSON file.
// Nutritionist only. Reads the same APIs as the patient page, so the same rules lock it. Changes nothing.
import { requireRole, view, list, photoUrl, q, SLOT_LABEL, dateOnly } from './api.js';
import { h, offlineBanner, age, shortDate, timeOf, num } from './ui.js';
import { weightChart } from './charts.js';
import { weekList, hasDiet } from './week.js';
import { printDocument, miniPlate, printedOn } from './printing.js';
import { activitySummary, activityName } from './activity.js';
import { POSE_LABEL } from './progress-photos.js';
import { feedbackText } from './feedback.js';
import { kindsFor, indexLogs, weeklyChart, goalText, SERVICE_LABEL } from './goals.js';

offlineBanner();
const me = await requireRole('nutritionists');
const id = new URL(location.href).searchParams.get('id') || '';
const statusEl = document.getElementById('status');
const sheet = document.getElementById('sheet');
const withNotes = document.getElementById('with-notes');
// Progress photos are body photos: only included when ticked (off by default), like private notes.
const withProgress = document.getElementById('with-progress');
const printBtn = document.getElementById('print');
const jsonBtn = document.getElementById('json');
document.getElementById('back').href = `/patient.html?id=${encodeURIComponent(id)}&tab=access`;

const section = (title, ...kids) => h('section', { class: 'doc-section' }, h('h2', { text: title }), ...kids);
const fact = (label, value) => h('div', {}, h('dt', { text: label }), h('dd', { text: value ?? '—' }));
const sexLabel = (s) => (s === 'female' ? 'Mujer' : s === 'male' ? 'Hombre' : '—');

let data;
try {
  const patient = await view('patients', id);
  const pid = q(patient.id);
  const [measurements, [diet], logs, notes, acts, progress] = await Promise.all([
    list('measurements', { filter: `patient = ${pid}`, sort: 'date,created' }),
    list('diets', { filter: `patient = ${pid}` }),
    list('meal_logs', { filter: `patient = ${pid}`, sort: 'date,created', perPage: 500 }),
    list('patient_notes', { filter: `patient = ${pid}`, sort: 'created' }),
    list('activity_logs', { filter: `patient = ${pid}`, sort: 'date,created', perPage: 500 }),
    list('progress_photos', { filter: `patient = ${pid}`, sort: 'date,created', perPage: 500 }),
  ]);
  data = { patient, measurements, diet, logs, notes, acts, progress };
  document.title = `Datos de ${patient.name} — Plato`;
  await render();
  statusEl.hidden = true;
  printBtn.disabled = false;
  jsonBtn.disabled = false;
} catch (e) {
  statusEl.textContent = e.status === 404 ? 'No encontrado. Este paciente no existe o no es tuyo.' : e.message;
  document.querySelector('.doc-bar .plato-row').hidden = true;
}

async function render() {
  const { patient, measurements, diet, logs, notes, acts, progress } = data;
  const birth = dateOnly(patient.birth_date);
  const a = age(birth);

  const photoCards = await Promise.all(logs.map(async (l) => {
    if (!l.photo) {   // a check ("lo comió") or an extra with only a note
      return h('div', { class: 'doc-log doc-log--check' },
        h('div', {},
          h('strong', { text: `${SLOT_LABEL[l.slot]} · ${shortDate(l.date)}` }),
          h('span', { class: 'plato-muted', text: `${l.slot === 'extra' ? 'Registrada' : 'Marcada como comida'} ${timeOf(l.created)}${l.seen_at ? ' · vista' : ''}` }),
          l.note ? h('p', { text: l.note }) : null));
    }
    const img = h('img', { alt: `Foto de ${SLOT_LABEL[l.slot].toLowerCase()} del ${shortDate(l.date)}`, loading: 'eager', decoding: 'sync' });
    img.src = await photoUrl(l, '');
    return h('figure', { class: 'doc-log', style: 'margin:0' }, img,
      h('div', {},
        h('strong', { text: `${SLOT_LABEL[l.slot]} · ${shortDate(l.date)}` }),
        h('span', { class: 'plato-muted', text: `Enviada ${timeOf(l.created)}${l.seen_at ? ' · vista' : ''}` }),
        l.note ? h('p', { text: l.note }) : null,
        feedbackText(l) ? h('p', { class: 'doc-feedback', text: `Nutrióloga/o: ${feedbackText(l)}` }) : null));
  }));

  // Photos load only when the box is ticked, so an export without them never fetches the files.
  const progressSection = section(`Fotos de progreso (${progress.length})`,
    progress.length ? h('div', { class: 'doc-logs', id: 'progress-photos' }) : h('p', { class: 'doc-empty', text: 'Sin fotos de progreso.' }));
  progressSection.id = 'progress-section';
  progressSection.hidden = !withProgress.checked;
  if (withProgress.checked) await fillProgress(progressSection);

  const notesSection = section('Notas privadas de la nutrióloga/o',
    notes.length
      ? h('ul', { class: 'doc-notes' }, ...notes.map((n) => h('li', {},
        h('span', { class: 'plato-muted', text: `${shortDate(n.created)} · ${timeOf(n.created)}` }), h('p', { text: n.text }))))
      : h('p', { class: 'doc-empty', text: 'Sin notas.' }));
  notesSection.id = 'notes-section';
  notesSection.hidden = !withNotes.checked;

  sheet.replaceChildren(
    h('header', { class: 'sheet-head' },
      miniPlate(),
      h('div', {},
        h('h1', { id: 'sheet-title', text: `Datos de ${patient.name}` }),
        h('p', { text: [`Nutrióloga/o: ${me.name}`, me.clinic_name].filter(Boolean).join(' · ') })),
      h('div', { class: 'sheet-meta' }, h('div', { text: printedOn() }), h('div', { text: 'Exportado desde Plato' }))),

    section('Perfil', h('dl', { class: 'doc-facts' },
      fact('Nombre', patient.name),
      fact('Sexo', sexLabel(patient.sex)),
      fact('Fecha de nacimiento', birth ? `${shortDate(birth)}${a != null ? ` (${a} años)` : ''}` : '—'),
      fact('Estatura', patient.height_cm ? `${num(patient.height_cm)} cm` : '—'),
      fact('App del paciente', patient.joined ? 'Activa' : 'Sin acceso'),
      fact('Alta en Plato', shortDate(patient.created)))),

    section('Mediciones',
      measurements.length ? h('figure', { class: 'doc-chart' }, weightChart(measurements, { width: 640, height: 200 })) : null,
      measurements.length
        ? h('table', { class: 'doc-table' },
          h('thead', {}, h('tr', {}, ...['Fecha', 'Peso (kg)', 'Grasa (%)', 'Cintura (cm)'].map((t, i) => h('th', { scope: 'col', class: i ? 'num' : '', text: t })))),
          h('tbody', {}, ...measurements.map((m) => h('tr', {},
            h('td', { text: shortDate(dateOnly(m.date)) }),
            h('td', { class: 'num', text: num(m.weight_kg) }),
            h('td', { class: 'num', text: m.body_fat_pct ? num(m.body_fat_pct) : '—' }),
            h('td', { class: 'num', text: m.waist_cm ? num(m.waist_cm) : '—' })))))
        : h('p', { class: 'doc-empty', text: 'Sin mediciones.' })),

    section(diet?.title ? `Dieta: ${diet.title}` : 'Dieta',
      diet && hasDiet(diet.meals) ? weekList(diet.meals) : h('p', { class: 'doc-empty', text: 'Sin dieta asignada.' })),

    section(`Comidas registradas (${logs.length})`,
      logs.length ? h('div', { class: 'doc-logs' }, ...photoCards) : h('p', { class: 'doc-empty', text: 'Sin comidas registradas.' })),

    section(`Actividad física (${acts.length})`,
      acts.length
        ? h('table', { class: 'doc-table' },
          h('thead', {}, h('tr', {}, ...['Fecha', 'Actividad', 'Nota'].map((t) => h('th', { scope: 'col', text: t })))),
          h('tbody', {}, ...acts.map((a) => h('tr', {},
            h('td', { text: shortDate(a.date) }),
            h('td', { text: activitySummary(a) }),
            h('td', { text: a.note || '—' })))))
        : h('p', { class: 'doc-empty', text: 'Sin actividad registrada.' })),

    goalsSection(),

    progressSection,

    notesSection,

    h('p', { class: 'doc-foot', text: 'Contiene datos personales y de salud. Entrégalo solo al paciente o a quien él autorice.' }));
  sheet.hidden = false;
}

// Weekly goals, last 8 weeks (spec "Weekly goals", slice 2): días cumplidos / meta and the goal in force.
function goalsSection() {
  const { patient, diet, logs, acts } = data;
  const kinds = kindsFor(patient);
  if (!kinds.length) return null;
  const gd = { diet, idx: indexLogs(logs, acts) };
  return section(`Metas semanales (${SERVICE_LABEL[patient.service] || '—'})`,
    ...kinds.map((k) => {
      const { weeks } = weeklyChart(k, patient, gd);
      return h('table', { class: 'doc-table' },
        h('caption', { text: k === 'meal' ? 'Comidas marcadas' : 'Actividad' }),
        h('thead', {}, h('tr', {}, ...['Semana del', 'Días cumplidos', 'Meta', k === 'meal' ? 'Comidas' : 'Minutos'].map((t) => h('th', { scope: 'col', text: t })))),
        h('tbody', {}, ...weeks.slice().reverse().map((w) => h('tr', {},
          h('td', { text: shortDate(w.monday) }),
          h('td', { text: w.goal ? `${w.met} de ${w.goal.days}` : String(w.met) }),
          h('td', { text: goalText(k, w.goal) }),
          h('td', { text: String(Math.round(w.total)) })))));
    }));
}

async function fillProgress(sectionEl) {
  const box = sectionEl.querySelector('#progress-photos');
  if (!box || box.childElementCount) return;
  box.append(...await Promise.all(data.progress.map(async (p) => {
    const img = h('img', { alt: `Foto de progreso (${POSE_LABEL[p.pose].toLowerCase()}) del ${shortDate(p.date)}`, loading: 'eager', decoding: 'sync' });
    img.src = await photoUrl(p, '');
    return h('figure', { class: 'doc-log', style: 'margin:0' }, img,
      h('div', {},
        h('strong', { text: `${POSE_LABEL[p.pose]} · ${shortDate(p.date)}` }),
        h('span', { class: 'plato-muted', text: `Enviada ${timeOf(p.created)}${p.seen_at ? ' · vista' : ''}` }),
        p.note ? h('p', { text: p.note }) : null,
        feedbackText(p) ? h('p', { class: 'doc-feedback', text: `Nutrióloga/o: ${feedbackText(p)}` }) : null));
  })));
}

withProgress.addEventListener('change', async () => {
  const s = document.getElementById('progress-section');
  if (!s) return;
  if (withProgress.checked) await fillProgress(s);
  s.hidden = !withProgress.checked;
});

withNotes.addEventListener('change', () => {
  const s = document.getElementById('notes-section');
  if (s) s.hidden = !withNotes.checked;
});

printBtn.addEventListener('click', printDocument);

jsonBtn.addEventListener('click', () => {
  const { patient, measurements, diet, logs, notes, acts, progress } = data;
  const out = {
    format: 'plato-patient-export',
    version: 1,
    exported_at: new Date().toISOString(),
    nutritionist: { name: me.name, clinic_name: me.clinic_name || '' },
    patient: {
      id: patient.id, name: patient.name, sex: patient.sex, birth_date: dateOnly(patient.birth_date) || null,
      height_cm: patient.height_cm || null, app_active: !!patient.joined, created: patient.created,
    },
    measurements: measurements.map((m) => ({
      date: dateOnly(m.date), weight_kg: m.weight_kg, body_fat_pct: m.body_fat_pct || null, waist_cm: m.waist_cm || null,
    })),
    diet: diet ? { title: diet.title || '', meals: diet.meals || {}, updated: diet.updated } : null,
    meal_logs: logs.map((l) => ({
      date: l.date, meal: l.slot, meal_label: SLOT_LABEL[l.slot], note: l.note || '',
      sent_at: l.created, seen_at: l.seen_at || null, photo_file: l.photo || null, checked_without_photo: !l.photo && l.slot !== 'extra',
      feedback: l.feedback_at ? { stars: l.feedback_stars || null, text: l.feedback_text || '', given_at: l.feedback_at, edited: !!l.feedback_edited } : null,
    })),
    weekly_goals: {
      service: patient.service || null,
      current: { meals: { per_day: patient.meal_goal_per_day, days: patient.meal_goal_days }, activity: { minutes_per_day: patient.activity_goal_min, days: patient.activity_goal_days } },
      history: patient.goal_history || [],
      last_8_weeks: Object.fromEntries(kindsFor(patient).map((k) => [k === 'meal' ? 'meals' : 'activity',
        weeklyChart(k, patient, { diet, idx: indexLogs(logs, acts) }).weeks.map((w) => ({ week_of: w.monday, days_met: w.met, goal_days: w.goal?.days ?? null, goal_per_day: w.goal?.per ?? null, total: w.total }))])),
    },
    activity_logs: acts.map((a) => ({
      date: a.date, activity: a.kind, activity_label: activityName(a), minutes: a.minutes,
      intensity: a.intensity || null, terrain: a.terrain || null, distance_km: a.distance_km || null,
      summary: activitySummary(a), note: a.note || '', sent_at: a.created, seen_at: a.seen_at || null,
    })),
    ...(withProgress.checked ? { progress_photos: progress.map((p) => ({
      date: p.date, pose: p.pose, pose_label: POSE_LABEL[p.pose], note: p.note || '',
      sent_at: p.created, seen_at: p.seen_at || null, photo_file: p.photo,
      feedback: p.feedback_at ? { text: p.feedback_text || '', given_at: p.feedback_at, edited: !!p.feedback_edited } : null,
    })) } : {}),
    ...(withNotes.checked ? { private_notes: notes.map((n) => ({ created: n.created, text: n.text })) } : {}),
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `plato-${slug(patient.name)}-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
