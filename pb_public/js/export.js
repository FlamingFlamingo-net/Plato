// export.js — everything Plato holds about one patient: printable A4 (portrait) + a JSON file.
// Nutritionist only. Reads the same APIs as the patient page, so the same rules lock it. Changes nothing.
import { requireRole, view, list, photoUrl, q, SLOT_LABEL, dateOnly } from './api.js';
import { h, offlineBanner, age, shortDate, timeOf, num } from './ui.js';
import { weightChart } from './charts.js';
import { weekList, hasDiet } from './week.js';
import { printDocument, miniPlate, printedOn } from './printing.js';
import { activitySummary, activityName } from './activity.js';

offlineBanner();
const me = await requireRole('nutritionists');
const id = new URL(location.href).searchParams.get('id') || '';
const statusEl = document.getElementById('status');
const sheet = document.getElementById('sheet');
const withNotes = document.getElementById('with-notes');
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
  const [measurements, [diet], logs, notes, acts] = await Promise.all([
    list('measurements', { filter: `patient = ${pid}`, sort: 'date,created' }),
    list('diets', { filter: `patient = ${pid}` }),
    list('meal_logs', { filter: `patient = ${pid}`, sort: 'date,created', perPage: 500 }),
    list('patient_notes', { filter: `patient = ${pid}`, sort: 'created' }),
    list('activity_logs', { filter: `patient = ${pid}`, sort: 'date,created', perPage: 500 }),
  ]);
  data = { patient, measurements, diet, logs, notes, acts };
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
  const { patient, measurements, diet, logs, notes, acts } = data;
  const birth = dateOnly(patient.birth_date);
  const a = age(birth);

  const photoCards = await Promise.all(logs.map(async (l) => {
    const img = h('img', { alt: `Foto de ${SLOT_LABEL[l.slot].toLowerCase()} del ${shortDate(l.date)}`, loading: 'eager', decoding: 'sync' });
    img.src = await photoUrl(l, '');
    return h('figure', { class: 'doc-log', style: 'margin:0' }, img,
      h('div', {},
        h('strong', { text: `${SLOT_LABEL[l.slot]} · ${shortDate(l.date)}` }),
        h('span', { class: 'plato-muted', text: `Enviada ${timeOf(l.created)}${l.seen_at ? ' · vista' : ''}` }),
        l.note ? h('p', { text: l.note }) : null));
  }));

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

    notesSection,

    h('p', { class: 'doc-foot', text: 'Contiene datos personales y de salud. Entrégalo solo al paciente o a quien él autorice.' }));
  sheet.hidden = false;
}

withNotes.addEventListener('change', () => {
  const s = document.getElementById('notes-section');
  if (s) s.hidden = !withNotes.checked;
});

printBtn.addEventListener('click', printDocument);

jsonBtn.addEventListener('click', () => {
  const { patient, measurements, diet, logs, notes, acts } = data;
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
      sent_at: l.created, seen_at: l.seen_at || null, photo_file: l.photo,
    })),
    activity_logs: acts.map((a) => ({
      date: a.date, activity: a.kind, activity_label: activityName(a), minutes: a.minutes,
      intensity: a.intensity || null, terrain: a.terrain || null, distance_km: a.distance_km || null,
      summary: activitySummary(a), note: a.note || '', sent_at: a.created, seen_at: a.seen_at || null,
    })),
    ...(withNotes.checked ? { private_notes: notes.map((n) => ({ created: n.created, text: n.text })) } : {}),
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `plato-${slug(patient.name)}-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
});

const slug = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
