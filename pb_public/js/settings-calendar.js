// settings-calendar.js — Ajustes → "Tu agenda en Google Calendar" (spec "Feature: Agenda", Slice 2).
// A private subscription address: Google Calendar adds it once ("Desde URL") and refreshes it on its own schedule.
// The token is read from calendar_feeds (nutritionist only) and changed only through the server routes.
import { list, request } from './api.js';
import { h, icon, toast, busy } from './ui.js';

export const feedUrl = (token) => `${location.origin}/api/plato/calendar/${token}.ics`;
export async function myFeed() {
  try { const [f] = await list('calendar_feeds', { perPage: 1 }); return f || null; } catch { return null; }
}

export function mountCalendar(section) {
  let feed = null;
  const act = async (path, btn, msg) => {
    try {
      const r = await busy(btn, () => request(`/api/plato/calendar/${path}`, { method: 'POST', body: {} }));
      feed = r.enabled ? { token: r.token, enabled: true } : { ...(feed || {}), enabled: false };
    } catch (e) { toast(e.status === 0 ? 'Sin conexión. Inténtalo de nuevo.' : e.message, 'error'); return; }
    render();
    toast(msg);
    section.querySelector('button')?.focus();
  };

  function render() {
    if (!feed?.enabled) {
      section.replaceChildren(
        h('p', { class: 'plato-muted', style: 'margin:0', text: 'Ve tus citas de AHT Fitness en tu Google Calendar, como un calendario aparte. Solo tú lo ves; tus pacientes no.' }),
        h('div', { class: 'plato-row' }, h('button', { class: 'btn', type: 'button', id: 'cal-enable',
          onclick: (ev) => act('enable', ev.currentTarget, 'Enlace activado. Agrégalo en Google Calendar.') }, icon('calendar', 16), 'Activar enlace')));
      return;
    }
    const url = feedUrl(feed.token);
    const input = h('input', { class: 'input', id: 'cal-url', readonly: true, value: url, spellcheck: 'false' });
    input.addEventListener('focus', () => input.select());
    const copy = async (ev) => {
      try { await navigator.clipboard.writeText(url); toast('Enlace copiado. Pégalo en Google Calendar.'); }
      catch { input.focus(); input.select(); toast('Selecciona el enlace y cópialo.', 'error'); }
      ev.currentTarget.focus();
    };
    section.replaceChildren(
      h('div', { class: 'field' }, h('label', { for: 'cal-url', text: 'Tu enlace privado' }),
        h('div', { class: 'plato-row plato-row--nowrap' }, input,
          h('button', { class: 'btn', type: 'button', id: 'cal-copy', onclick: copy }, icon('copy', 16), 'Copiar enlace'))),
      h('ol', { class: 'plato-cal-steps', 'aria-label': 'Cómo agregarlo' },
        h('li', {}, 'Abre Google Calendar ', h('strong', { text: 'en una computadora' }), ' (la app del teléfono no permite agregar por enlace).'),
        h('li', {}, 'Junto a “Otros calendarios”, toca ', h('strong', { text: '+' }), ' → ', h('strong', { text: 'Desde URL' }), '.'),
        h('li', {}, 'Pega el enlace → ', h('strong', { text: 'Agregar calendario' }), '. Listo: también aparece en tu teléfono.')),
      h('p', { class: 'plato-muted plato-small', style: 'margin:0', text: 'Google actualiza este calendario cada varias horas (Google decide cuándo). Las citas nuevas o cambiadas pueden tardar en aparecer allá; aquí siempre están al momento. Las citas canceladas desaparecen.' }),
      h('p', { class: 'plato-muted plato-small', style: 'margin:0', text: 'Trata este enlace como una contraseña: quien lo tenga ve los nombres y horarios de tus citas (nunca tus notas privadas).' }),
      h('div', { class: 'plato-row' },
        h('button', { class: 'btn', 'data-variant': 'outline', type: 'button', id: 'cal-rotate', onclick: (ev) => {
          if (!confirm('¿Cambiar el enlace? El actual deja de funcionar y tendrás que agregar el nuevo en Google Calendar.')) return;
          act('rotate', ev.currentTarget, 'Enlace nuevo listo. Agrégalo en Google Calendar y quita el anterior.');
        } }, 'Cambiar enlace'),
        h('button', { class: 'btn', 'data-variant': 'ghost', type: 'button', id: 'cal-disable', onclick: (ev) => {
          if (!confirm('¿Desactivar el enlace? Google Calendar dejará de recibir tus citas.')) return;
          act('disable', ev.currentTarget, 'Enlace desactivado.');
        } }, 'Desactivar')));
  }
  myFeed().then((f) => { feed = f; render(); });
}
