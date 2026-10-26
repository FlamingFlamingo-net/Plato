// patients.js — the nutritionist's patient list with a "new photos" count, and the New patient dialog.
import { requireRole, list, createPatient, signOut } from './api.js';
import { h, icon, toast, formError, busy, offlineBanner, age, shortDate } from './ui.js';

offlineBanner();
const me = await requireRole('nutritionists');
document.getElementById('who').textContent = me.name;
document.getElementById('clinic').textContent = me.clinic_name || '';
document.getElementById('sign-out').addEventListener('click', signOut);

const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');

// Two views: active patients (default) and archived (closed accounts, read-only).
const params = new URL(location.href).searchParams;
const archivedView = params.get('view') === 'archived';
for (const [id, on] of [['view-active', !archivedView], ['view-archived', archivedView]]) {
  const a = document.getElementById(id);
  if (on) { a.setAttribute('aria-current', 'page'); a.removeAttribute('data-variant'); }
}
document.getElementById('new-patient').hidden = archivedView;
if (params.has('deleted')) { toast('Paciente borrado definitivamente.'); history.replaceState(null, '', '/patients.html?view=archived'); }

const initials = (name) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

async function load() {
  try {
    const [patients, unseen, unseenActs, unseenProgress] = await Promise.all([
      list('patients', { sort: archivedView ? '-archived_at' : 'name', fields: 'id,name,sex,birth_date,joined,archived_at',
        filter: archivedView ? 'archived_at != ""' : 'archived_at = ""' }),
      archivedView ? [] : list('meal_logs', { filter: 'seen_at = "" && patient.archived_at = ""', fields: 'patient', perPage: 500 }),
      archivedView ? [] : list('activity_logs', { filter: 'seen_at = "" && patient.archived_at = ""', fields: 'patient', perPage: 500 }),
      archivedView ? [] : list('progress_photos', { filter: 'seen_at = "" && patient.archived_at = ""', fields: 'patient', perPage: 500 }),
    ]);
    const counts = {};
    for (const l of unseen) counts[l.patient] = (counts[l.patient] || 0) + 1;
    const actCounts = {};
    for (const a of unseenActs) actCounts[a.patient] = (actCounts[a.patient] || 0) + 1;
    const progCounts = {};
    for (const p of unseenProgress) progCounts[p.patient] = (progCounts[p.patient] || 0) + 1;
    render(patients, counts, actCounts, progCounts);
  } catch (e) {
    statusEl.textContent = e.message;
  }
}

function render(patients, counts, actCounts = {}, progCounts = {}) {
  listEl.replaceChildren();
  statusEl.textContent = patients.length ? `${patients.length} ${patients.length === 1 ? 'paciente' : 'pacientes'}` : '';
  if (!patients.length && archivedView) {
    listEl.append(h('li', { class: 'plato-empty-state' },
      h('strong', { text: 'No hay cuentas cerradas' }),
      h('span', { text: 'Cuando cierres la cuenta de un paciente, aparecerá aquí con sus datos de solo lectura.' })));
    return;
  }
  if (!patients.length) {
    listEl.append(h('li', { class: 'plato-empty-state' },
      h('strong', { text: 'Aún no tienes pacientes' }),
      h('span', { text: 'Agrega el primero. Luego le mandas su enlace para que instale su app.' }),
      h('button', { class: 'btn', type: 'button', onclick: openDialog }, 'Nuevo paciente')));
    return;
  }
  for (const p of patients) {
    const n = counts[p.id] || 0;
    const na = actCounts[p.id] || 0;
    const np = progCounts[p.id] || 0;
    const a = age(p.birth_date);
    const bits = [p.sex === 'female' ? 'Mujer' : 'Hombre', a != null ? `${a} años` : null].filter(Boolean).join(' · ');
    listEl.append(h('li', {},
      h('a', { class: 'plato-patient-link', href: `/patient.html?id=${encodeURIComponent(p.id)}` },
        h('span', { class: 'plato-avatar', 'aria-hidden': 'true', text: initials(p.name) }),
        h('span', { class: 'plato-patient-meta' }, h('strong', { text: p.name }), h('span', { class: 'plato-muted plato-small', text: bits })),
        p.archived_at ? h('span', { class: 'badge', 'data-variant': 'outline', text: `Cerrada el ${shortDate(p.archived_at)}` })
          : p.joined ? null : h('span', { class: 'badge', 'data-variant': 'outline', text: 'Sin app' }),
        n ? h('span', { class: 'badge plato-badge-new' }, icon('camera', 14), `${n} ${n === 1 ? 'foto nueva' : 'fotos nuevas'}`) : null,
        na ? h('span', { class: 'badge plato-badge-new' }, icon('activity', 14), `${na} ${na === 1 ? 'actividad nueva' : 'actividades nuevas'}`) : null,
        np ? h('span', { class: 'badge plato-badge-new' }, icon('user', 14), `${np} ${np === 1 ? 'foto de progreso' : 'fotos de progreso'}`) : null)));
  }
}

// ---- New patient dialog ----
const dialog = document.getElementById('patient-dialog');
const form = document.getElementById('patient-form');
function openDialog() { form.reset(); formError(form, ''); dialog.showModal(); form.querySelector('input').focus(); }
document.getElementById('new-patient').addEventListener('click', openDialog);
for (const id of ['pd-cancel', 'pd-close']) document.getElementById(id).addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(form, '');
  if (!form.reportValidity()) return;
  const d = Object.fromEntries(new FormData(form));
  try {
    const p = await busy(form.querySelector('[type=submit]'), () => createPatient({ ...d, name: d.name.trim() }));
    location.href = `/patient.html?id=${encodeURIComponent(p.id)}&tab=overview&new=1`;
  } catch (err) {
    formError(form, err.message);
  }
});

load();
