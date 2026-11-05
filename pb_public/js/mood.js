// mood.js — the mood check-in (spec "Feature: Mood check-in"): the patient's card on Hoy, the nutritionist's
// 14-day strip on the patient page, and the faces both use. Never a score: no colours for good or bad days.
import { list, create, update, q, localDate } from './api.js';
import { h, toast, busy } from './ui.js';

export const MOODS = ['Muy mal', 'Mal', 'Regular', 'Bien', 'Muy bien'];   // 1..5
export const moodLabel = (v) => MOODS[v - 1] || '';
// Mouths from a deep frown (1) to a wide smile (5); eyes stay the same.
// 1 adds slanted brows, 5 an open smile, so the two ends read apart at a glance.
const MOUTH = ['M7.5 17.5q4.5-5 9 0M7 8.6l3.2-1.4M17 8.6l-3.2-1.4', 'M9 16.2q3-2 6 0', 'M8.5 15.2h7', 'M9 14.2q3 2 6 0', 'M7.5 13.2h9q-.8 5-4.5 5t-4.5-5z'];
export function face(v, size = 28) {
  const span = h('span', { class: 'plato-face', 'aria-hidden': 'true' });
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.4"/><path d="${MOUTH[v - 1] || MOUTH[2]}"/></svg>`;
  return span;
}

// ---------- Patient: the card on Hoy ----------
// mountMood(el, me) -> { show(date, day) } where day is 'today' | 'yesterday' (follows the Hoy | Ayer switch).
export function mountMood(el, me) {
  let date = localDate(), day = 'today', rec = null, editingNote = false, token = 0;
  const when = () => (day === 'yesterday' ? 'ayer' : 'hoy');

  async function save(body, button) {
    try {
      rec = await busy(button, async () => {
        if (rec) return update('mood_logs', rec.id, body);
        try { return await create('mood_logs', { patient: me.id, date, ...body }); }
        catch (e) {   // saved meanwhile on another screen: change that one
          const [found] = await list('mood_logs', { filter: `patient = ${q(me.id)} && date = ${q(date)}`, perPage: 1 });
          if (!found) throw e;
          return update('mood_logs', found.id, body);
        }
      });
    } catch (e) { toast(e.status === 0 ? 'Sin conexión. No se guardó.' : e.message, 'error'); return false; }
    return true;
  }

  function picker() {
    const name = `mood-${date}`;
    const group = h('fieldset', { class: 'plato-mood-faces' }, h('legend', { class: 'sr-only', text: `¿Cómo te sentiste ${when()}?` }),
      ...MOODS.map((label, i) => {
        const v = i + 1;
        const input = h('input', { type: 'radio', name, value: String(v), class: 'sr-only', checked: rec?.mood === v });
        input.addEventListener('change', async () => {
          if (await save({ mood: v }, input)) { toast('Guardado.'); render(); document.getElementById('mood-change')?.focus(); }
        });
        return h('label', { class: 'plato-mood-face' }, input, face(v, 34), h('span', { text: label }));
      }));
    return group;
  }

  function render() {
    el.hidden = false;
    const title = h('h2', { id: 'mood-title', class: 'plato-section-title', style: 'margin:0', text: `¿Cómo te sentiste ${when()}?` });
    if (!rec || rec._picking) {
      el.replaceChildren(title, picker());
      return;
    }
    const noteBox = editingNote ? (() => {
      const ta = h('textarea', { class: 'textarea', id: 'mood-note', rows: 2, maxlength: 200, placeholder: 'Ej. Dormí muy poco.' });
      ta.value = rec.note || '';
      const f = h('form', { class: 'plato-mood-note-form' },
        h('label', { for: 'mood-note', class: 'sr-only', text: 'Tu nota' }), ta,
        h('div', { class: 'plato-row' },
          h('button', { class: 'btn', 'data-size': 'sm', type: 'submit', id: 'mood-note-save' }, 'Guardar'),
          h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', onclick: () => { editingNote = false; render(); } }, 'Cancelar')));
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (await save({ note: ta.value.trim() }, document.getElementById('mood-note-save'))) { editingNote = false; toast('Nota guardada.'); render(); }
      });
      setTimeout(() => ta.focus());
      return f;
    })() : rec.note
      ? h('p', { class: 'plato-mood-note' }, h('span', { text: `“${rec.note}”` }), ' ',
        h('button', { class: 'btn', 'data-variant': 'link', 'data-size': 'sm', type: 'button', id: 'mood-note-edit', onclick: () => { editingNote = true; render(); } }, 'Editar nota'))
      : h('button', { class: 'btn', 'data-variant': 'link', 'data-size': 'sm', type: 'button', id: 'mood-note-add', onclick: () => { editingNote = true; render(); } }, 'Agregar una nota');
    el.replaceChildren(title,
      h('p', { class: 'plato-mood-answer', id: 'mood-answer' }, h('span', { text: day === 'yesterday' ? 'Ayer:' : 'Hoy:' }), face(rec.mood, 22),
        h('strong', { text: moodLabel(rec.mood) }), ' · ',
        h('button', { class: 'btn', 'data-variant': 'link', 'data-size': 'sm', type: 'button', id: 'mood-change',
          onclick: () => { rec._picking = true; render(); el.querySelector('input:checked, input')?.focus(); } }, 'Cambiar')),
      noteBox);
  }

  return {
    async show(d, which) {
      date = d; day = which; editingNote = false;
      const mine = ++token;
      let rows = [];
      try { rows = await list('mood_logs', { filter: `patient = ${q(me.id)} && date = ${q(date)}`, perPage: 1 }); } catch { rows = []; }
      if (mine !== token) return;
      rec = rows[0] || null;
      render();
    },
  };
}

