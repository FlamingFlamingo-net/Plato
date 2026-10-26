// feedback.js — the nutritionist's feedback on a photo: 1-3 stars (meal photos only) and/or a comment.
// One way to show it everywhere: nutritionist cards, the patient's Hoy and Progreso, the export.
import { h } from './ui.js';

export const STAR_LABEL = { 1: 'Puede mejorar', 2: 'Bien', 3: '¡Excelente!' };
export const hasFeedback = (rec) => !!rec.feedback_at;

// "★★☆" with a spoken label ("2 de 3 estrellas: Bien").
export function starsEl(n) {
  if (!n) return null;
  return h('span', { class: 'plato-stars', role: 'img', 'aria-label': `${n} de 3 estrellas: ${STAR_LABEL[n]}` },
    h('span', { 'aria-hidden': 'true', text: '★'.repeat(n) }),
    h('span', { class: 'plato-stars-off', 'aria-hidden': 'true', text: '★'.repeat(3 - n) }),
    h('span', { class: 'plato-stars-label', 'aria-hidden': 'true', text: STAR_LABEL[n] }));
}

// The feedback block. `from` names the writer for the patient ("Tu nutrióloga/o"); empty for the nutritionist.
export function feedbackEl(rec, { from = '', isNew = false } = {}) {
  if (!hasFeedback(rec)) return null;
  return h('div', { class: 'plato-feedback' },
    h('div', { class: 'plato-row', style: 'gap:0.4rem' },
      from ? h('strong', { class: 'plato-small', text: `${from}:` }) : null,
      starsEl(rec.feedback_stars),
      isNew ? h('span', { class: 'badge plato-badge-new', text: 'Nuevo' }) : null,
      rec.feedback_edited ? h('span', { class: 'plato-muted plato-small', text: '(editada)' }) : null),
    rec.feedback_text ? h('p', { text: rec.feedback_text }) : null);
}

// Plain text for print/JSON.
export function feedbackText(rec) {
  if (!hasFeedback(rec)) return '';
  const stars = rec.feedback_stars ? `${'★'.repeat(rec.feedback_stars)} ${STAR_LABEL[rec.feedback_stars]}` : '';
  return [stars, rec.feedback_text].filter(Boolean).join(' · ');
}

// "New since I last looked" on the patient's phone (kept on the device; no extra server field).
const KEY = (kind) => `plato.feedbackSeen.${kind}`;
export const lastSeen = (kind) => localStorage.getItem(KEY(kind)) || '';
export const markSeen = (kind) => localStorage.setItem(KEY(kind), new Date().toISOString().replace('T', ' '));
export const isNewSince = (rec, since) => hasFeedback(rec) && (!since || rec.feedback_at > since);
