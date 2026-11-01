// Appointment notifications, screens (spec "Feature: Appointment reminders + clinic time zone", slice 2).
// Usage: node tools/reminder_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server)
// Headless Chrome has no real push service, so a stand-in subscription (made before the page loads) plays the
// phone's push registration; the server side of sending is covered by tools/push_check.mjs.
import { launch } from './cdp.mjs';
import { createECDH, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const api = async (path, { method = 'GET', body, token = t.nutritionist.token } = {}) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: token }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const NID = t.nutritionist.record.id, ANA = t.ana.token;
const pb = (ms) => new Date(ms).toISOString().replace('T', ' ');
await api(`/api/collections/nutritionists/records/${NID}`, { method: 'PATCH', body: { timezone: 'America/Chihuahua' } });
const start = Math.ceil((Date.now() + 2 * 864e5) / 300000) * 300000;
await api('/api/collections/appointments/records', { method: 'POST', body: { nutritionist: NID, patient: t.ana_id, starts_at: pb(start), duration_min: 30, type: 'Consulta de mediciones' } });
const anaSubs = async () => (await api('/api/collections/push_subscriptions/records', { token: ANA })).json.totalItems;

// The stand-in push registration: real-looking keys, an endpoint on the test push host.
const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
const FAKE = `(() => {
  const bin = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)).buffer;
  const key = bin(${JSON.stringify(ecdh.getPublicKey().toString('base64'))}), auth = bin(${JSON.stringify(randomBytes(16).toString('base64'))});
  const make = () => ({ endpoint: 'http://host.docker.internal:8099/sub/ui-' + (localStorage.getItem('fake.sub') || 'x'),
    getKey: (n) => (n === 'p256dh' ? key : auth), unsubscribe: async () => { localStorage.removeItem('fake.sub'); return true; } });
  if (window.PushManager) {
    PushManager.prototype.subscribe = async function () { localStorage.setItem('fake.sub', '1'); return make(); };
    PushManager.prototype.getSubscription = async function () { return localStorage.getItem('fake.sub') ? make() : null; };
  }
})();`;

