// today.js — the patient's day: the plate, the day's meals as a checklist, extra meals, and today's activity.
// Check first ("lo comí"), then an optional photo (spec "Feature: Weekly goals", slice 1). Today and yesterday.
import { list, create, remove, photoUrl, q, SLOTS, SLOT_LABEL, localDate, isoWeekday } from './api.js';
import { h, icon, longDate, toast, timeOf } from './ui.js';
import { plate } from './charts.js';
import { activitySummary } from './activity.js';
import { feedbackEl, lastSeen, markSeen, isNewSince } from './feedback.js';
import { patientShell } from './shell.js';
import { loadGoalData, weekCard, mondayOf, kindsFor } from './goals.js';
import { mountNextAppointment } from './next-appt.js';

const { me, nutritionist } = await patientShell('today');
const today = localDate();
const yd = new Date(); yd.setDate(yd.getDate() - 1);
const yesterday = localDate(yd);
const params = new URL(location.href).searchParams;
let day = params.get('day') === 'yesterday' ? 'yesterday' : 'today';

document.getElementById('greet').textContent = `¡Hola, ${me.name.split(' ')[0]}!`;
document.getElementById('date').textContent = longDate(today) + (nutritionist ? ` · Plan de ${nutritionist.name}` : '');
if (params.has('welcome')) document.getElementById('welcome').hidden = false;
mountNextAppointment(document.getElementById('next-appt'), me);
if (params.has('logged')) toast('¡Bien! Comida registrada.');
if (params.has('activity')) toast('¡Bien! Actividad registrada.');
if (params.has('logged') || params.has('welcome') || params.has('activity')) history.replaceState(null, '', `/today.html${day === 'yesterday' ? '?day=yesterday' : ''}`);

const statusEl = document.getElementById('status');
const fbSince = lastSeen('meal'); // what was already seen on this phone
const mealsEl = document.getElementById('meals');
const extrasEl = document.getElementById('extras');
const addExtra = document.getElementById('add-extra');
const dayBtns = [...document.querySelectorAll('#day-switch button')];

let diet = null;
try { [diet] = await list('diets', { filter: `patient = ${q(me.id)}` }); } catch (e) { statusEl.textContent = e.message; }

for (const b of dayBtns) {
  b.addEventListener('click', () => {
    day = b.dataset.day;
    history.replaceState(null, '', `/today.html${day === 'yesterday' ? '?day=yesterday' : ''}`);
    renderMeals();
  });
}

const thumb = (l, label) => {
  const img = h('img', { alt: `Tu foto de ${label.toLowerCase()}`, width: 48, height: 48 });
  photoUrl(l).then((u) => { img.src = u; }).catch(() => {});
  return img;
};
const delBtn = (l, label, what = 'esta foto') => h('button', {
  class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'aria-label': `Borrar ${what} de ${label.toLowerCase()}`,
  onclick: async () => {
    if (!confirm(`¿Borrar ${what}?`)) return;
    try { await remove('meal_logs', l.id); } catch (e) {
      toast(e.status === 404 ? 'Solo puedes borrar el mismo día que la registraste.' : e.message, 'error');
      return;
    }
    renderMeals();
  },
}, icon('trash', 14));

