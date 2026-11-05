// sw.js — app shell cache + appointment notifications (push). Data is never cached (Offline: off): screens talk to PocketBase.
// Bump VERSION on every release, and the ?v= on CSS/JS links, so open tabs move to the new code.
const VERSION = 'plato-v26';
const PAGES = ['/', '/index.html', '/patients.html', '/patient.html', '/join.html', '/today.html', '/log.html', '/progress.html', '/diet-print.html', '/export.html', '/activity.html', '/progress-photo.html', '/settings.html', '/templates.html', '/home.html', '/agenda.html'];
const SHELL = [
  ...PAGES,
  '/manifest.webmanifest',
  '/css/theme.css?v=1', '/css/app.css?v=1', '/css/print.css?v=1',
  '/js/install.js?v=1',
  '/js/index.js?v=1', '/js/patients.js?v=1', '/js/patient.js?v=1', '/js/join.js?v=1',
  '/js/today.js?v=1', '/js/log.js?v=1', '/js/progress.js?v=1', '/js/diet-print.js?v=1', '/js/export.js?v=1', '/js/activity-log.js?v=1', '/js/progress-photo.js?v=1', '/js/settings.js?v=1', '/js/templates.js?v=1', '/js/home.js?v=1', '/js/agenda.js?v=1',
  '/js/api.js', '/js/ui.js', '/js/charts.js', '/js/shell.js', '/js/week.js', '/js/printing.js', '/js/activity.js', '/js/photo.js', '/js/progress-photos.js', '/js/feedback.js', '/js/feedback-dialog.js', '/js/goals.js', '/js/appointments.js', '/js/patient-appts.js', '/js/settings-types.js', '/js/settings-calendar.js', '/js/zone.js', '/js/push.js', '/js/list-tabs.js', '/js/next-appt.js', '/js/mood.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
  '/vendor/basecoat-1.0.2/basecoat.cdn.min.css',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function store(request, response) {
  if (response && response.ok) {
    const copy = response.clone();
    caches.open(VERSION).then((cache) => cache.put(request, copy));
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_/')) return; // never cache data, photos or admin

  if (request.mode === 'navigate') {
    // Pages: network first; offline → the cached page (query string ignored, e.g. patient.html?id=…).
    event.respondWith(
      fetch(request, { cache: 'no-cache' })
        .then((response) => store(new Request(url.pathname), response))
        .catch(() => caches.match(url.pathname, { ignoreSearch: true })
          .then((hit) => hit || caches.match('/index.html'))),
    );
    return;
  }

  // Static files: cache first.
  event.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((response) => store(request, response))),
  );
});

// ---- Appointment notifications (spec "Appointment reminders + clinic time zone", slice 2) ----
// The server sends only { kind, at, minutes, type, zone }; the phone writes the text in its own time zone and adds
// the clinic time when it gives another hour. Tapping opens Hoy.
function apptText(m) {
  const at = new Date(m.at);
  const fmt = (o, z) => new Intl.DateTimeFormat('es-MX', z ? { ...o, timeZone: z } : o).format(at);
  const time = (z) => fmt({ hour: 'numeric', minute: '2-digit' }, z);
  const day = (z) => fmt({ weekday: 'long' }, z);
  const ymd = (z) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' }, z);
  let clinic = '';
  try {
    if (m.zone && time(m.zone) !== time()) clinic = ` (${ymd(m.zone) !== ymd() ? `${day(m.zone)} ` : ''}${time(m.zone)} hora del consultorio)`;
  } catch { clinic = ''; }
  const when = `${day()} ${time()}${clinic}`;
  const type = m.type ? ` · ${m.type}` : '';
  switch (m.kind) {
    case 'day': return { title: 'Mañana tienes cita', body: `${when}${type}` };
    case 'hour': return { title: 'Tu cita es en 1 hora', body: `${time()}${clinic}${type}` };
    case 'moved': return { title: 'Tu cita cambió', body: `Ahora: ${when}` };
    case 'cancelled': return { title: 'Tu cita se canceló', body: when };
    default: return null;
  }
}

self.addEventListener('push', (event) => {
  let m = null;
  try { m = event.data ? event.data.json() : null; } catch { m = null; }
  const t = m && apptText(m);
  if (!t) return;
  event.waitUntil(self.registration.showNotification(t.title, {
    body: t.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `appt-${m.id}`,          // a newer notice about the same appointment replaces the older one
    data: { url: '/today.html' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/today.html', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((wins) => {
    const open = wins.find((w) => w.url.startsWith(self.location.origin));
    return open ? open.navigate(url).then((w) => (w || open).focus()) : self.clients.openWindow(url);
  }));
});
