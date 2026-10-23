// shell.js — shared chrome for the patient app: top bar with the nutritionist's name, bottom nav, offline banner.
import { requireRole, view, signOut } from './api.js';
import { h, icon, offlineBanner } from './ui.js';

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

  // The install script runs on load; it finds the button we just added.
  document.dispatchEvent(new Event('plato:install-ready'));

  let nutritionist = null;
  try { nutritionist = await view('nutritionists', me.nutritionist); } catch { /* offline or removed */ }
  return { me, nutritionist };
}
