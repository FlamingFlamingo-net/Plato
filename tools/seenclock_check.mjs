// "New" dots must follow the server's time, not the phone's clock (card "[bug] 'New' dots compare the phone's clock with the server's").
// The patient's browser runs 10 minutes FAST; the nutritionist changes an appointment and leaves feedback right after the patient looked.
// Usage: node tools/seenclock_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server)
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const NID = t.nutritionist.record.id, ANA = t.ana_id;
const api = async (path, method = 'GET', body, token = t.nutritionist.token) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: token }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const pb = (ms) => new Date(ms).toISOString().replace('T', ' ');
const start = Math.ceil((Date.now() + 2 * 864e5) / 300000) * 300000;
const appt = (await api('/api/collections/appointments/records', 'POST', { nutritionist: NID, patient: ANA, starts_at: pb(start), duration_min: 30, type: 'Consulta de mediciones' })).json;
check('setup: an appointment in 2 days', !!appt.id, JSON.stringify(appt).slice(0, 200));
const meal = (await api(`/api/collections/meal_logs/records?filter=${encodeURIComponent(`patient = '${ANA}' && photo != ''`)}&perPage=1`)).json.items[0];
check('setup: a meal photo from yesterday', !!meal);

// the phone's clock is 10 minutes ahead of the server
const FAST = `(() => { const off = 10 * 60 * 1000, D = Date; class F extends D { constructor(...a) { super(...(a.length ? a : [D.now() + off])); } static now() { return D.now() + off; } } window.Date = F; })();`;
const browser = await launch({ port: 9374, profileDir: `${OUT}/chrome-profile` });
const ana = await browser.newPage({ width: 390, height: 844, mobile: true });
await ana.beforeLoad(FAST);
await ana.goto(`${BASE}/manifest.webmanifest`);
await ana.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: t.ana.token, record: t.ana.record, collection: 'patients' }))})`);
const dotOnHoy = () => ana.eval(`!!document.querySelector('.plato-bottom-nav a[href="/today.html"] .plato-nav-dot')`);
const visit = async (path) => { await ana.goto(`${BASE}${path}`); await ana.waitFor(`document.querySelector('.plato-bottom-nav')`, 15000); await sleep(1500); };

await step('C1', async () => {
  check('C1 the phone really runs 10 minutes fast', (await ana.eval('Date.now()')) - Date.now() > 9 * 60 * 1000);
  await visit('/today.html');                 // she sees the appointment and yesterday's feedback-free photo
  await visit('/progress.html');
  check('C1 after looking at Hoy, no dot on Hoy', !(await dotOnHoy()));
  const ch = await api(`/api/collections/appointments/records/${appt.id}`, 'PATCH', { starts_at: pb(start + 3600e3) });
  await visit('/progress.html');
  check('C1 the nutritionist moves the appointment one hour: Hoy gets its dot (the old code missed it with a fast phone)', ch.status === 200 && (await dotOnHoy()), `status ${ch.status}`);
  await visit('/today.html');
  check('C1 Hoy marks the change "Nueva"', (await ana.eval(`!!document.querySelector('#next-appt .plato-new-badge')`)));
  await visit('/progress.html');
  check('C1 after seeing it, the dot goes away', !(await dotOnHoy()));
});

await step('C2', async () => {
  const fb = await api(`/api/collections/meal_logs/records/${meal.id}`, 'PATCH', { feedback_text: 'Muy buen plato, bien balanceado.', feedback_stars: 3 });
  await visit('/progress.html');
  check('C2 feedback on a meal photo right after she looked: Hoy gets its dot', fb.status === 200 && !!fb.json.feedback_at && (await dotOnHoy()), `status ${fb.status} ${fb.json.feedback_at}`);
  await visit('/today.html');
  check('C2 Hoy shows that feedback as new', await ana.eval(`!!document.querySelector('#fb-list .plato-new-badge, #fb-list [class*=new]')`));
  await visit('/progress.html');
  check('C2 after seeing it, the dot goes away', !(await dotOnHoy()));
  const stored = await ana.eval(`localStorage.getItem('plato.feedbackSeen.meal')`);
  check('C2 what the phone remembers is the server\'s feedback time, not its own clock', stored === fb.json.feedback_at, `${stored} vs ${fb.json.feedback_at}`);
});

const errs = ana.errors.filter((e) => !/\b40[134]\b|Failed to load resource/.test(e)).join(' | ');
check('no console errors', !errs, errs);
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
