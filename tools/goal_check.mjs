// tools/goal_check.mjs — screen acceptance for weekly goals (spec "Feature: Weekly goals", slice 2).
// THROWAWAY server seeded with tools/seed.py (Ana: both services, joined; Carlos: no app). PB_CONTAINER = the throwaway
// container (used once: an admin gives Ana a goal that started 2 weeks ago, so "last week" has a goal to miss).
//   PB_CONTAINER=pb-check node tools/goal_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
const BOX = process.env.PB_CONTAINER;
if (!BOX) { console.error('Set PB_CONTAINER to the throwaway container name.'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };

const ymd = (d) => d.toLocaleDateString('en-CA');
const today = ymd(new Date());
const addDays = (s, n) => { const d = new Date(`${s}T12:00:00`); d.setDate(d.getDate() + n); return ymd(d); };
const monday = addDays(today, -((new Date(`${today}T12:00:00`).getDay() + 6) % 7));
const api = async (tok, method, path, body) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { Authorization: tok, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const j = r.status === 204 ? null : await r.json().catch(() => null);
  if (r.status >= 400) throw new Error(`${method} ${path} ${r.status} ${JSON.stringify(j)}`);
  return j;
};
const anaId = t.ana_id;
const carlosId = t.carlos_id;

// Admin: Ana's goals started two weeks ago (the history the server would have written then).
const email = `zz-su-${randomBytes(3).toString('hex')}@test.local`, pw = `Zz${randomBytes(12).toString('hex')}`;
execFileSync('docker', ['exec', BOX, '/pb/pocketbase', 'superuser', 'upsert', email, pw]);
const su = await (await fetch(`${BASE}/api/collections/_superusers/auth-with-password`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: pw }) })).json();
await api(su.token, 'PATCH', `/api/collections/patients/records/${anaId}`,
  { goal_history: [{ from: addDays(monday, -14), service: 'both', meal_days: 5, meal_per_day: 3, act_days: 5, act_min: 30 }] });

