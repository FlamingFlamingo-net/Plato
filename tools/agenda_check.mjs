// tools/agenda_check.mjs — screen acceptance for the agenda (spec "Feature: Agenda — the nutritionist's own calendar", slice 1).
// THROWAWAY server seeded with tools/seed.py (Laura = nutritionist; Ana uses the app; Carlos has no app).
//   node tools/agenda_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const plus = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return d; };
const TODAY = ymd(plus(0)), DAY = ymd(plus(2));      // the appointment day: two days ahead
const mondayOf = (d) => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return ymd(x); };

const browser = await launch({ port: 9346, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const nutri = await as('nutritionist', { width: 1366, height: 900 });
const ana = await as('ana', { width: 390, height: 844, mobile: true });
const openAgenda = async (q = '') => {
  await nutri.goto(`${BASE}/agenda.html${q}`);
  await nutri.waitFor(`document.querySelectorAll('.plato-cal-day').length === 42 && document.getElementById('day-list').children.length > 0`);
  await nutri.eval('window.confirm = () => true');
};
const newAppt = async ({ patient, day, time, minutes = 60, type, note = '' }) => {
  await nutri.click('#new-appt');
  await nutri.waitFor(`document.getElementById('ap-dialog')?.open`);
  await nutri.eval(`(() => { const s = document.getElementById('ap-patient'); s.value = ${JSON.stringify(patient)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await nutri.fill('#ap-date', day);
  await nutri.fill('#ap-time', time);
  await nutri.fill('#ap-min', String(minutes));
  if (type) await nutri.eval(`(() => { const s = document.getElementById('ap-type'); s.value = ${JSON.stringify(type)}; })()`);
  if (note) await nutri.fill('#ap-note', note);
};
const save = async () => { await nutri.click('#ap-save'); await nutri.waitFor(`!document.getElementById('ap-dialog')`); };
const anaHoy = async () => {
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`document.querySelector('#meals li') && (document.getElementById('next-appt').children.length > 0 || document.getElementById('next-appt').hidden)`);
  await sleep(400);
  return ana.eval(`({ hidden: document.getElementById('next-appt').hidden, text: document.getElementById('next-appt').textContent, isNew: document.querySelectorAll('#next-appt .plato-new-badge').length })`);
};

await step('G1', async () => {
  await nutri.goto(`${BASE}/settings.html`);
  await nutri.waitFor(`document.querySelectorAll('#types-list li').length > 0`);
  const n = await nutri.eval(`document.querySelectorAll('#types-list li').length`);
  check('G1 Ajustes lists the 5 starting consultation types', n === 5, n);
  const rows = await nutri.eval(`[...document.querySelectorAll('#types-list li')].map(li => li.querySelectorAll('input')[0].value + '=' + li.querySelectorAll('input')[1].value)`);
  check("G1 they are the client's, with their durations", rows.join() === 'Consulta nutricional inicial=60,Consulta nutricional seguimiento=60,Consulta de entrenamiento=60,Consulta de mediciones=30,Consulta de alto rendimiento deportivo=90', rows.join());
  await nutri.fill('#type-new', 'Consulta deportiva');
  await nutri.click('#type-add');
  await nutri.click('#types-save');
  await nutri.waitFor(`!document.getElementById('types-save').disabled`);
  await sleep(300);
  await nutri.goto(`${BASE}/settings.html`);
  await nutri.waitFor(`document.querySelectorAll('#types-list li').length > 0`);
  const vals = await nutri.eval(`[...document.querySelectorAll('#types-list li')].map(li => li.querySelectorAll('input')[0].value + '=' + li.querySelectorAll('input')[1].value)`);
  check('G1 an added type is saved with its minutes', vals.length === 6 && vals.includes('Consulta deportiva=60'), JSON.stringify(vals));
});

await step('G2', async () => {
  await openAgenda();
  const empty = await nutri.eval(`({ counts: [...document.querySelectorAll('#counts strong')].map(s => s.textContent).join(), today: document.querySelector('.plato-cal-day.is-today')?.dataset.day, sel: document.querySelector('.plato-cal-day[aria-selected=true]')?.dataset.day, lock: document.querySelectorAll('.plato-cal-dot').length })`);
  check('G2 empty agenda: counts 0,0,0, today selected, no dots', empty.counts === '0,0,0' && empty.today === TODAY && empty.sel === TODAY && empty.lock === 0, JSON.stringify(empty));
  await newAppt({ patient: t.ana_id, day: DAY, time: '16:00', type: 'Consulta deportiva', note: 'Revisar dolor de rodilla' });
  const typeOpts = await nutri.eval(`[...document.querySelectorAll('#ap-type option')].map(o => o.value)`);
  check('G2 the dialog offers the saved types', typeOpts.includes('Consulta deportiva') && typeOpts.length === 6, JSON.stringify(typeOpts));
  await nutri.eval(`(() => { const s = document.getElementById('ap-type'); s.value = 'Consulta de mediciones'; s.dispatchEvent(new Event('change')); })()`);
  const m1 = await nutri.eval(`document.getElementById('ap-min').value`);
  await nutri.eval(`(() => { const s = document.getElementById('ap-type'); s.value = 'Consulta de alto rendimiento deportivo'; s.dispatchEvent(new Event('change')); })()`);
  const m2 = await nutri.eval(`document.getElementById('ap-min').value`);
  check("G2 picking a type fills in its duration (mediciones 30, alto rendimiento 90)", m1 === '30' && m2 === '90', `${m1} ${m2}`);
  await nutri.eval(`(() => { const s = document.getElementById('ap-type'); s.value = 'Consulta deportiva'; s.dispatchEvent(new Event('change')); })()`);
  await save();
  await nutri.waitFor(`document.querySelector('.plato-appt')`);
  const d = await nutri.eval(`({ sel: document.querySelector('.plato-cal-day[aria-selected=true]')?.dataset.day, dot: !!document.querySelector('.plato-cal-day[data-day="${DAY}"] .plato-cal-dot'), line: document.querySelector('.plato-appt .plato-appt-line').innerText, time: document.querySelector('.plato-appt-time strong').textContent, type: document.querySelector('.plato-appt .plato-appt-type').textContent, note: document.querySelector('.plato-appt .plato-appt-note')?.innerText || '', counts: [...document.querySelectorAll('#counts strong')].map(s => +s.textContent) })`);
  check('G2 saved: the day is selected, has a dot and lists "Cita con Ana …" at 4:00 p.m. with type and private note',
    d.sel === DAY && d.dot && d.line.includes('Cita') && d.line.includes('con Ana López Ríos') && d.time.startsWith('4:00') && d.type === 'Consulta deportiva' && d.note.includes('rodilla'), JSON.stringify(d));
  const inWeek = DAY >= mondayOf(plus(0)) && DAY <= ymd(new Date(new Date(mondayOf(plus(0)) + 'T12:00').getTime() + 6 * 864e5));
  const inMonth = DAY.slice(0, 7) === TODAY.slice(0, 7);
  check('G2 counts: Hoy 0, Semana and Mes include it when the day falls in them', d.counts[0] === 0 && d.counts[1] === (inWeek ? 1 : 0) && d.counts[2] === (inMonth ? 1 : 0), JSON.stringify({ c: d.counts, inWeek, inMonth }));
  await nutri.screenshot(`${OUT}/agenda-desktop.png`, { full: false });
});

await step('G3', async () => {
  await newAppt({ patient: t.carlos_id, day: DAY, time: '16:30', minutes: 30, type: 'Consulta nutricional seguimiento' });
  await nutri.waitFor(`!document.getElementById('ap-warn').hidden`);
  const w = await nutri.text('#ap-warn');
  check('G3 an overlap warns (names the other appointment) but does not block', w.includes('Se cruza') && w.includes('Ana López Ríos'), w);
  await save();
  await nutri.waitFor(`document.querySelectorAll('.plato-appt').length === 2`);
  const order = await nutri.eval(`[...document.querySelectorAll('.plato-appt .plato-appt-line a')].map(a => a.textContent)`);
  check('G3 both are saved, in time order', order[0] === 'Ana López Ríos' && order[1] === 'Carlos Ruiz Peña' || order.length === 2 && order[0] === 'Ana López Ríos', JSON.stringify(order));
});

await step('G4', async () => {
  const s = await anaHoy();
  check('G4 Ana sees "Tu próxima cita" with Nueva, the time and type', !s.hidden && s.text.includes('Tu próxima cita') && s.isNew === 1 && s.text.includes('4:00') && s.text.includes('Consulta deportiva'), JSON.stringify(s));
  check('G4 she never sees the private note', !s.text.includes('rodilla'), s.text);
  const again = await anaHoy();
  check('G4 once shown, it is no longer marked Nueva', !again.hidden && again.isNew === 0, JSON.stringify(again));
  await ana.screenshot(`${OUT}/patient-next-appt.png`, { full: false });
});

await step('G5', async () => {
  await openAgenda(`?day=${DAY}`);
  await nutri.eval(`[...document.querySelectorAll('.plato-appt')].find(li => li.innerText.includes('Ana'))?.querySelector('[aria-label^="Editar"]').click()`);
  await nutri.waitFor(`document.getElementById('ap-dialog')?.open && document.getElementById('ap-time').value === '16:00'`);
  const pre = await nutri.eval(`({ note: document.getElementById('ap-note').value, dis: document.getElementById('ap-patient').disabled, type: document.getElementById('ap-type').value })`);
  check('G5 Editar opens with the saved values (note, type)', pre.note === 'Revisar dolor de rodilla' && pre.type === 'Consulta deportiva', JSON.stringify(pre));
  await nutri.fill('#ap-time', '17:00');
  await save();
  await nutri.waitFor(`[...document.querySelectorAll('.plato-appt-time strong')].some(s => s.textContent.startsWith('5:00'))`);
  await ana.goto(`${BASE}/progress.html`);
  await ana.waitFor(`document.querySelector('.plato-bottom-nav a[href="/today.html"] .plato-nav-dot')`, 8000);
  check('G5 after a change, Ana gets a dot on Hoy', true);
  const s = await anaHoy();
  check('G5 and sees the new time as Nueva', s.isNew === 1 && s.text.includes('5:00'), JSON.stringify(s));
});

await step('G6', async () => {
  await openAgenda(`?day=${DAY}`);
  await nutri.eval(`[...document.querySelectorAll('.plato-appt')].find(li => li.innerText.includes('Ana'))?.querySelector('[aria-label^="Cancelar"]').click()`);
  await nutri.waitFor(`document.querySelector('.plato-appt.is-cancelled')`);
  const c = await nutri.eval(`({ badge: document.querySelector('.plato-appt.is-cancelled').innerText.includes('Cancelada'), dot: !!document.querySelector('.plato-cal-day[data-day="${DAY}"] .plato-cal-dot') })`);
  check('G6 cancelled: marked Cancelada; the day keeps its dot for the other appointment', c.badge && c.dot, JSON.stringify(c));
  const s = await anaHoy();
  check('G6 Ana sees "Cita cancelada" (no next appointment)', s.text.includes('Cita cancelada') && !s.text.includes('Tu próxima cita') && s.isNew === 1, JSON.stringify(s));
  await ana.screenshot(`${OUT}/patient-cancelled.png`, { full: false });
});

await step('G7', async () => {
  await openAgenda();
  await newAppt({ patient: t.ana_id, day: TODAY, time: '23:55', minutes: 30, type: 'Consulta nutricional inicial' });
  await save();
  await nutri.goto(`${BASE}/home.html`);
  await nutri.waitFor(`document.querySelectorAll('.plato-home-tab').length === 6 && document.querySelector('#today li a.plato-home-today-link')`);
  const line = await nutri.eval(`[...document.querySelectorAll('#today li')].pop().innerText`);
  check('G7 Inicio: "1 cita hoy · la próxima a las 11:55 p.m. con Ana"', /^1\s*cita hoy · la próxima a las 11:55.*con Ana López Ríos/s.test(line.replace(/\n/g, ' ').trim()), line);
  const n = await nutri.eval(`document.querySelector('#tab-agenda .plato-home-count')?.textContent`);
  check('G7 the Agenda tab counts today\'s appointments', n === '1', n);
  await nutri.click('#tab-agenda');
  await nutri.waitFor(`document.querySelector('#cards [data-appt]')`);
  const cards = await nutri.eval(`[...document.querySelectorAll('#cards [data-appt]')].map(c => c.innerText.replace(/\\n/g, ' '))`);
  check('G7 the Agenda tab lists today\'s appointment', cards.length === 1 && cards[0].includes('Ana López Ríos') && cards[0].includes('Consulta nutricional inicial'), JSON.stringify(cards));
  await nutri.screenshot(`${OUT}/home-agenda.png`, { full: false });
});

await step('G8', async () => {
  await openAgenda();
  await nutri.eval(`document.querySelector('.plato-cal-day[aria-selected=true]').focus()`);
  await nutri.eval(`document.getElementById('grid').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  await nutri.eval(`document.getElementById('grid').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  await sleep(300);
  const k = await nutri.eval(`({ sel: document.querySelector('.plato-cal-day[aria-selected=true]')?.dataset.day, focus: document.activeElement?.dataset?.day, list: document.getElementById('day-list').innerText })`);
  check('G8 arrow keys move the selected day, focus follows, and the list updates', k.sel === DAY && k.focus === DAY && k.list.includes('Carlos'), JSON.stringify(k));
  await nutri.click('#next');
  await nutri.waitFor(`document.querySelector('.plato-cal-day[aria-selected=true]')?.dataset.day.endsWith('-01')`);
  const title = await nutri.text('#cal-title');
  await nutri.click('#today-btn');
  await nutri.waitFor(`document.querySelector('.plato-cal-day[aria-selected=true]')?.dataset.day === '${TODAY}'`);
  check('G8 ‹ › change month and "Ir a hoy" comes back', !!title, title);
});

await step('G9', async () => {
  await nutri.goto(`${BASE}/patient.html?id=${t.ana_id}`);
  await nutri.waitFor(`document.querySelector('#p-appts .plato-p-appt-head')`);
  const head = await nutri.eval(`document.querySelector('#p-appts .plato-p-appt-head').innerText`);
  check('G9 the patient page shows the next appointment', head.includes('Próxima cita') && head.includes('11:55'), head);
  await nutri.click('#p-new-appt');
  await nutri.waitFor(`document.getElementById('ap-dialog')?.open`);
  const pre = await nutri.eval(`({ v: document.getElementById('ap-patient').value, dis: document.getElementById('ap-patient').disabled })`);
  check('G9 "Agendar cita" comes with the patient chosen', pre.v === t.ana_id && pre.dis, JSON.stringify(pre));
  await nutri.eval(`document.getElementById('ap-dialog').close()`);
  const all = await nutri.eval(`document.querySelector('.plato-p-appt-all summary')?.textContent`);
  check('G9 all her appointments are listed (2)', all === 'Todas sus citas (2)', all);
});

await step('G9b', async () => {
  // A patient with no appointments: the strip says so and nothing else (no stray "null").
  const s = await nutri.eval(`fetch('/api/collections/patients/records?perPage=1&filter=' + encodeURIComponent('name = "ZZ Sin Citas"')).then(() => 1)`);
  const r = await fetch(`${BASE}/api/collections/patients/records`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: t.nutritionist.token },
    body: JSON.stringify({ name: 'ZZ Sin Citas', sex: 'female', birth_date: '1990-01-01 12:00:00.000Z', nutritionist: t.nutritionist.record.id, password: 'Zz1234567890', passwordConfirm: 'Zz1234567890', service: 'nutrition' }) });
  const p = await r.json();
  await nutri.goto(`${BASE}/patient.html?id=${p.id}`);
  await nutri.waitFor(`document.querySelector('#p-appts .plato-p-appt-head')`);
  const txt = await nutri.eval(`document.getElementById('p-appts').textContent`);
  check('G9b no appointments: "Sin citas próximas." and no stray text', s === 1 && txt.includes('Sin citas próximas.') && !txt.includes('null'), txt);
});

await step('G10', async () => {
  await nutri.goto(`${BASE}/export.html?id=${t.ana_id}`);
  await nutri.waitFor(`[...document.querySelectorAll('.doc-section h2')].some(h => h.textContent.startsWith('Citas'))`, 15000);
  const e = await nutri.eval(`(() => { const s = [...document.querySelectorAll('.doc-section')].find(x => x.querySelector('h2').textContent.startsWith('Citas')); return { title: s.querySelector('h2').textContent, rows: s.querySelectorAll('tbody tr').length, note: s.querySelector('th.appt-note-col').hidden, text: s.innerText }; })()`);
  check('G10 the export lists her appointments; private notes stay hidden by default', e.title === 'Citas (2)' && e.rows === 2 && e.note && !e.text.includes('rodilla') && e.text.includes('Cancelada'), JSON.stringify(e).slice(0, 300));
  await nutri.eval(`(() => { const c = document.getElementById('with-notes'); c.checked = true; c.dispatchEvent(new Event('change')); })()`);
  const shown = await nutri.eval(`!document.querySelector('th.appt-note-col').hidden && document.querySelector('.doc-section tbody').closest('section') && [...document.querySelectorAll('td.appt-note-col')].some(td => td.textContent.includes('rodilla'))`);
  check('G10 ticking "notas privadas" adds the note column', shown);
});

await step('G11', async () => {
  const phone = await as('nutritionist', { width: 390, height: 844, mobile: true });
  await phone.goto(`${BASE}/agenda.html?day=${DAY}`);
  await phone.waitFor(`document.querySelectorAll('.plato-appt').length === 2`);
  const f = await phone.eval(`({ wide: document.documentElement.scrollWidth <= innerWidth, stacked: document.querySelector('.plato-day').getBoundingClientRect().top > document.querySelector('.plato-cal').getBoundingClientRect().bottom - 1 })`);
  check('G11 phone: calendar above the day list, no sideways scroll', f.wide && f.stacked, JSON.stringify(f));
  await phone.screenshot(`${OUT}/agenda-phone.png`, { full: true });
  const err = phone.errors.join(' | ');
  check('G11 no console errors (phone)', !err, err);
});

await step('G13', async () => {
  // Google Calendar subscription link (spec "Feature: Agenda", Slice 2)
  await nutri.goto(`${BASE}/settings.html`);
  await nutri.waitFor(`document.getElementById('cal-enable')`);
  await nutri.eval('window.confirm = () => true');
  await nutri.click('#cal-enable');
  await nutri.waitFor(`document.getElementById('cal-url')?.value.includes('/api/plato/calendar/')`);
  const url = await nutri.eval(`document.getElementById('cal-url').value`);
  check('G13 Ajustes: Activar enlace shows the private address, Copiar enlace and the 3 steps',
    /\/api\/plato\/calendar\/[A-Za-z0-9]{40,}\.ics$/.test(url) && await nutri.eval(`!!document.getElementById('cal-copy') && document.querySelectorAll('.plato-cal-steps li').length === 3`), url);
  const r = await fetch(url);
  const ics = (await r.text()).replace(/\r\n /g, '');
  check('G13 the address serves the calendar with Carlos\'s appointment (Google sees no private note)',
    r.status === 200 && ics.includes('SUMMARY:Cita: Carlos Ruiz Peña') && !ics.includes('rodilla'), `${r.status} ${ics.slice(0, 200)}`);
  await nutri.goto(`${BASE}/settings.html`);
  await nutri.waitFor(`document.getElementById('cal-url')`);
  check('G13 after a reload the same address is shown', await nutri.eval(`document.getElementById('cal-url').value`) === url);
  await nutri.eval('window.confirm = () => true');
  await nutri.click('#cal-rotate');
  await nutri.waitFor(`document.getElementById('cal-url').value !== ${JSON.stringify(url)}`);
  check('G13 Cambiar enlace: new address, the old one stops working', (await fetch(url)).status === 404);
  await openAgenda();
  await nutri.waitFor(`document.getElementById('cal-google').textContent.length > 0`);
  check('G13 the Agenda page says it shows in Google Calendar', (await nutri.text('#cal-google')).includes('Se ve en tu Google Calendar'));
  const id = ics.split('BEGIN:VEVENT').find((ev) => ev.includes('Carlos'))?.match(/UID:([a-z0-9]+)@aht-fitness/)?.[1];
  await nutri.goto(`${BASE}/agenda.html?appt=${id}`);
  await nutri.waitFor(`document.querySelectorAll('.plato-cal-day').length === 42 && document.getElementById('day-list').children.length > 0`);
  check('G13 a link from Google opens that appointment\'s day', (await nutri.eval(`document.getElementById('day-list').textContent`)).includes('Carlos'));
  await nutri.goto(`${BASE}/settings.html`);
  await nutri.waitFor(`document.getElementById('cal-disable')`);
  await nutri.eval('window.confirm = () => true');
  await nutri.click('#cal-disable');
  await nutri.waitFor(`document.getElementById('cal-enable')`);
  check('G13 Desactivar: back to "Activar enlace"', true);
  await nutri.screenshot(`${OUT}/settings-calendar.png`, { full: false });
});

const errs = [...nutri.errors, ...ana.errors].join(' | ');
check('G12 no console errors', !errs, errs);
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
