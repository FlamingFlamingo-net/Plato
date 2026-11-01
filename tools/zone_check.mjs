// Clinic time zone checks (spec "Feature: Appointment reminders + clinic time zone", slice 1).
// Usage: node tools/zone_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded server; nobody has a zone yet)
// Emulates the computer's and the phone's time zones through Chrome DevTools.
import { launch } from './cdp.mjs';
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
const timeIn = (d, z) => new Intl.DateTimeFormat('es-MX', { hour: 'numeric', minute: '2-digit', timeZone: z }).format(d);
const ymdIn = (d, z) => new Intl.DateTimeFormat('en-CA', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
const NID = t.nutritionist.record.id;
// The appointment day: 3 days ahead (as a Chihuahua calendar day).
const DAY = ymdIn(new Date(Date.now() + 3 * 864e5), 'America/Chihuahua');

const browser = await launch({ port: 9351, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport, zone) {
  const p = await browser.newPage(viewport);
  await p.timezone(zone);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}

let nutri, ana, appt;
await step('Z1', async () => {
  check('Z1 a nutritionist starts without a clinic zone', !(await api(`/api/collections/nutritionists/records/${NID}`)).json.timezone);
  nutri = await as('nutritionist', { width: 1366, height: 900 }, 'America/Chihuahua');
  await nutri.goto(`${BASE}/home.html`);
  await nutri.waitFor(`document.getElementById('h-tabs') || document.querySelector('[role=tablist]')`);
  await sleep(500);
  const z = (await api(`/api/collections/nutritionists/records/${NID}`)).json.timezone;
  check('Z1 the first open saves the computer\'s zone as the clinic zone', z === 'America/Chihuahua', z);
  await nutri.goto(`${BASE}/settings.html`);
  await nutri.waitFor(`document.getElementById('pr-zone')?.options.length > 100`);
  const sel = await nutri.eval(`({ v: document.getElementById('pr-zone').value, text: document.getElementById('pr-zone').selectedOptions[0].textContent, first: document.getElementById('pr-zone').options[0].value })`);
  check('Ajustes shows "Zona horaria del consultorio" with it selected (Mexico first, with the offset)',
    sel.v === 'America/Chihuahua' && /Chihuahua \(UTC−6\)/.test(sel.text) && sel.first === 'America/Mexico_City', JSON.stringify(sel));
});

await step('Z2', async () => {
  // The nutritionist travels: computer in Tijuana, clinic still Chihuahua.
  await nutri.close?.();
  nutri = await as('nutritionist', { width: 1366, height: 900 }, 'America/Tijuana');
  await nutri.goto(`${BASE}/agenda.html?day=${DAY}`);
  await nutri.waitFor(`document.querySelectorAll('.plato-cal-day').length === 42`);
  const hint = await nutri.eval(`({ hidden: document.getElementById('clinic-hint').hidden, text: document.getElementById('clinic-hint').textContent })`);
  check('Z2 the Agenda says "Horario del consultorio (Chihuahua)" on a computer in another zone', !hint.hidden && hint.text.includes('Horario del consultorio (Chihuahua)'), JSON.stringify(hint));
  await nutri.click('#new-appt');
  await nutri.waitFor(`document.getElementById('ap-dialog')?.open`);
  await nutri.eval(`(() => { const s = document.getElementById('ap-patient'); s.value = ${JSON.stringify(t.ana_id)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await nutri.fill('#ap-date', DAY);
  await nutri.fill('#ap-time', '16:00');
  await nutri.fill('#ap-min', '30');
  check('Z2 the dialog says the time is clinic time', (await nutri.text('#ap-dialog header p')).includes('Horario del consultorio (Chihuahua)'));
  await nutri.click('#ap-save');
  await nutri.waitFor(`!document.getElementById('ap-dialog')`);
  const rows = (await api(`/api/collections/appointments/records?filter=${encodeURIComponent(`patient = "${t.ana_id}"`)}`)).json.items || [];
  appt = rows[0];
  const at = new Date(appt.starts_at.replace(' ', 'T'));
  check('Z2 "4:00 p.m." typed on a Tijuana computer is stored as 4:00 p.m. Chihuahua', timeIn(at, 'America/Chihuahua') === '4:00 p.m.' && ymdIn(at, 'America/Chihuahua') === DAY, appt.starts_at);
  await nutri.waitFor(`document.getElementById('day-list').textContent.includes('Ana')`);
  check('Z2 the Agenda lists it at 4:00 p.m. (clinic time)', (await nutri.text('#day-list')).includes('4:00 p.m.'), await nutri.text('#day-list'));
  await nutri.goto(`${BASE}/patient.html?id=${t.ana_id}`);
  await nutri.waitFor(`document.querySelector('.plato-p-appt-head strong')`);
  check('Z2 the patient page shows the same clinic time', (await nutri.text('.plato-p-appt-head')).includes('4:00 p.m.'));
});

await step('Z3', async () => {
  // Ana's phone in another zone: her own time plus the clinic time.
  ana = await as('ana', { width: 390, height: 844, mobile: true }, 'America/Tijuana');
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`document.getElementById('next-appt-card')`);
  const text = await ana.text('#next-appt-card');
  const own = timeIn(new Date(appt.starts_at.replace(' ', 'T')), 'America/Tijuana');
  check('Z3 a phone in Tijuana: her own time plus "(4:00 p.m. hora del consultorio)"', text.includes(`${own} (4:00 p.m. hora del consultorio)`), text);
  await ana.screenshot(`${OUT}/ana-tijuana.png`, { full: false });
  const juarez = await as('ana', { width: 390, height: 844, mobile: true }, 'America/Chihuahua');
  await juarez.goto(`${BASE}/today.html`);
  await juarez.waitFor(`document.getElementById('next-appt-card')`);
  const same = await juarez.text('#next-appt-card');
  check('Z3 a phone in the clinic zone: only "4:00 p.m.", no clinic note', same.includes('4:00 p.m.') && !same.includes('hora del consultorio'), same);
});

await step('Z4', async () => {
  // Ajustes: change the clinic zone to Cancún (UTC−5): the appointment keeps its exact moment, shown at 5:00 p.m.
  await nutri.goto(`${BASE}/settings.html`);
  await nutri.waitFor(`document.getElementById('pr-zone')?.options.length > 100`);
  await nutri.eval(`document.getElementById('pr-zone').value = 'America/Cancun'`);
  await nutri.click('#profile-save');
  await sleep(800);
  const z = (await api(`/api/collections/nutritionists/records/${NID}`)).json.timezone;
  check('Z4 Ajustes saves another clinic zone', z === 'America/Cancun', z);
  const after = (await api(`/api/collections/appointments/records/${appt.id}`)).json.starts_at;
  check('Z4 existing appointments keep their exact moment', after === appt.starts_at, `${appt.starts_at} -> ${after}`);
  await nutri.goto(`${BASE}/agenda.html?day=${DAY}`);
  await nutri.waitFor(`document.getElementById('day-list').textContent.includes('Ana')`);
  check('Z4 the Agenda now shows it in Cancún time (5:00 p.m.)', (await nutri.text('#day-list')).includes('5:00 p.m.'), await nutri.text('#day-list'));
  await nutri.screenshot(`${OUT}/agenda-hint.png`, { full: false });
});

await step('Z5', async () => {
  const bad = await api(`/api/collections/nutritionists/records/${NID}`, { method: 'PATCH', body: { timezone: 'no es una zona' } });
  check('Z5 a malformed zone is refused by the server', bad.status === 400, bad.status);
  const pat = await api(`/api/collections/nutritionists/records/${NID}`, { method: 'PATCH', body: { timezone: 'Europe/Madrid' }, token: t.ana.token });
  check('Z5 a patient cannot change the clinic zone', pat.status === 404 || pat.status === 403, pat.status);
});

const errs = [nutri, ana].flatMap((p) => p?.errors || []).join(' | ');
check('no console errors', !errs, errs);
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
