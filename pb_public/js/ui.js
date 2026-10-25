// ui.js — tiny DOM helpers. Data always goes in via textContent, never innerHTML.

export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

// Static, trusted SVG strings only.
export function icon(name, size = 18) {
  const paths = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    camera: '<path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>',
    home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    wifiOff: '<path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.1-1.6M2 8.8a15 15 0 0 1 4.2-2.7M22 8.8A15 15 0 0 0 10.7 5"/><circle cx="12" cy="20" r="1"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
  };
  const span = document.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ''}</svg>`;
  return span.firstElementChild;
}

// Short message at the bottom of the screen. role=status so screen readers hear it.
export function toast(message, kind = 'success') {
  let box = document.getElementById('plato-toasts');
  if (!box) {
    box = h('div', { id: 'plato-toasts', class: 'plato-toasts', role: 'status', 'aria-live': 'polite' });
    document.body.append(box);
  }
  const t = h('div', { class: `plato-toast plato-toast--${kind}` }, icon(kind === 'error' ? 'alert' : 'check', 16), h('span', { text: message }));
  box.append(t);
  setTimeout(() => t.remove(), 4000);
}

// Inline error under a form: role=alert, cleared on next submit.
export function formError(form, message) {
  let el = form.querySelector('.plato-form-error');
  if (!el) {
    el = h('p', { class: 'plato-form-error', role: 'alert' });
    form.append(el);
  }
  el.textContent = message || '';
  el.hidden = !message;
}

// Disables the submit button while a promise runs.
export async function busy(button, fn) {
  const label = button.textContent;
  button.disabled = true;
  button.setAttribute('aria-busy', 'true');
  try { return await fn(); } finally {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    button.textContent = label;
  }
}

const dfLong = new Intl.DateTimeFormat('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
const dfShort = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' });
const tf = new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit' });
const fromYmd = (s) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
// "2026-10-19" is a calendar date (kept as is). "2026-10-25 01:45:00.000Z" is a moment: show its LOCAL date.
const toLocalDay = (s) => (s.length > 10 ? new Date(s.replace(' ', 'T')) : fromYmd(s));
export const longDate = (ymd) => { const s = dfLong.format(toLocalDay(ymd)); return s[0].toUpperCase() + s.slice(1); };
export const shortDate = (ymd) => dfShort.format(toLocalDay(ymd));
export const timeOf = (pbDateTime) => tf.format(new Date(pbDateTime.replace(' ', 'T')));
export const num = (n, digits = 1) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: digits }).format(n);

export function age(birthYmd) {
  if (!birthYmd) return null;
  const b = fromYmd(birthYmd);
  const now = new Date();
  let a = now.getFullYear() - b.getFullYear();
  if (now < new Date(now.getFullYear(), b.getMonth(), b.getDate())) a--;
  return a;
}

// Banner when the device is offline. The installed app still opens; saving waits for a connection.
export function offlineBanner() {
  const bar = h('div', { class: 'plato-offline', role: 'status', hidden: navigator.onLine },
    icon('wifiOff', 16), h('span', { text: 'Sin conexión. Inténtalo de nuevo cuando tengas internet.' }));
  document.body.prepend(bar);
  addEventListener('online', () => { bar.hidden = true; });
  addEventListener('offline', () => { bar.hidden = false; });
}

// Basecoat-styled tabs without Basecoat JS: buttons[role=tab] toggle [role=tabpanel]; ?tab= is kept in the URL.
export function wireTabs(root, onShow) {
  const tabs = [...root.querySelectorAll('[role=tab]')];
  const show = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
    const url = new URL(location.href);
    url.searchParams.set('tab', tab.dataset.tab);
    history.replaceState(null, '', url);
    onShow?.(tab.dataset.tab);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => show(t));
    t.addEventListener('keydown', (e) => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); show(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  const wanted = new URL(location.href).searchParams.get('tab');
  show(tabs.find((t) => t.dataset.tab === wanted) || tabs[0]);
}