let renderToken = 0;
async function renderMeals() {
  const token = ++renderToken;
  const date = day === 'yesterday' ? yesterday : today;
  for (const b of dayBtns) b.setAttribute('aria-pressed', String(b.dataset.day === day));
  document.getElementById('date').textContent = (day === 'yesterday' ? 'Ayer, ' : '') + longDate(date) + (nutritionist ? ` · Plan de ${nutritionist.name}` : '');
  mealsEl.setAttribute('aria-label', day === 'yesterday' ? 'Comidas de ayer' : 'Comidas de hoy');
  addExtra.href = `/log.html?slot=extra${day === 'yesterday' ? `&date=${yesterday}` : ''}`;
  let logs;
  try {
    logs = await list('meal_logs', { filter: `patient = ${q(me.id)} && date = ${q(date)}`, sort: 'created' });
  } catch (e) { statusEl.textContent = e.message; return; }
  if (token !== renderToken) return;
  const plan = diet?.meals?.[isoWeekday(new Date(`${date}T12:00:00`))] || {};
  const planned = SLOTS.filter(([k]) => plan[k]);
  const bySlot = {};
  for (const l of logs) (bySlot[l.slot] ||= []).push(l);

  document.getElementById('plate').replaceChildren(plate(planned.map(([k]) => ({ slot: k, done: !!bySlot[k] })), 220, day === 'yesterday' ? 'ayer' : 'hoy'));
  const when = day === 'yesterday' ? 'Ayer' : 'Hoy';
  if (!diet) statusEl.textContent = 'Tu nutrióloga o nutriólogo aún no te asigna una dieta. Puedes registrar tus comidas de todos modos.';
  else if (!planned.length) statusEl.textContent = `${when} no hay comidas en tu plan. Puedes registrar lo que comas.`;
  else statusEl.textContent = 'Marca cada comida cuando la comas. La foto es opcional.';

  // Planned meals, plus any slot logged that is not in the plan.
  const rows = SLOTS.filter(([k]) => plan[k] || bySlot[k]).map(([key, label]) => {
    const done = bySlot[key] || [];
    const checked = done.length > 0;
    const photos = done.filter((l) => l.photo);
    const seen = checked && done.every((l) => l.seen_at);
    const check = h('button', {
      class: 'plato-check', type: 'button', 'aria-pressed': String(checked),
      'aria-label': checked ? `Desmarcar ${label.toLowerCase()}` : `Marcar ${label.toLowerCase()} como comido`,
      onclick: async (ev) => {
        const btn = ev.currentTarget;
        btn.disabled = true;
        try {
          if (!checked) {
            await create('meal_logs', { patient: me.id, date, slot: key });
          } else {
            if (photos.length && !confirm(`¿Desmarcar ${label.toLowerCase()}? Se quitará también la foto.`)) { btn.disabled = false; return; }
            for (const l of done) await remove('meal_logs', l.id);
          }
        } catch (e) {
          btn.disabled = false;
          toast(e.status === 404 ? 'Solo puedes desmarcar el mismo día que la marcaste.' : e.status === 0 ? 'Sin conexión. Inténtalo de nuevo.' : e.message, 'error');
          return renderMeals();
        }
        renderMeals();
      },
    }, icon('check', 18));
    return h('li', { class: `plato-meal plato-meal--check${checked ? ' is-done' : ''}`, dataset: { slot: key } },
      check,
      h('div', {},
        h('h3', { text: label }),
        plan[key] ? h('p', { text: plan[key] }) : h('p', { class: 'plato-muted', text: 'Fuera de tu plan' }),
        checked ? h('span', { class: `plato-meal-status${seen ? ' is-seen' : ''}` }, icon(seen ? 'eye' : 'check', 14),
          seen ? 'Vista por tu nutrióloga/o' : 'Registrada') : null,
        photos.length ? h('div', { class: 'plato-meal-thumbs' }, ...photos.flatMap((l) => [thumb(l, label), delBtn(l, label)])) : null,
        ...photos.map((l) => feedbackEl(l, { from: 'Tu nutrióloga/o', isNew: isNewSince(l, fbSince) })),
        checked ? h('a', {
          class: 'btn plato-meal-photo', 'data-variant': 'outline', 'data-size': 'sm',
          href: `/log.html?slot=${key}${day === 'yesterday' ? `&date=${yesterday}` : ''}`,
          'aria-label': `${photos.length ? 'Otra foto' : 'Agregar foto'}: ${label}`,
        }, icon('camera', 16), photos.length ? 'Otra foto' : 'Agregar foto') : null));
  });
  mealsEl.replaceChildren(...rows);

  const extras = bySlot.extra || [];
  extrasEl.replaceChildren(...extras.map((l) => h('li', { class: 'plato-meal plato-meal--extra' },
    h('span', { class: 'plato-activity-icon', 'aria-hidden': 'true' }, icon('plus', 16)),
    h('div', {},
      h('h3', { text: `Comida extra · ${timeOf(l.created)}` }),
      l.note ? h('p', { text: l.note }) : null,
      l.photo ? h('div', { class: 'plato-meal-thumbs' }, thumb(l, 'comida extra')) : null,
      l.photo ? feedbackEl(l, { from: 'Tu nutrióloga/o', isNew: isNewSince(l, fbSince) }) : null,
      h('span', { class: `plato-meal-status${l.seen_at ? ' is-seen' : ''}` }, icon(l.seen_at ? 'eye' : 'check', 14),
        l.seen_at ? 'Vista por tu nutrióloga/o' : 'Registrada')),
    delBtn(l, 'comida extra', 'esta comida extra'))));
  document.getElementById('extras-empty').hidden = extras.length > 0;
  renderWeek().catch(() => {});
}

