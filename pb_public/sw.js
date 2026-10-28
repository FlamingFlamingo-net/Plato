// sw.js — app shell cache only. Data is never cached (Offline: off): screens talk to PocketBase.
// Bump VERSION on every release, and the ?v= on CSS/JS links, so open tabs move to the new code.
const VERSION = 'plato-v14';
const PAGES = ['/', '/index.html', '/patients.html', '/patient.html', '/join.html', '/today.html', '/log.html', '/progress.html', '/diet-print.html', '/export.html', '/activity.html', '/progress-photo.html', '/settings.html', '/templates.html', '/home.html'];
const SHELL = [
  ...PAGES,
  '/manifest.webmanifest',
  '/css/theme.css?v=1', '/css/app.css?v=1', '/css/print.css?v=1',
  '/js/install.js?v=1',
  '/js/index.js?v=1', '/js/patients.js?v=1', '/js/patient.js?v=1', '/js/join.js?v=1',
  '/js/today.js?v=1', '/js/log.js?v=1', '/js/progress.js?v=1', '/js/diet-print.js?v=1', '/js/export.js?v=1', '/js/activity-log.js?v=1', '/js/progress-photo.js?v=1', '/js/settings.js?v=1', '/js/templates.js?v=1', '/js/home.js?v=1',
  '/js/api.js', '/js/ui.js', '/js/charts.js', '/js/shell.js', '/js/week.js', '/js/printing.js', '/js/activity.js', '/js/photo.js', '/js/progress-photos.js', '/js/feedback.js', '/js/feedback-dialog.js', '/js/goals.js',
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