const browser = await launch({ port: 9352, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport, { ua, notifications = 'granted' } = {}) {
  const p = await browser.newPage(viewport);
  if (ua) await p.userAgent(ua);
  await p.permission('notifications', notifications, BASE);
  await p.beforeLoad(FAKE);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const PHONE = { width: 390, height: 844, mobile: true };
const hoy = async (p, ready) => {
  await p.goto(`${BASE}/today.html`);
  await p.waitFor(`document.getElementById('next-appt-card') && (${ready})`, 15000);
};

const ana = await as('ana', PHONE);
await step('R1', async () => {
  await hoy(ana, `document.getElementById('push-invite')`);
  const text = await ana.text('#push-invite');
  check('R1 Hoy: one quiet invitation under "Tu próxima cita"', text.includes('¿Te avisamos antes de tus citas?') && text.includes('Activar avisos') && text.includes('Ahora no'), text);
  check('R1 it sits inside the appointments area, after the card', await ana.eval(`document.getElementById('next-appt-card').nextElementSibling?.id === 'push-box'`));
  check('R1 no sideways scroll on a 390 px phone', await ana.eval(`document.documentElement.scrollWidth <= innerWidth`));
  await ana.screenshot(`${OUT}/invite.png`, { full: false });
});
await step('R2', async () => {
  await ana.click('#push-no');
  await ana.waitFor(`document.getElementById('push-link')`);
  check('R2 "Ahora no" hides the invitation, leaving a small "Avisos de citas" link', !(await ana.eval(`!!document.getElementById('push-invite')`)));
  await hoy(ana, `document.getElementById('push-link')`);
  check('R2 …and it stays hidden on this phone after a reload', !(await ana.eval(`!!document.getElementById('push-invite')`)));
});
await step('R3', async () => {
  await ana.click('#push-link');
  await ana.waitFor(`document.getElementById('push-on')`, 15000);
  check('R3 turning on: "Avisos de citas: activados · Desactivar"', (await ana.text('#push-on')).includes('Avisos de citas: activados'));
  check('R3 the server has her phone', (await anaSubs()) === 1);
  await hoy(ana, `document.getElementById('push-on')`);
  check('R3 still on after a reload', true);
  await ana.screenshot(`${OUT}/on.png`, { full: false });
});
await step('R4', async () => {
  const nutri = await as('nutritionist', { width: 1366, height: 900 });
  await nutri.goto(`${BASE}/patient.html?id=${t.ana_id}`);
  await nutri.waitFor(`document.getElementById('p-push')`);
  check('R4 the nutritionist sees "Avisos: activados" on Ana\'s page', (await nutri.text('#p-push')) === 'Avisos: activados');
  await nutri.screenshot(`${OUT}/nutri-badge.png`, { full: false });
  await nutri.goto(`${BASE}/patient.html?id=${t.carlos_id}`);
  await nutri.waitFor(`document.getElementById('p-push')`);
  check('R4 …and "Avisos: no activados" on Carlos\'s', (await nutri.text('#p-push')) === 'Avisos: no activados');
});
await step('R5', async () => {
  await ana.click('#push-off');
  await ana.waitFor(`document.getElementById('push-invite') || document.getElementById('push-link')`, 15000);
  check('R5 Desactivar: the server forgets her phone', (await anaSubs()) === 0);
});
await step('R6', async () => {
  const iphone = await as('ana', PHONE, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1' });
  await hoy(iphone, `document.getElementById('push-ios')`);
  check('R6 iPhone in Safari (not installed): the install hint instead of the button', (await iphone.text('#push-ios')).includes('instala la app') && !(await iphone.eval(`!!document.getElementById('push-yes')`)));
});
await step('R7', async () => {
  const blocked = await as('ana', PHONE, { notifications: 'denied' });
  await hoy(blocked, `document.getElementById('push-blocked')`);
  check('R7 notifications blocked on the phone: says where to turn them on', (await blocked.text('#push-blocked')).includes('ajustes del teléfono'));
});
await step('R8', async () => {
  // The service worker's notification text, run in a page whose clock is in Tijuana (clinic: Chihuahua).
  const tj = await browser.newPage(PHONE);
  await tj.timezone('America/Tijuana');
  await tj.goto(`${BASE}/manifest.webmanifest`);
  const out = await tj.eval(`(async () => {
    const src = await (await fetch('/sw.js')).text();
    const handlers = {}, shown = [], opened = [];
    const self = { addEventListener: (n, f) => { handlers[n] = f; }, location: { origin: location.origin },
      registration: { showNotification: async (title, o) => { shown.push({ title, ...o }); } },
      clients: { matchAll: async () => [], openWindow: async (u) => { opened.push(u); } } };
    new Function('self', 'caches', src)(self, {});
    const at = '2026-12-03T22:00:00.000Z';   // 4:00 p.m. Chihuahua, 2:00 p.m. Tijuana
    const fire = async (m) => { let p = null; handlers.push({ data: { json: () => m }, waitUntil: (x) => { p = x; } }); await p; };
    for (const kind of ['day', 'hour', 'moved', 'cancelled', 'spam']) await fire({ v: 1, kind, id: 'a1', at, minutes: 30, type: 'Consulta de mediciones', zone: 'America/Chihuahua' });
    await fire({ v: 1, kind: 'hour', id: 'a2', at, minutes: 30, type: 'Consulta de mediciones', zone: 'America/Tijuana' });
    let done = null; handlers.notificationclick({ notification: { close() {}, data: { url: '/today.html' } }, waitUntil: (x) => { done = x; } }); await done;
    return { shown, opened };
  })()`);
  const [day, hour, moved, cancelled, same] = out.shown;
  check('R8 "Mañana tienes cita": her own time + the clinic time + the type',
    day?.title === 'Mañana tienes cita' && day.body === 'jueves 2:00 p.m. (4:00 p.m. hora del consultorio) · Consulta de mediciones', JSON.stringify(day));
  check('R8 "Tu cita es en 1 hora"', hour?.title === 'Tu cita es en 1 hora' && hour.body.startsWith('2:00 p.m. (4:00 p.m. hora del consultorio)'), JSON.stringify(hour));
  check('R8 "Tu cita cambió — Ahora: …"', moved?.title === 'Tu cita cambió' && moved.body.startsWith('Ahora: jueves 2:00 p.m.'), JSON.stringify(moved));
  check('R8 "Tu cita se canceló"', cancelled?.title === 'Tu cita se canceló', JSON.stringify(cancelled));
  check('R8 an unknown message shows nothing; same zone shows no clinic note', out.shown.length === 5 && same.body === '2:00 p.m. · Consulta de mediciones', JSON.stringify(out.shown.map((x) => x.body)));
  check('R8 one notification per appointment (a newer one replaces it)', day.tag === 'appt-a1' && cancelled.tag === 'appt-a1');
  check('R8 tapping it opens Hoy', out.opened[0]?.endsWith('/today.html'), JSON.stringify(out.opened));
});

const errs = ana.errors.filter((e) => !/host\.docker\.internal/.test(e)).join(' | ');
check('no console errors', !errs, errs);
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