// ---------- Nutritionist: the last 14 days on the patient page ----------
const WD = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const longDay = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = new Intl.DateTimeFormat('es-MX', { weekday: 'short', day: 'numeric', month: 'short' });
const asDate = (ymd) => new Date(`${ymd}T12:00:00`);
export const loadMoods = (patientId, fromYmd) => list('mood_logs', { filter: `patient = ${q(patientId)} && date >= ${q(fromYmd)}`, sort: 'date', perPage: 100 });

// "Esta semana: Bien en promedio, 5 de 7 días respondidos" (Monday to today).
export function weekSummary(rows, today = localDate()) {
  const d = asDate(today), monday = new Date(d); monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const from = localDate(monday);
  const days = Math.round((d - monday) / 864e5) + 1;
  const week = rows.filter((r) => r.date >= from && r.date <= today);
  if (!week.length) return `Esta semana: sin respuestas (0 de ${days} ${days === 1 ? 'día' : 'días'}).`;
  const avg = week.reduce((s, r) => s + r.mood, 0) / week.length;
  return `Esta semana: ${moodLabel(Math.round(avg))} en promedio, ${week.length} de ${days} ${days === 1 ? 'día respondido' : 'días respondidos'}.`;
}

export function moodStrip(rows, today = localDate()) {
  const by = Object.fromEntries(rows.map((r) => [r.date, r]));
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = asDate(today); d.setDate(d.getDate() - i); days.push(localDate(d)); }
  const strip = h('ol', { class: 'plato-mood-strip', 'aria-label': 'Últimos 14 días' }, ...days.map((ymd) => {
    const r = by[ymd], dt = asDate(ymd);
    return h('li', { class: r ? '' : 'is-empty', title: r ? `${shortDay.format(dt)}: ${moodLabel(r.mood)}${r.note ? ` — ${r.note}` : ''}` : `${shortDay.format(dt)}: sin respuesta`,
      'aria-label': `${longDay.format(dt)}: ${r ? moodLabel(r.mood) : 'sin respuesta'}${r?.note ? `, nota: ${r.note}` : ''}` },
    h('span', { class: 'plato-mood-wd', 'aria-hidden': 'true', text: WD[dt.getDay()] }),
    r ? face(r.mood, 24) : h('span', { class: 'plato-mood-dot', 'aria-hidden': 'true' }),
    h('span', { class: 'plato-mood-dn', 'aria-hidden': 'true', text: String(dt.getDate()) }));
  }));
  const noted = days.map((d) => by[d]).filter((r) => r?.note).reverse();
  return [strip,
    noted.length ? h('ul', { class: 'plato-mood-notes', 'aria-label': 'Notas' }, ...noted.map((r) =>
      h('li', {}, face(r.mood, 18), h('span', { class: 'plato-muted plato-small', text: `${shortDay.format(asDate(r.date))} · ${moodLabel(r.mood)}` }), h('span', { text: `“${r.note}”` })))) : null]
    .filter(Boolean);
}
