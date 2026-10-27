// feedback-dialog.js — the nutritionist's "Dar / Editar retroalimentación" dialog and the buttons that open it.
// Used by the patient page (Registros) and the home screen (Recientes, Fotos). Built in JS so both pages share one copy.
// Stars only on meal photos (they rate the plate, not the body); the server enforces it too.
import { update } from './api.js';
import { h, icon, toast, formError, busy, longDate } from './ui.js';
import { hasFeedback } from './feedback.js';

const X = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const starRow = (n, label) => h('label', {},
  h('input', { type: 'radio', name: 'stars', value: String(n), checked: n === 0 }), ' ',
  n ? h('span', { class: 'plato-stars', 'aria-hidden': 'true' }, '★'.repeat(n), h('span', { class: 'plato-stars-off', text: '★'.repeat(3 - n) })) : null,
  ` ${label}`);

let dialog, form, text, stars, count, target;

function build() {
  if (dialog) return;
  const close = h('button', { type: 'button', 'aria-label': 'Cerrar', id: 'fb-x' });
  close.innerHTML = X;
  dialog = h('dialog', { class: 'dialog', id: 'fb-dialog', 'aria-labelledby': 'fb-title' },
    h('div', {},
      h('header', {}, h('h2', { id: 'fb-title', text: 'Retroalimentación' }), h('p', { id: 'fb-sub' })),
      form = h('form', { id: 'fb-form', class: 'plato-form', novalidate: true },
        h('section', { class: 'plato-form' },
          stars = h('fieldset', { class: 'plato-star-pick', id: 'fb-stars' },
            h('legend', {}, 'Calificación del plato ', h('span', { class: 'plato-muted', text: '(opcional)' })),
            starRow(0, 'Sin estrellas'), starRow(1, 'Puede mejorar'), starRow(2, 'Bien'), starRow(3, '¡Excelente!')),
          h('div', { class: 'field' },
            h('label', { for: 'fb-text' }, 'Comentario ', h('span', { class: 'plato-muted', id: 'fb-text-opt', text: '(opcional)' })),
            text = h('textarea', { class: 'textarea', id: 'fb-text', rows: 3, maxlength: 500, placeholder: 'Ej. ¡Muy buen plato! Agrega más verdura en la cena.' }),
            count = h('p', { class: 'plato-muted plato-small', id: 'fb-count', style: 'margin:0;text-align:right', text: '0 / 500' }))),
        h('footer', { class: 'plato-actions' },
          h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', id: 'fb-cancel', onclick: () => dialog.close() }, 'Cancelar'),
          h('button', { class: 'btn', type: 'submit', id: 'fb-save' }, 'Enviar'))),
      close));
  close.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  text.addEventListener('input', () => { count.textContent = `${text.value.length} / 500`; });
  form.addEventListener('submit', submit);
  document.body.append(dialog);
}

const collectionOf = (rec) => rec.collectionName;
const isMeal = (rec) => collectionOf(rec) === 'meal_logs';

export function openFeedback(rec, { title, onSaved }) {
  build();
  target = { rec, onSaved };
  formError(form, '');
  const meal = isMeal(rec);
  stars.hidden = !meal;
  document.getElementById('fb-text-opt').hidden = !meal; // on progress photos the comment is the feedback
  document.getElementById('fb-title').textContent = hasFeedback(rec) ? 'Editar retroalimentación' : 'Dar retroalimentación';
  document.getElementById('fb-sub').textContent = `${title} · ${longDate(rec.date)}. Tu paciente la verá en su app.`;
  form.stars.value = String(meal ? rec.feedback_stars || 0 : 0);
  text.value = rec.feedback_text || '';
  count.textContent = `${text.value.length} / 500`;
  dialog.showModal();
  text.focus();
}

async function submit(e) {
  e.preventDefault();
  formError(form, '');
  const { rec, onSaved } = target;
  const meal = isMeal(rec);
  const t = text.value.trim();
  const n = meal ? Number(form.stars.value) : 0;
  if (!t && !n) { formError(form, meal ? 'Elige estrellas o escribe un comentario.' : 'Escribe un comentario.'); return; }
  const body = meal ? { feedback_text: t, feedback_stars: n } : { feedback_text: t };
  try { await busy(document.getElementById('fb-save'), () => update(collectionOf(rec), rec.id, body)); } catch (err) { formError(form, err.message); return; }
  dialog.close();
  toast('Retroalimentación enviada. Tu paciente ya la ve.');
  await onSaved?.();
}

// "Dar retroalimentación", or "Editar" + "Quitar" when there is feedback. null on a read-only (closed) account.
export function feedbackControls(rec, { title, readOnly = false, onSaved }) {
  if (readOnly) return null;
  const open = () => openFeedback(rec, { title, onSaved });
  if (!hasFeedback(rec)) {
    return h('div', {}, h('button', { class: 'btn', 'data-variant': 'outline', 'data-size': 'sm', type: 'button', 'aria-label': `Dar retroalimentación: ${title}`, onclick: open },
      icon('message', 16), 'Dar retroalimentación'));
  }
  return h('div', { class: 'plato-row' },
    h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', 'aria-label': `Editar retroalimentación: ${title}`, onclick: open }, 'Editar'),
    h('button', {
      class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', 'aria-label': `Quitar retroalimentación: ${title}`,
      onclick: async (ev) => {
        if (!confirm('¿Quitar tu retroalimentación? Tu paciente dejará de verla.')) return;
        const body = isMeal(rec) ? { feedback_text: '', feedback_stars: 0 } : { feedback_text: '' };
        try { await busy(ev.currentTarget, () => update(collectionOf(rec), rec.id, body)); } catch (e) { toast(e.message, 'error'); return; }
        toast('Retroalimentación quitada.');
        await onSaved?.();
      },
    }, 'Quitar'));
}