// "Tu semana" (spec "Weekly goals", slice 2): always this week, refreshed after every check.
async function renderWeek() {
  const box = document.getElementById('week');
  if (!kindsFor(me).length) { box.hidden = true; return; }
  const data = await loadGoalData(me.id, mondayOf());
  document.getElementById('week-rows').replaceChildren(...weekCard(me, data));
  box.hidden = false;
}
await renderMeals();

// Feedback on earlier days (today's shows on its meal above). Last 14 days, newest first.
try {
  const from = new Date(); from.setDate(from.getDate() - 14);
  const older = await list('meal_logs', {
    filter: `patient = ${q(me.id)} && feedback_at != "" && date != ${q(today)} && date >= ${q(localDate(from))}`, sort: '-feedback_at', perPage: 30,
  });
  const fbList = document.getElementById('fb-list');
  document.getElementById('fb-section').hidden = !older.length;
  for (const l of older) {
    const img = h('img', { alt: `Tu foto de ${SLOT_LABEL[l.slot].toLowerCase()}`, width: 56, height: 56, class: 'plato-fb-thumb' });
    photoUrl(l).then((u) => { img.src = u; }).catch(() => {});
    fbList.append(h('li', { class: 'plato-fb-item' }, img,
      h('div', {},
        h('strong', { class: 'plato-small', text: `${SLOT_LABEL[l.slot]} · ${longDate(l.date)}` }),
        feedbackEl(l, { from: 'Tu nutrióloga/o', isNew: isNewSince(l, fbSince) }))));
  }
} catch { /* the rest of Hoy still works */ }
markSeen('meal');

// Today's physical activity (same-day delete, like meals).
const actEl = document.getElementById('activities');
const actStatus = document.getElementById('act-status');
try {
  const acts = await list('activity_logs', { filter: `patient = ${q(me.id)} && date = ${q(today)}`, sort: 'created' });
  actStatus.textContent = acts.length ? '' : 'Aún no registras actividad hoy.';
  for (const a of acts) {
    actEl.append(h('li', { class: 'plato-activity' },
      h('span', { class: 'plato-activity-icon' }, icon('activity', 20)),
      h('div', {},
        h('h3', { text: activitySummary(a) }),
        a.note ? h('p', { class: 'plato-muted plato-small', text: a.note }) : null,
        h('span', { class: `plato-meal-status${a.seen_at ? ' is-seen' : ''}` }, icon(a.seen_at ? 'eye' : 'check', 14),
          a.seen_at ? 'Vista por tu nutrióloga/o' : 'Registrada')),
      h('button', {
        class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'aria-label': `Borrar actividad: ${activitySummary(a)}`,
        onclick: async () => {
          if (!confirm('¿Borrar esta actividad?')) return;
          try { await remove('activity_logs', a.id); } catch (e) {
            toast(e.status === 404 ? 'Solo puedes borrar actividad del mismo día.' : e.message, 'error');
            return;
          }
          location.reload();
        },
      }, icon('trash', 14))));
  }
} catch (e) {
  actStatus.textContent = e.message;
}
