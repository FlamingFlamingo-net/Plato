// today.js — the patient's day: the plate (one slice per planned meal) and today's meals with a Log button.
import { list, remove, photoUrl, q, SLOTS, SLOT_LABEL, localDate, isoWeekday } from './api.js';
import { h, icon, longDate, toast } from './ui.js';
import { plate } from './charts.js';
import { activitySummary } from './activity.js';
import { feedbackEl, lastSeen, markSeen, isNewSince } from './feedback.js';
import { patientShell } from './shell.js';

const { me, nutritionist } = await patientShell('today');
const today = localDate();
const params = new URL(location.href).searchParams;

document.getElementById('greet').textContent = `¡Hola, ${me.name.split(' ')[0]}!`;
document.getElementById('date').textContent = longDate(today) + (nutritionist ? ` · Plan de ${nutritionist.name}` : '');
if (params.has('welcome')) document.getElementById('welcome').hidden = false;
if (params.has('logged')) toast('¡Bien! Comida registrada.');
if (params.has('activity')) toast('¡Bien! Actividad registrada.');
if (params.has('logged') || params.has('welcome') || params.has('activity')) history.replaceState(null, '', '/today.html');

const statusEl = document.getElementById('status');
const fbSince = lastSeen('meal'); // what was already seen on this phone
const mealsEl = document.getElementById('meals');

try {
  const [[diet], logs] = await Promise.all([
    list('diets', { filter: `patient = ${q(me.id)}` }),
    list('meal_logs', { filter: `patient = ${q(me.id)} && date = ${q(today)}`, sort: 'created' }),
  ]);
  const todays = diet?.meals?.[isoWeekday()] || {};
  const planned = SLOTS.filter(([k]) => todays[k]);
  const bySlot = {};
  for (const l of logs) (bySlot[l.slot] ||= []).push(l);

  document.getElementById('plate').replaceChildren(plate(planned.map(([k]) => ({ slot: k, done: !!bySlot[k] }))));

  if (!diet) statusEl.textContent = 'Tu nutrióloga o nutriólogo aún no te asigna una dieta. Puedes registrar tus comidas de todos modos.';
  else if (!planned.length) statusEl.textContent = 'Hoy no hay comidas en tu plan. Puedes registrar lo que comas.';
  else statusEl.textContent = '';

  // Planned meals, plus any extra slot the patient logged that is not in the plan.
  const shown = SLOTS.filter(([k]) => todays[k] || bySlot[k]);
  for (const [key, label] of shown) {
    const done = bySlot[key] || [];
    const seen = done.length && done.every((l) => l.seen_at);
    const thumbs = h('div', { class: 'plato-meal-thumbs' });
    for (const l of done) {
      const img = h('img', { alt: `Tu foto de ${label.toLowerCase()}`, width: 48, height: 48 });
      photoUrl(l).then((u) => { img.src = u; }).catch(() => {});
      thumbs.append(img, h('button', {
        class: 'btn', 'data-variant': 'ghost', 'data-size': 'icon-sm', type: 'button', 'aria-label': `Borrar esta foto de ${label.toLowerCase()}`,
        onclick: async () => {
          if (!confirm('¿Borrar esta foto?')) return;
          try { await remove('meal_logs', l.id); } catch (e) {
            toast(e.status === 404 ? 'Solo puedes borrar fotos del mismo día.' : e.message, 'error');
            return;
          }
          location.reload();
        },
      }, icon('trash', 14)));
    }
    mealsEl.append(h('li', { class: 'plato-meal' },
      h('span', { class: 'plato-swatch', style: `--swatch: var(--slot-${key})`, 'aria-hidden': 'true' }),
      h('div', {},
        h('h3', { text: label }),
        todays[key] ? h('p', { text: todays[key] }) : h('p', { class: 'plato-muted', text: 'Fuera de tu plan' }),
        done.length ? h('span', { class: `plato-meal-status${seen ? ' is-seen' : ''}` }, icon(seen ? 'eye' : 'check', 14),
          seen ? 'Vista por tu nutrióloga/o' : 'Registrada') : null,
        done.length ? thumbs : null,
        ...done.map((l) => feedbackEl(l, { from: 'Tu nutrióloga/o', isNew: isNewSince(l, fbSince) }))),
      h('a', {
        class: 'btn', 'data-variant': done.length ? 'outline' : null, 'data-size': 'sm',
        href: `/log.html?slot=${key}`, 'aria-label': `${done.length ? 'Otra foto' : 'Registrar'}: ${label}`,
      }, icon('camera', 16), done.length ? 'Otra' : 'Registrar')));
  }
} catch (e) {
  statusEl.textContent = e.message;
  document.getElementById('plate').replaceChildren();
}

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
