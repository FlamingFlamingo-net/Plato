// push.js — "Avisos de citas" on the patient's Hoy (spec "Feature: Appointment reminders + clinic time zone", slice 2).
// One quiet invitation under "Tu próxima cita"; the phone's own permission question only after a tap.
// iPhone: Apple allows notifications only to the installed app (Safari → Compartir → Agregar a inicio, iOS 16.4+).
import { request, create, list, remove, q } from './api.js';
import { h, toast, busy } from './ui.js';

const DISMISS = 'plato.push.dismissed';
const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

async function currentSubscription() {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}
// On = this phone has a subscription AND the server still has it (it removes phones that are gone).
async function isOn(me) {
  const sub = await currentSubscription().catch(() => null);
  if (!sub || Notification.permission !== 'granted') return false;
  try { return (await list('push_subscriptions', { filter: `patient = ${q(me.id)} && endpoint = ${q(sub.endpoint)}`, perPage: 1 })).length > 0; } catch { return false; }
}

async function turnOn(me) {
  if ((await Notification.requestPermission()) !== 'granted') return false;
  const reg = await navigator.serviceWorker.ready;
  const { key } = await request('/api/plato/push/key');
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
  await create('push_subscriptions', { patient: me.id, endpoint: sub.endpoint, p256dh: b64u(sub.getKey('p256dh')), auth: b64u(sub.getKey('auth')) });
  return true;
}

async function turnOff(me) {
  const sub = await currentSubscription().catch(() => null);
  if (sub) {
    try { for (const r of await list('push_subscriptions', { filter: `patient = ${q(me.id)} && endpoint = ${q(sub.endpoint)}`, perPage: 5 })) await remove('push_subscriptions', r.id); } catch { /* removed already */ }
    await sub.unsubscribe().catch(() => {});
  }
}

// el: a container under the next-appointment card. Renders one of: invitation / iPhone install hint / on / blocked / a small link.
export async function mountPushInvite(el, me) {
  const render = async () => {
    if (!supported() && !isIOS()) { el.replaceChildren(); el.hidden = true; return; }
    el.hidden = false;
    if (isIOS() && !standalone()) {
      el.replaceChildren(h('p', { class: 'plato-push plato-muted plato-small', id: 'push-ios' },
        'Para recibir avisos de tus citas, instala la app: toca Compartir y luego “Agregar a inicio”.'));
      return;
    }
    if (!supported()) { el.replaceChildren(); el.hidden = true; return; }
    if (Notification.permission === 'denied') {
      el.replaceChildren(h('p', { class: 'plato-push plato-muted plato-small', id: 'push-blocked' },
        'Los avisos están bloqueados en este teléfono. Puedes activarlos en los ajustes del teléfono.'));
      return;
    }
    if (await isOn(me)) {
      el.replaceChildren(h('p', { class: 'plato-push plato-muted plato-small', id: 'push-on' }, 'Avisos de citas: activados · ',
        h('button', { class: 'btn', 'data-variant': 'link', 'data-size': 'sm', type: 'button', id: 'push-off', onclick: async (ev) => {
          await busy(ev.currentTarget, () => turnOff(me));
          toast('Avisos desactivados en este teléfono.');
          render();
        } }, 'Desactivar')));
      return;
    }
    const activate = async (ev) => {
      let ok = false;
      try { ok = await busy(ev.currentTarget, () => turnOn(me)); } catch (e) { toast(e.status === 0 ? 'Sin conexión. Inténtalo de nuevo.' : 'No se pudieron activar los avisos en este teléfono.', 'error'); return; }
      if (ok) { localStorage.removeItem(DISMISS); toast('Listo: te avisaremos un día antes y una hora antes.'); }
      render();
    };
    if (localStorage.getItem(DISMISS)) {
      el.replaceChildren(h('p', { class: 'plato-push plato-small', id: 'push-later' },
        h('button', { class: 'btn', 'data-variant': 'link', 'data-size': 'sm', type: 'button', id: 'push-link', onclick: activate }, 'Avisos de citas')));
      return;
    }
    el.replaceChildren(h('div', { class: 'plato-push plato-push-invite', id: 'push-invite', role: 'group', 'aria-labelledby': 'push-q' },
      h('p', { id: 'push-q', text: '¿Te avisamos antes de tus citas?' }),
      h('div', { class: 'plato-row' },
        h('button', { class: 'btn', 'data-size': 'sm', type: 'button', id: 'push-yes', onclick: activate }, 'Activar avisos'),
        h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', id: 'push-no', onclick: () => {
          localStorage.setItem(DISMISS, '1');
          render();
          document.getElementById('push-link')?.focus();
        } }, 'Ahora no'))));
  };
  await render();
}