const browser = await launch({ port: 9344, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const nutri = await as('nutritionist', { width: 1280, height: 900 });
const ana = await as('ana', { width: 390, height: 844, mobile: true });
const actRow = `#week-rows .plato-week-row[data-kind="act"]`;
const mealRow = `#week-rows .plato-week-row[data-kind="meal"]`;
const openHoy = async () => {
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`!document.getElementById('week').hidden && document.querySelector('${actRow}')`);
};
const metToday = (row) => ana.eval(`[...document.querySelectorAll('${row} .plato-week-dots li')].find(li => li.classList.contains('is-today'))?.className || ''`);
const count = (row) => ana.eval(`document.querySelector('${row} .plato-week-count').textContent`);
const logAct = (date, minutes, kind = 'walk') => api(t.ana.token, 'POST', '/api/collections/activity_logs/records', { patient: anaId, date, kind, minutes });

await step('W1', async () => {
  await nutri.goto(`${BASE}/patients.html`);
  await nutri.waitFor(`document.getElementById('new-patient')`);
  await nutri.click('#new-patient');
  await nutri.waitFor(`document.getElementById('patient-dialog').open && document.querySelectorAll('#pf-service input').length === 2`);
  const s = await nutri.eval(`(() => { const [n, e] = document.querySelectorAll('#pf-service input'); const [cn, ce] = document.querySelectorAll('#pf-service .plato-service-card');
    return { n: n.checked, e: e.checked, left: cn.getBoundingClientRect().left < ce.getBoundingClientRect().left, sameTop: Math.round(cn.getBoundingClientRect().top) === Math.round(ce.getBoundingClientRect().top) }; })()`);
  check('W1 "Nuevo paciente": two cards side by side, Nutrición (left) preselected, Entrenamiento off', s.n && !s.e && s.left && s.sameTop, JSON.stringify(s));
  await nutri.click('#pf-service .plato-service-card:nth-child(1)');
  const keep = await nutri.eval(`({ n: document.querySelectorAll('#pf-service input')[0].checked, hint: document.querySelector('#pf-service .plato-service-hint').textContent })`);
  check('W1 the last selected card cannot be turned off (hint says why)', keep.n && keep.hint === 'Elige al menos un servicio.', JSON.stringify(keep));
  await nutri.click('#pf-service .plato-service-card:nth-child(2)');
  await nutri.fill('#pf-name', 'ZZ Atleta');
  await nutri.fill('#pf-sex', 'male');
  await nutri.eval(`document.getElementById('pf-birth').value = '1995-05-05'`);
  await nutri.click('#patient-dialog [type=submit]');
  await nutri.waitUrl('/patient.html');
  const id = new URL(await nutri.eval('location.href')).searchParams.get('id');
  const p = await api(t.nutritionist.token, 'GET', `/api/collections/patients/records/${id}`);
  check('W1 both cards on → Nutrición + entrenamiento, both goals on (3 comidas × 5, 30 min × 5)',
    p.service === 'both' && p.meal_goal_days === 5 && p.meal_goal_per_day === 3 && p.activity_goal_days === 5 && p.activity_goal_min === 30 && p.goal_history?.[0]?.from === monday, JSON.stringify(p));
});

await step('W2', async () => {
  await nutri.goto(`${BASE}/patient.html?id=${anaId}&tab=log`);
  await nutri.waitFor(`document.querySelector('#goals-rows .plato-week-row[data-kind="act"]') && document.querySelectorAll('#goals-charts .plato-week-chart').length === 2`);
  await nutri.click('#goals-edit');
  await nutri.waitFor(`document.getElementById('goals-dialog').open`);
  await nutri.eval(`document.getElementById('gd-act-days').value = '4'; document.getElementById('gd-act-days').dispatchEvent(new Event('change'))`);
  await nutri.fill('#gd-act-min', '47');
  await nutri.click('#gd-save');
  const err = await nutri.eval(`document.querySelector('#goals-dialog .plato-form-error:not([hidden])')?.textContent || ''`);
  check('W2 minutes that are not steps of 5 are refused on screen', err.includes('de 5 en 5'), err);
  await nutri.fill('#gd-act-min', '30');
  await nutri.click('#gd-save');
  await nutri.waitFor(`!document.getElementById('goals-dialog').open && document.getElementById('goals-sub').textContent.includes('30 min al día, 4 días a la semana')`);
  const p = await api(t.nutritionist.token, 'GET', `/api/collections/patients/records/${anaId}`);
  check('W2 "Cambiar metas": 30 min × 4 days saved; history keeps 2 weeks ago and adds this week',
    p.activity_goal_days === 4 && p.goal_history.length === 2 && p.goal_history[1].from === monday && p.goal_history[1].act_days === 4, JSON.stringify(p.goal_history));
  await nutri.screenshot(`${OUT}/nutri-goals.png`, { full: false });
});

await step('W3', async () => {
  await openHoy();
  const before = await count(actRow);
  check('W3 the patient sees the new goal after a refresh ("de 4 días")', / de 4 días$/.test(before), before);
  await logAct(today, 20);
  await openHoy();
  check('W3 20 min alone today: "activo", not counted', (await metToday(actRow)).includes('is-active') && await count(actRow) === before, `${await metToday(actRow)} ${await count(actRow)}`);
  await logAct(today, 15, 'gym');
  await openHoy();
  const afterSum = await count(actRow);
  check('W3 walk 20 + gym 15 on the same day reach 30 → today counts', (await metToday(actRow)).includes('is-met') && parseInt(afterSum) === parseInt(before) + 1, afterSum);
  await logAct(today, 150, 'run');
  await openHoy();
  check('W3 150 more minutes the same day still count as one day, not the week', await count(actRow) === afterSum, await count(actRow));
  await logAct(addDays(monday, -1), 45);   // last Sunday
  await openHoy();
  check('W3 a 45-min walk dated last Sunday counts in last week, not this one', await count(actRow) === afterSum, await count(actRow));
  check('W3 "Hoy: 185 de 30 min" and the week totals', (await ana.text(`${actRow} .plato-week-line`)).startsWith('Hoy: 185 de 30 min'), await ana.text(`${actRow} .plato-week-line`));
  await ana.screenshot(`${OUT}/hoy-week.png`, { full: true });
});

await step('W4', async () => {
  await openHoy();
  const before = await count(mealRow);
  const slots = await ana.eval(`[...document.querySelectorAll('#meals li[data-slot]')].map(li => li.dataset.slot).filter(s => document.querySelector('#meals li[data-slot="' + s + '"] .plato-check').getAttribute('aria-pressed') === 'false').slice(0, 3)`);
  for (const s of slots) {
    await ana.click(`#meals li[data-slot="${s}"] .plato-check`);
    await ana.waitFor(`document.querySelector('#meals li[data-slot="${s}"] .plato-check').getAttribute('aria-pressed') === 'true'`);
  }
  await ana.waitFor(`document.querySelector('${mealRow} .plato-week-line').textContent.startsWith('Hoy: 3 de 3')`);
  check('W4 checking 3 planned meals today makes today count for the meal goal (card updates without a refresh)',
    (await metToday(mealRow)).includes('is-met') && parseInt(await count(mealRow)) === parseInt(before) + 1, `${before} → ${await count(mealRow)}`);
});

await step('W5', async () => {
  await api(t.nutritionist.token, 'PATCH', `/api/collections/patients/records/${anaId}`, { activity_goal_days: 1, meal_goal_days: 0, goal_week: monday });
  await openHoy();
  check('W5 1 of 1 → "¡Meta de la semana cumplida!"', (await ana.text(`${actRow} .plato-week-mood`)) === '¡Meta de la semana cumplida!');
  check('W5 Sin meta (meals): the row says "Sin meta" and shows totals only (no encouragement line)',
    await count(mealRow) === 'Sin meta' && !(await ana.eval(`!!document.querySelector('${mealRow} .plato-week-mood')`)) && (await ana.text(`${mealRow} .plato-week-line`)).includes('Esta semana:'));
  await api(t.nutritionist.token, 'PATCH', `/api/collections/patients/records/${anaId}`, { activity_goal_days: 4, meal_goal_days: 5, goal_week: monday });
});

await step('W6', async () => {
  await ana.goto(`${BASE}/progress.html`);
  await ana.waitFor(`!document.getElementById('wk-section').hidden && document.querySelectorAll('#wk-charts .plato-week-chart').length === 2`);
  const c = await ana.eval(`(() => { const f = [...document.querySelectorAll('#wk-charts figure')].find(x => x.querySelector('figcaption').textContent === 'Actividad');
    const rows = [...f.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(td => td.textContent));
    return { bars: f.querySelectorAll('rect.bar').length, goals: f.querySelectorAll('line.goal').length, label: f.querySelector('svg').getAttribute('aria-label'), rows }; })()`);
  check('W6 Progreso: 8 weekly bars, a goal line only for weeks that had a goal (3), and a table alternative',
    c.bars === 8 && c.goals === 3 && c.rows.length === 8 && c.label.includes('tabla'), JSON.stringify(c));
  check('W6 the goal line moves with the history: last week "de 5", this week "de 4"', c.rows[0][2].includes('4 días') && c.rows[1][2].includes('5 días') && c.rows[3][2] === 'Sin meta', JSON.stringify(c.rows.slice(0, 4)));
  check('W6 last week includes the Sunday walk (1 day met)', c.rows[1][1].startsWith('1 de 5') || c.rows[1][1].startsWith('2 de 5'), c.rows[1][1]);
  check('W6 phone: no sideways scroll on Hoy and Progreso', await ana.eval(`document.documentElement.scrollWidth <= innerWidth`));
  await ana.screenshot(`${OUT}/progreso-weeks.png`, { full: true });
});

await step('W7', async () => {
  await nutri.goto(`${BASE}/home.html?tab=pending`);
  await nutri.waitFor(`document.querySelector('#groups .plato-pending-group')`);
  const g = await nutri.eval(`[...document.querySelectorAll('#groups .plato-pending-group')].map(s => s.dataset.group + ':' + s.querySelector('p').textContent)`);
  check('W7 Pendientes: one summary row for activity ("1 paciente no cumplió su meta de actividad la semana pasada")',
    g.some((x) => x === 'act:1 paciente no cumplió su meta de actividad la semana pasada'), g.join(' | '));
  check('W7 no per-patient goal or "3 días" rows in the tile list', !(await nutri.eval(`[...document.querySelectorAll('#cards .plato-pending p')].some(p => /meta|3 días/.test(p.textContent))`)));
  const items = await nutri.eval(`document.querySelectorAll('#cards .plato-pending').length`);
  const tab = await nutri.eval(`document.querySelector('#tab-pending .plato-home-count')?.textContent || '0'`);
  check('W7 each summary row counts as 1 in the Pendientes tab', Number(tab) === items + g.length, `${tab} vs ${items}+${g.length}`);
  await nutri.click('#groups [data-group="act"] button[aria-expanded]');
  const li = await nutri.eval(`[...document.querySelectorAll('#grp-act li')].map(li => li.textContent)`);
  check('W7 "Ver lista" shows who and how many days (Ana: 1 or 2 de 5 días)', li.length === 1 && /^Ana López Ríos[12] de 5 días$/.test(li[0]), li.join(' | '));
  check('W7 Hoy panel: one line "por debajo de su meta la semana pasada"', (await nutri.text('#today')).includes('1paciente por debajo de su meta la semana pasada'), await nutri.text('#today'));
  await nutri.screenshot(`${OUT}/home-pending-groups.png`, { full: false });
});

await step('W8', async () => {
  await nutri.goto(`${BASE}/patients.html`);
  await nutri.waitFor(`document.querySelector('[data-week="${anaId}"] .plato-week-badge')`);
  const b = await nutri.eval(`[...document.querySelectorAll('[data-week="${anaId}"] .plato-week-badge')].map(x => x.textContent)`);
  check('W8 patient list: "Comidas 1/5 · Actividad 1/4" style badges for this week', b.length === 2 && /^Comidas \d\/5$/.test(b[0]) && /^Actividad \d\/4$/.test(b[1]), b.join(' | '));
});

await step('W9', async () => {
  await api(t.nutritionist.token, 'POST', `/api/plato/patients/${carlosId}/close`, {});
  await nutri.goto(`${BASE}/patient.html?id=${carlosId}&tab=log`);
  await nutri.waitFor(`document.getElementById('goals-sub').textContent`);
  check('W9 closed account: goals are read-only (no "Cambiar metas")', await nutri.eval(`document.getElementById('goals-edit').hidden`));
  await nutri.goto(`${BASE}/export.html?id=${anaId}`);
  await nutri.waitFor(`[...document.querySelectorAll('.doc-section h2')].some(h => h.textContent.startsWith('Metas semanales'))`);
  const rows = await nutri.eval(`(() => { const s = [...document.querySelectorAll('.doc-section')].find(x => x.querySelector('h2').textContent.startsWith('Metas semanales')); return s.querySelectorAll('tbody tr').length; })()`);
  check('W9 export: "Metas semanales" with 8 weeks per goal (16 rows)', rows === 16, rows);
});

const errs = [...nutri.errors, ...ana.errors];
check('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
