// templates.js — the nutritionist's diet templates: preview, rename, archive / restore, delete.
// Tabs Activas | Archivadas and "Ordenar" (list-tabs.js; spec "Feature: Archive and restore catalogue items").
// Templates are made from a patient's Dieta tab ("Guardar como plantilla"); v1 edits them through a patient too.
import { requireRole, list, count, update, remove, signOut, q } from './api.js';
import { listState, mountListBar, sortItems } from './list-tabs.js';
import { h, icon, toast, formError, busy, offlineBanner, shortDate } from './ui.js';
import { weekList, daysFilled } from './week.js';
import { snacksOf } from './api.js';

offlineBanner();
const me = await requireRole('nutritionists');
document.getElementById('who').textContent = me.name;
document.getElementById('sign-out').addEventListener('click', signOut);

const listEl = document.getElementById('list');
const statusEl = document.getElementById('status');
const state = listState('templates');
const bar = mountListBar(document.getElementById('list-bar'), {
  key: 'templates', state, panel: 'list-panel',
  labels: { active: 'Activas', archived: 'Archivadas', recent: 'Archivadas recientemente', what: 'plantillas' },
  onChange: () => load(),
});
const refreshCounts = () => Promise.all([count('diet_templates', 'archived_at = ""'), count('diet_templates', 'archived_at != ""')])
  .then(([active, archived]) => bar.setCounts({ active, archived })).catch(() => {});
const now = () => new Date().toISOString().replace('T', ' ');
async function setArchived(t, on, button) {
  try { await busy(button, () => update('diet_templates', t.id, { archived_at: on ? now() : '' })); } catch (e) { toast(e.message, 'error'); return; }
  toast(on ? 'Plantilla archivada. Está en la pestaña Archivadas.' : 'Plantilla restaurada. Ya puedes usarla otra vez.');
  load();
}

async function load() {
  const archived = state.view === 'archived';
  refreshCounts();
  let templates;
  try { templates = await list('diet_templates', { filter: archived ? 'archived_at != ""' : 'archived_at = ""', perPage: 500 }); } catch (e) { statusEl.textContent = e.message; return; }
  templates = sortItems(templates, state.sort, { name: 'title' });
  statusEl.textContent = templates.length ? `${templates.length} ${templates.length === 1 ? 'plantilla' : 'plantillas'}${archived ? (templates.length === 1 ? ' archivada' : ' archivadas') : ''}` : '';
  if (!templates.length && archived) {
    listEl.replaceChildren(h('li', { class: 'plato-empty-state' },
      h('strong', { text: 'No hay plantillas archivadas' }),
      h('span', { text: 'Archiva las que ya no uses: dejan de aparecer en “Usar plantilla” y puedes restaurarlas cuando quieras.' })));
    return;
  }
  if (!templates.length) {
    listEl.replaceChildren(h('li', { class: 'plato-empty-state' },
      h('strong', { text: 'Aún no tienes plantillas' }),
      h('span', { text: 'Abre la dieta de un paciente y toca “Guardar como plantilla”. Luego úsala con otros pacientes desde “Usar plantilla”.' }),
      h('a', { class: 'btn', href: '/patients.html' }, 'Ir a mis pacientes')));
    return;
  }
  listEl.replaceChildren(...templates.map((t) => {
    const n = daysFilled(t.meals, snacksOf(t));
    const preview = h('section', { class: 'plato-week-preview', hidden: true }, weekList(t.meals || {}, snacksOf(t))); // hidden = no empty gap
    const toggle = h('button', {
      class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', type: 'button', 'aria-expanded': 'false',
      onclick: () => {
        preview.hidden = !preview.hidden;
        toggle.setAttribute('aria-expanded', String(!preview.hidden));
        toggle.lastChild.textContent = preview.hidden ? 'Ver semana' : 'Ocultar semana';
      },
    }, icon('eye', 16), h('span', { text: 'Ver semana' }));
    return h('li', { class: 'card', dataset: { id: t.id } },
      h('header', { class: 'plato-row plato-row--between' },
        h('div', {},
          h('h2', { text: t.title }),
          h('p', { text: `${n} ${n === 1 ? 'día' : 'días'} con comidas · ${t.archived_at ? `archivada ${shortDate(t.archived_at)}` : `cambiada ${shortDate(t.updated)}`}` })),
        h('div', { class: 'plato-row' },
          toggle,
          t.archived_at
            ? h('button', { class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', type: 'button', 'data-action': 'restore', onclick: (ev) => setArchived(t, false, ev.currentTarget) }, icon('undo', 16), 'Restaurar')
            : h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', onclick: () => openRename(t) }, 'Cambiar nombre'),
          t.archived_at ? null : h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', 'data-action': 'archive', onclick: (ev) => setArchived(t, true, ev.currentTarget) }, icon('archive', 16), 'Archivar'),
          h('button', {
            class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'aria-label': `Borrar plantilla: ${t.title}`,
            onclick: async (ev) => {
              if (!confirm(`¿Borrar la plantilla “${t.title}”? Las dietas de tus pacientes no cambian.`)) return;
              try { await busy(ev.currentTarget, () => remove('diet_templates', t.id)); } catch (e) { toast(e.message, 'error'); return; }
              toast('Plantilla borrada.');
              load();
            },
          }, icon('trash', 16)))),
      preview);
  }));
}

// Rename
const rnDialog = document.getElementById('rn-dialog');
const rnForm = document.getElementById('rn-form');
const rnName = document.getElementById('rn-name');
let renaming = null;
for (const id of ['rn-cancel', 'rn-x']) document.getElementById(id).addEventListener('click', () => rnDialog.close());
rnDialog.addEventListener('click', (e) => { if (e.target === rnDialog) rnDialog.close(); });
function openRename(t) {
  renaming = t;
  formError(rnForm, '');
  rnName.value = t.title;
  rnDialog.showModal();
  rnName.select();
}
rnForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  formError(rnForm, '');
  const title = rnName.value.trim();
  if (!title) { formError(rnForm, 'Escribe un nombre.'); return; }
  try {
    await busy(document.getElementById('rn-save'), async () => {
      // Check the name first (the server refuses duplicates too, but an expected refusal is not an error).
      const [taken] = await list('diet_templates', { filter: `title = ${q(title)} && id != ${q(renaming.id)}`, perPage: 1, fields: 'id' });
      if (taken) throw Object.assign(new Error('Ya tienes una plantilla con ese nombre.'), { status: 409 });
      return update('diet_templates', renaming.id, { title });
    });
  } catch (err) {
    formError(rnForm, err.status === 400 || err.status === 409 ? 'Ya tienes una plantilla con ese nombre.' : err.message);
    return;
  }
  rnDialog.close();
  toast('Nombre cambiado.');
  load();
});

load();
