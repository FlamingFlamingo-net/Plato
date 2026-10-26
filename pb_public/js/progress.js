// progress.js — the patient's measurements, weight chart and progress photos.
import { list, remove, photoUrl, q, dateOnly } from './api.js';
import { h, icon, toast, shortDate, num } from './ui.js';
import { POSE_LABEL } from './progress-photos.js';
import { feedbackEl, lastSeen, markSeen, isNewSince } from './feedback.js';
import { weightChart } from './charts.js';
import { patientShell } from './shell.js';

const { me, nutritionist, minor } = await patientShell('progress');
if (minor) document.getElementById('add-photo').remove();
if (new URL(location.href).searchParams.has('photo')) {
  toast('¡Bien! Foto de progreso guardada.');
  history.replaceState(null, '', '/progress.html');
}
const statusEl = document.getElementById('status');

try {
  const ms = await list('measurements', { filter: `patient = ${q(me.id)}`, sort: 'date,created' });
  statusEl.textContent = ms.length ? '' : 'Aún no hay mediciones. Tu nutrióloga o nutriólogo las agrega en tu consulta.';
  const first = ms[0], last = ms.at(-1);
  const stat = (label, value) => h('div', { class: 'plato-stat' }, h('span', { text: label }), h('strong', { text: value }));
  const diff = last && first !== last ? last.weight_kg - first.weight_kg : null;
  document.getElementById('stats').replaceChildren(
    stat('Peso actual', last ? `${num(last.weight_kg)} kg` : '—'),
    stat('Desde el inicio', diff != null ? `${diff > 0 ? '+' : ''}${num(diff)} kg` : '—'),
    stat('Cintura', last?.waist_cm ? `${num(last.waist_cm)} cm` : '—'),
  );
  document.getElementById('chart').replaceChildren(weightChart(ms, { width: 480, height: 220 }));
  document.getElementById('rows').replaceChildren(...[...ms].reverse().map((m) => h('tr', {},
    h('td', { text: shortDate(dateOnly(m.date)) }),
    h('td', { class: 'num', text: `${num(m.weight_kg)} kg` }),
    h('td', { class: 'num', text: m.body_fat_pct ? `${num(m.body_fat_pct)} %` : '—' }),
    h('td', { class: 'num', text: m.waist_cm ? `${num(m.waist_cm)} cm` : '—' }))));
} catch (e) {
  statusEl.textContent = e.message;
}

// Progress photos, newest first, grouped by date. Delete only when the nutritionist allows it (the server checks too).
const canDelete = !!nutritionist?.allow_progress_delete;
const fbSince = lastSeen('progress');
const grid = document.getElementById('pp-grid');
const ppStatus = document.getElementById('pp-status');
try {
  const photos = await list('progress_photos', { filter: `patient = ${q(me.id)}`, sort: '-date,-created', perPage: 200 });
  ppStatus.textContent = minor
    ? (dateOnly(me.birth_date) ? 'Por tu edad, Plato no guarda fotos de progreso.' : 'Las fotos de progreso se activan cuando tu nutrióloga o nutriólogo registre tu fecha de nacimiento.')
    : photos.length ? '' : 'Aún no tienes fotos de progreso. Toma una hoy y compárala en unas semanas.';
  let last = '';
  for (const p of photos) {
    if (p.date !== last) { last = p.date; grid.append(h('li', { class: 'plato-progress-day', text: shortDate(p.date) })); }
    const img = h('img', { alt: `Tu foto de progreso: ${POSE_LABEL[p.pose]}, ${shortDate(p.date)}`, loading: 'lazy', width: 400, height: 533 });
    photoUrl(p).then((u) => { img.src = u; }).catch(() => {});
    grid.append(h('li', { class: 'plato-progress-item' },
      img,
      h('div', { class: 'plato-row plato-row--between' },
        h('span', { class: 'plato-small', text: POSE_LABEL[p.pose] }),
        p.seen_at ? h('span', { class: 'plato-small plato-muted', title: 'Vista por tu nutrióloga/o' }, icon('eye', 14)) : null,
        canDelete ? h('button', {
          class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'aria-label': `Borrar foto de progreso: ${POSE_LABEL[p.pose]}, ${shortDate(p.date)}`,
          onclick: async () => {
            if (!confirm('¿Borrar esta foto de progreso? No se puede deshacer.')) return;
            try { await remove('progress_photos', p.id); } catch (e) { toast(e.status === 404 ? 'Tu nutrióloga o nutriólogo no permite borrar estas fotos.' : e.message, 'error'); return; }
            location.reload();
          },
        }, icon('trash', 14)) : null),
      feedbackEl(p, { from: 'Tu nutrióloga/o', isNew: isNewSince(p, fbSince) })));
  }
  if (photos.length && !canDelete) {
    grid.after(h('p', { class: 'plato-muted plato-small', style: 'margin:0.75rem 0 0', text: '¿Quieres borrar una foto? Pídeselo a tu nutrióloga o nutriólogo.' }));
  }
  markSeen('progress');
} catch (e) {
  ppStatus.textContent = e.message;
}
