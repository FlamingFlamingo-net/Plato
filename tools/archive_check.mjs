// Archive tabs, sorting and template archive (spec "Feature: Archive and restore catalogue items").
// Usage: node tools/archive_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server)
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
import { createNutritionist } from './admin.mjs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = t.nutritionist.token, NID = t.nutritionist.record.id;
const api = async (path, { method = 'GET', body, token = N } = {}) => {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', Authorization: token }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
const TPL = '/api/collections/diet_templates/records';
const week = { mon: { breakfast: 'Avena' } };

// Data: two more patients (accent + lower case), three templates, made one after another (for "newest first").
for (const name of ['Ángel Zúñiga', 'beatriz Soto']) {
  await api('/api/collections/patients/records', { method: 'POST', body: { name, sex: 'male', birth_date: '1990-01-01 12:00:00.000Z', nutritionist: NID, password: 'Xx1234567890', passwordConfirm: 'Xx1234567890' } });
  await sleep(1100);
}
const tpl = {};
for (const title of ['plan base', 'Plan Álamo', 'Zeta']) {
  tpl[title] = (await api(TPL, { method: 'POST', body: { nutritionist: NID, title, meals: week, snacks: 2 } })).json;
  await sleep(1100);
}

const browser = await launch({ port: 9353, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const nutri = await as('nutritionist', { width: 1366, height: 900 });
const names = (sel) => nutri.eval(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((e) => e.textContent.trim())`);
const tabText = (v) => nutri.eval(`document.getElementById('tab-${v}').textContent.trim()`);
const pickSort = async (v) => { await nutri.eval(`(() => { const s = document.getElementById('list-sort'); s.value = ${JSON.stringify(v)}; s.dispatchEvent(new Event('change')); })()`); await sleep(500); };
const openPatients = async (q = '') => { await nutri.goto(`${BASE}/patients.html${q}`); await nutri.waitFor(`document.querySelector('.plato-patient-link strong') && document.getElementById('tab-archived').textContent.includes('(')`); };
const patientNames = () => names('.plato-patient-link .plato-patient-meta strong');

await step('A1', async () => {
  await openPatients();
  const sel = await nutri.eval(`({ a: document.getElementById('tab-active').getAttribute('aria-selected'), role: document.querySelector('.plato-list-tabs').getAttribute('role') })`);
  check('A1 Mis pacientes opens on "Activos" (real tabs)', sel.a === 'true' && sel.role === 'tablist', JSON.stringify(sel));
  check('A1 tab counts: Activos (4) | Archivados (0)', (await tabText('active')) === 'Activos (4)' && (await tabText('archived')) === 'Archivados (0)', `${await tabText('active')} | ${await tabText('archived')}`);
  check('A1 Nombre (A–Z) ignores accents and capitals', (await patientNames()).join() === 'Ana López Ríos,Ángel Zúñiga,beatriz Soto,Carlos Ruiz Peña', (await patientNames()).join());
  await pickSort('-name');
  check('A1 Nombre (Z–A)', (await patientNames()).join() === 'Carlos Ruiz Peña,beatriz Soto,Ángel Zúñiga,Ana López Ríos', (await patientNames()).join());
  await pickSort('-created');
  check('A1 Más nuevos primero', (await patientNames())[0] === 'beatriz Soto', (await patientNames()).join());
  check('A1 the sort is in the address', (await nutri.eval('location.search')).includes('sort=-created'));
  await openPatients();
  check('A1 …and remembered on this computer after leaving and coming back', (await patientNames())[0] === 'beatriz Soto' && (await nutri.eval(`document.getElementById('list-sort').value`)) === '-created');
  await pickSort('name');
});

await step('A2', async () => {
  // Archive Carlos through the existing route; the archived tab shows him; "Nuevo paciente" only on Activos.
  await api(`/api/plato/patients/${t.carlos_id}/close`, { method: 'POST', body: {} });
  await openPatients('?view=archived');
  check('A2 ?view=archived opens the Archivados tab', (await nutri.eval(`document.getElementById('tab-archived').getAttribute('aria-selected')`)) === 'true');
  check('A2 Archivados (1) lists Carlos, "Archivado el …"', (await tabText('archived')) === 'Archivados (1)' && (await patientNames()).join() === 'Carlos Ruiz Peña'
    && /^Archivado el /.test(await nutri.eval(`document.querySelector('.plato-patient-link .badge').textContent`)));
  check('A2 the archived tab starts on "Archivados recientemente"; "Nuevo paciente" is hidden',
    (await nutri.eval(`document.getElementById('list-sort').value`)) === '-archived' && await nutri.eval(`document.getElementById('new-patient').hidden`));
  await nutri.eval(`document.getElementById('tab-archived').focus()`);
  await nutri.eval(`document.querySelector('.plato-list-tabs').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }))`);
  await nutri.waitFor(`document.getElementById('tab-active').getAttribute('aria-selected') === 'true' && document.querySelectorAll('.plato-patient-link').length === 3`);
  check('A2 arrow keys move between the tabs (and focus follows)', (await nutri.eval(`document.activeElement.id`)) === 'tab-active' && !(await nutri.eval('location.search')).includes('archived'));
  await nutri.goto(`${BASE}/patient.html?id=${t.carlos_id}&tab=access`);
  await nutri.waitFor(`!document.getElementById('archived-card').hidden`);
  check('A2 his page says "Paciente archivado" with Restaurar', (await nutri.text('#archived-title')) === 'Paciente archivado' && (await nutri.text('#reopen')) === 'Restaurar');
});

await step('A3', async () => {
  // Templates: archive one from the page; it leaves Activas and the picker, shows in Archivadas; restore brings it back.
  await nutri.goto(`${BASE}/templates.html`);
  await nutri.waitFor(`document.querySelectorAll('#list > li.card').length === 3 && document.getElementById('tab-archived').textContent.includes('(')`);
  check('A3 Plantillas: Activas (3) | Archivadas (0), A–Z ignoring accents and capitals',
    (await tabText('active')) === 'Activas (3)' && (await tabText('archived')) === 'Archivadas (0)' && (await names('#list > li.card h2')).join() === 'Plan Álamo,plan base,Zeta', (await names('#list > li.card h2')).join());
  await nutri.eval(`[...document.querySelectorAll('#list > li.card')].find((li) => li.querySelector('h2').textContent === 'Zeta').querySelector('[data-action=archive]').click()`);
  await nutri.waitFor(`document.querySelectorAll('#list > li.card').length === 2 && document.getElementById('tab-archived').textContent.includes('(1)')`);
  const z = (await api(`${TPL}/${tpl.Zeta.id}`)).json;
  check('A3 Archivar: no question, it leaves Activas; Archivadas (1); the server stamps the time', !!z.archived_at && (await tabText('active')) === 'Activas (2)', JSON.stringify(z.archived_at));
  await nutri.click('#tab-archived');
  await nutri.waitFor(`document.querySelectorAll('#list > li.card').length === 1`);
  check('A3 the Archivadas tab lists it with Restaurar and Borrar (no rename)',
    (await names('#list > li.card h2')).join() === 'Zeta' && await nutri.eval(`!!document.querySelector('#list [data-action=restore]') && !!document.querySelector('#list [aria-label^="Borrar"]') && ![...document.querySelectorAll('#list button')].some((b) => b.textContent === 'Cambiar nombre')`));
  await nutri.screenshot(`${OUT}/templates-archived.png`, { full: false });

  // The picker on a patient's diet tab offers only active ones.
  await nutri.goto(`${BASE}/patient.html?id=${t.ana_id}&tab=diet`);
  await nutri.waitFor(`document.getElementById('use-template')`);
  await nutri.click('#use-template');
  await nutri.waitFor(`document.querySelectorAll('#ut-list label').length > 0`);
  const offered = await names('#ut-list label strong');
  check('A3 "Usar plantilla" offers only active templates', offered.length === 2 && !offered.includes('Zeta'), offered.join());
  await nutri.eval(`document.getElementById('ut-dialog').close()`);

  await nutri.goto(`${BASE}/templates.html?view=archived`);
  await nutri.waitFor(`document.querySelector('#list [data-action=restore]')`);
  await nutri.click('#list [data-action=restore]');
  await nutri.waitFor(`document.getElementById('tab-active').textContent.includes('(3)')`);
  check('A3 Restaurar: back to Activas (3), Archivadas (0)', (await tabText('archived')) === 'Archivadas (0)' && !(await api(`${TPL}/${tpl.Zeta.id}`)).json.archived_at);
});

await step('A4', async () => {
  // Save as template with an archived template's name: the question says it is archived; replacing restores it.
  await api(`${TPL}/${tpl['plan base'].id}`, { method: 'PATCH', body: { archived_at: '2000-01-01 00:00:00.000Z' } });
  await nutri.goto(`${BASE}/patient.html?id=${t.ana_id}&tab=diet`);
  await nutri.waitFor(`document.getElementById('save-template')`);
  await nutri.click('#save-template');
  await nutri.waitFor(`document.getElementById('st-dialog')?.open`);
  await nutri.fill('#st-name', 'plan base');
  await nutri.click('#st-save');
  await nutri.waitFor(`!document.getElementById('st-conflict').hidden`);
  check('A4 the "¿Reemplazar?" question says the name belongs to an archived template', (await nutri.text('#st-conflict-title')).includes('archivada'), await nutri.text('#st-conflict-title'));
  await nutri.click('#st-replace');
  await nutri.waitFor(`!document.getElementById('st-dialog').open`);
  const pb = (await api(`${TPL}/${tpl['plan base'].id}`)).json;
  check('A4 replacing it restores it with the new week', !pb.archived_at && JSON.stringify(pb.meals) !== JSON.stringify(week), JSON.stringify(pb).slice(0, 160));
});

await step('A5', async () => {
  // Catálogo counts: active + archived.
  await api(`${TPL}/${tpl.Zeta.id}`, { method: 'PATCH', body: { archived_at: '2000-01-01 00:00:00.000Z' } });
  await nutri.goto(`${BASE}/home.html`);
  await nutri.waitFor(`document.getElementById('tabs')?.children.length > 0`);
  await nutri.eval(`[...document.querySelectorAll('#tabs [role=tab]')].find((b) => b.textContent.includes('Catálogo')).click()`);
  await nutri.waitFor(`[...document.querySelectorAll('.plato-catalog-card')].some((c) => c.textContent.includes('Dietas'))`);
  const cards = await nutri.eval(`Object.fromEntries([...document.querySelectorAll('.plato-catalog-card')].map((c) => [c.querySelector('strong').textContent, c.querySelector('small').textContent]))`);
  check('A5 Catálogo: "Dietas · 2 plantillas semanales · 1 archivada"', cards.Dietas === '2 plantillas semanales · 1 archivada', cards.Dietas);
  check('A5 Catálogo: "Pacientes · 3 activos · 1 archivado"', cards.Pacientes === '3 activos · 1 archivado', cards.Pacientes);
});

await step('A6', async () => {
  // Server rules: archived_at is server time; a new template starts active; another nutritionist cannot archive mine.
  const fresh = (await api(TPL, { method: 'POST', body: { nutritionist: NID, title: 'Nueva archivada?', meals: week, snacks: 2, archived_at: '2000-01-01 00:00:00.000Z' } })).json;
  check('A6 a new template always starts active', fresh.id && !fresh.archived_at, JSON.stringify(fresh).slice(0, 120));
  const r = (await api(`${TPL}/${fresh.id}`, { method: 'PATCH', body: { archived_at: '2000-01-01 00:00:00.000Z' } })).json;
  check('A6 archiving stores the server\'s time, not the one sent', r.archived_at && !r.archived_at.startsWith('2000'), r.archived_at);
  await createNutritionist(BASE, { name: 'Otra', email: 'otra-archive@test.local', password: 'OtraArchive12345' });
  const other = (await api('/api/collections/nutritionists/auth-with-password', { method: 'POST', body: { identity: 'otra-archive@test.local', password: 'OtraArchive12345' } })).json.token;
  const o = await api(`${TPL}/${tpl['Plan Álamo'].id}`, { method: 'PATCH', body: { archived_at: '2000-01-01 00:00:00.000Z' }, token: other });
  check('A6 another nutritionist cannot archive or restore my template', o.status === 404, o.status);
  check('A6 a patient cannot list templates', (await api(TPL, { token: t.ana.token })).json.totalItems === 0 || (await api(TPL, { token: t.ana.token })).status >= 400);
});

await step('A7', async () => {
  const phone = await as('nutritionist', { width: 390, height: 844, mobile: true });
  for (const page of ['patients', 'templates']) {
    await phone.goto(`${BASE}/${page}.html`);
    await phone.waitFor(`document.getElementById('tab-archived')?.textContent.includes('(')`);
    const fit = await phone.eval(`({ wide: document.documentElement.scrollWidth <= innerWidth, oneLine: document.getElementById('tab-active').getBoundingClientRect().top === document.getElementById('tab-archived').getBoundingClientRect().top })`);
    check(`A7 phone 390 px, ${page}: both tabs on one line, no sideways scroll`, fit.wide && fit.oneLine, JSON.stringify(fit));
    await phone.screenshot(`${OUT}/${page}-phone.png`, { full: false });
  }
  await nutri.goto(`${BASE}/patients.html`);
  await nutri.waitFor(`document.getElementById('tab-archived')?.textContent.includes('(')`);
  await nutri.screenshot(`${OUT}/patients-desk.png`, { full: false });
});

const errs = nutri.errors.join(' | ');
check('no console errors', !errs, errs);
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
