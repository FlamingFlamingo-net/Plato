// shell.js — shared chrome for the patient app: top bar with the nutritionist's name, bottom nav, offline banner.
import { requireRole, view, list, q, signOut, dateOnly } from './api.js';
import { lastSeen } from './feedback.js';
import { h, icon, offlineBanner, isMinor } from './ui.js';

export async function patientShell(current) {
  offlineBanner();
  const me = await requireRole('patients');
  const top = h('header', { class: 'plato-top' },
    h('a', { class: 'plato-brand', href: '/today.html' }, h('img', { src: '/icons/icon-192.png', alt: '', width: 28, height: 28 }), 'Plato'),
    h('div', { class: 'plato-row' },
      h('button', { id: 'install-app', class: 'btn', 'data-variant': 'secondary', 'data-size': 'sm', type: 'button', hidden: true }, 'Instalar app'),
      h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', onclick: signOut }, 'Salir')));
  const help = h('p', { id: 'install-help', class: 'plato-hint', hidden: true, style: 'text-align:center;margin:0.5rem 1rem 0' },
    'En iPhone o iPad: toca Compartir y luego "Agregar a inicio".');
  document.body.prepend(h('a', { class: 'skip-link', href: '#main' }, 'Saltar al contenido'), top, help);

  const link = (href, key, label, ic) => h('a', { href, 'aria-current': current === key ? 'page' : null }, icon(ic, 22), label);
  document.body.append(h('nav', { class: 'plato-bottom-nav', 'aria-label': 'Secciones' },
    link('/today.html', 'today', 'Hoy', 'home'),
    link('/log.html', 'log', 'Registrar', 'camera'),
    link('/progress.html', 'progress', 'Progreso', 'chart')));

  // A dot on Hoy / Progreso when the nutritionist left feedback this phone has not shown yet.
  const dot = (key, label) => {
    const a = document.querySelector(`.plato-bottom-nav a[href="/${key}.html"]`);
    if (a && !a.querySelector('.plato-nav-dot')) a.append(h('span', { class: 'plato-nav-dot', role: 'img', 'aria-label': label }));
  };
  const newer = (coll, kind) => list(coll, {
    filter: `patient = ${q(me.id)} && feedback_at != ""${lastSeen(kind) ? ` && feedback_at > ${q(lastSeen(kind))}` : ''}`, perPage: 1, fields: 'id',
  }).catch(() => []);
  if (current !== 'today') newer('meal_logs', 'meal').then((r) => { if (r.length) dot('today', 'Retroalimentación nueva'); });
  if (current !== 'progress') newer('progress_photos', 'progress').then((r) => { if (r.length) dot('progress', 'Retroalimentación nueva'); });

  // Age limits: no progress photos under 18 (the server refuses too). Hide the way in.
  const minor = isMinor(dateOnly(me.birth_date));
  if (minor) document.querySelectorAll('.plato-log-type a[href="/progress-photo.html"]').forEach((a) => a.remove());

  // The install script runs on load; it finds the button we just added.
  document.dispatchEvent(new Event('plato:install-ready'));

  let nutritionist = null;
  try { nutritionist = await view('nutritionists', me.nutritionist); } catch { /* offline or removed */ }
  return { me, nutritionist, minor };
}
