// Mood check-in (spec "Feature: Mood check-in"): Hoy card, server rules, patient page strip, Inicio, export, phone.
// Usage: node tools/mood_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
import { launch } from './cdp.mjs';
import { createNutritionist } from './admin.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
async function api(path, { method = 'GET', body, token = t.nutritionist.token } = {}) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const ymd = (d) => d.toLocaleDateString('en-CA');
const shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const TODAY = shift(0), YESTERDAY = shift(-1);
const MOOD = '/api/collections/mood_logs/records';
const ANA = t.ana_id, CARLOS = t.carlos_id;
const anaMoods = async () => (await api(`${MOOD}?sort=date&filter=${encodeURIComponent(`patient = "${ANA}"`)}`)).json.items;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Carlos joins too, so one patient can try to touch another's check-ins.
const inv = await api('/api/plato/invite', { method: 'POST', body: { patient: CARLOS } });
const joined = await api('/api/plato/join', { method: 'POST', token: null, body: { token: inv.json.token, email: 'carlos-mood@test.local', password: 'CarlosMood12345' } });
const CT = joined.json.token;

const browser = await launch({ port: 9355, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport, token = t[who]?.token, record = t[who]?.record) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token, record, collection: record.collectionName }))})`);
  return p;
}
const ana = await as('ana', { width: 390, height: 844, mobile: true });
const faceSel = (n) => `#mood label.plato-mood-face:nth-of-type(${n})`;
async function openToday(day = '') {
  await ana.goto(`${BASE}/today.html${day}`);
  await ana.waitFor(`!document.getElementById('mood').hidden && document.getElementById('mood').children.length > 1`);
}

await step('M1', async () => {
  await openToday();
  const f = await ana.eval(`({ title: document.getElementById('mood-title').textContent,
    words: [...document.querySelectorAll('#mood .plato-mood-face')].map((l) => l.textContent.trim()),
    radios: [...document.querySelectorAll('#mood input')].every((i) => i.type === 'radio' && i.name === document.querySelector('#mood input').name) })`);
  check('M1 Hoy asks "¿Cómo te sentiste hoy?" with 5 faces, each with its word, as one radio group',
    f.title === '¿Cómo te sentiste hoy?' && f.words.join('|') === 'Muy mal|Mal|Regular|Bien|Muy bien' && f.radios, JSON.stringify(f));
  await ana.eval(`document.getElementById('mood').scrollIntoView({ block: 'center' })`);
  await ana.screenshot(`${OUT}/hoy-ask.png`, { full: true });
  await ana.click(faceSel(4));
  await ana.waitFor(`document.getElementById('mood-answer')?.textContent.includes('Bien')`);
  let m = await anaMoods();
  check('M1 one tap on "Bien" saves at once (mood 4, today)', m.length === 1 && m[0].mood === 4 && m[0].date === TODAY, JSON.stringify(m));
  await openToday();
  const line = await ana.text('#mood-answer');
  check('M1 after a refresh Hoy says "Hoy: Bien · Cambiar"', /^Hoy:\s*Bien\s*·\s*Cambiar$/.test(line.replace(/\s+/g, ' ')), line);
  await ana.click('#mood-change');
  await ana.waitFor(`document.querySelector('#mood input:checked')?.value === '4'`);
  await ana.click(faceSel(3));
  await ana.waitFor(`document.getElementById('mood-answer')?.textContent.includes('Regular')`);
  m = await anaMoods();
  check('M1 changing to "Regular" replaces it (still one for today)', m.length === 1 && m[0].mood === 3, JSON.stringify(m));
});

await step('M2', async () => {
  await ana.click('#mood-note-add');
  await ana.waitFor(`document.getElementById('mood-note')`);
  await ana.fill('#mood-note', '  Dormí muy poco  ');
  await ana.click('#mood-note-save');
  await ana.waitFor(`document.querySelector('.plato-mood-note')?.textContent.includes('Dormí muy poco')`);
  const m = await anaMoods();
  check('M2 the note is saved (trimmed) and shown on Hoy', m.length === 1 && m[0].note === 'Dormí muy poco', JSON.stringify(m));
  await ana.eval(`document.getElementById('mood').scrollIntoView({ block: 'center' })`);
  await ana.screenshot(`${OUT}/hoy-answered.png`, { full: false });
});

await step('M3', async () => {
  await openToday('?day=yesterday');
  check('M3 "Ayer" asks about yesterday', await ana.text('#mood-title') === '¿Cómo te sentiste ayer?');
  await ana.click(faceSel(2));
  await ana.waitFor(`document.getElementById('mood-answer')?.textContent.includes('Mal')`);
  const m = await anaMoods();
  check('M3 she answers yesterday ("Mal")', m.length === 2 && m[0].date === YESTERDAY && m[0].mood === 2, JSON.stringify(m));
  const old = await api(MOOD, { method: 'POST', token: t.ana.token, body: { patient: ANA, date: shift(-3), mood: 3 } });
  const fut = await api(MOOD, { method: 'POST', token: t.ana.token, body: { patient: ANA, date: shift(2), mood: 3 } });
  check('M3 the server refuses 3 days ago and 2 days ahead', old.status === 400 && fut.status === 400, `${old.status} ${fut.status}`);
  const dup = await api(MOOD, { method: 'POST', token: t.ana.token, body: { patient: ANA, date: TODAY, mood: 5 } });
  check('M3 a second check-in for the same day is refused (one per day)', dup.status === 400, dup.status);
  const bad = await api(MOOD, { method: 'POST', token: CT, body: { patient: CARLOS, date: TODAY, mood: 6 } });
  const long = await api(MOOD, { method: 'POST', token: CT, body: { patient: CARLOS, date: TODAY, mood: 3, note: 'x'.repeat(201) } });
  check('M3 mood 6 and a 201-character note are refused', bad.status === 400 && long.status === 400, `${bad.status} ${long.status}`);
});

await step('M4', async () => {
  const nutri = await as('nutritionist', { width: 1366, height: 900 });
  await nutri.goto(`${BASE}/patient.html?id=${ANA}&tab=overview`);
  await nutri.waitFor(`document.querySelectorAll('.plato-mood-strip li').length === 14`);
  const s = await nutri.eval(`({ n: document.querySelectorAll('.plato-mood-strip li').length, faces: document.querySelectorAll('.plato-mood-strip li .plato-face').length,
    last: document.querySelector('.plato-mood-strip li:last-child').getAttribute('aria-label'), prev: document.querySelector('.plato-mood-strip li:nth-last-child(2)').getAttribute('aria-label'),
    sub: document.getElementById('mood-sub').textContent, notes: document.querySelector('.plato-mood-notes')?.textContent || '' })`);
  check('M4 14 days in order: today last ("Regular"), yesterday before it ("Mal"), dots for the rest',
    s.n === 14 && s.faces === 2 && s.last.includes('Regular') && s.last.includes('Dormí muy poco') && s.prev.includes('Mal'), JSON.stringify(s));
  const mon = new Date(); const daysThisWeek = ((mon.getDay() + 6) % 7) + 1;
  const answeredThisWeek = daysThisWeek >= 2 ? 2 : 1;   // yesterday is last week on a Monday
  check('M4 the week in words with the days answered', s.sub.startsWith('Esta semana:') && s.sub.includes(`${answeredThisWeek} de ${daysThisWeek}`), s.sub);
  check('M4 the note is listed under its day', s.notes.includes('Dormí muy poco') && s.notes.includes('Regular'), s.notes);
  await nutri.eval(`document.getElementById('mood-card').scrollIntoView({ block: 'center' })`);
  await nutri.screenshot(`${OUT}/patient-strip.png`, { full: true });
  globalThis.nutri = nutri;
});

await step('M5', async () => {
  const nutri = globalThis.nutri;
  // Carlos: today "Bien" without a note (stays off Inicio); yesterday "Bien" with a note (reaches Inicio).
  const c1 = await api(MOOD, { method: 'POST', token: CT, body: { patient: CARLOS, date: TODAY, mood: 4 } });
  const c2 = await api(MOOD, { method: 'POST', token: CT, body: { patient: CARLOS, date: YESTERDAY, mood: 4, note: 'Mucha energía' } });
  globalThis.carlosToday = c1.json?.id;
  check('M5 Carlos saves his own check-ins', c1.status === 200 && c2.status === 200, `${c1.status} ${c2.status}`);
  await nutri.goto(`${BASE}/home.html`);
  await nutri.waitFor(`document.querySelectorAll('#cards .plato-log-card').length > 0`);
  const cards = await nutri.eval(`[...document.querySelectorAll('#cards .plato-log-card--mood')].map((c) => c.textContent.replace(/\\s+/g, ' ').trim())`);
  const has = (who, what) => cards.some((c) => c.includes(who) && c.includes(what));
  check('M5 Inicio: "Mal" without a note → a card', has('Ana', 'Mal') && !cards.some((c) => c.includes('Ana') && c.includes('Muy mal')), JSON.stringify(cards));
  check('M5 Inicio: "Regular" with a note → a card with the note', has('Ana', 'Dormí muy poco'), JSON.stringify(cards));
  check('M5 Inicio: "Bien" without a note → nothing; "Bien" with a note → a card', cards.filter((c) => c.includes('Carlos')).length === 1 && has('Carlos', 'Mucha energía'), JSON.stringify(cards));
  const before = await nutri.eval(`Number(document.querySelector('#tab-recent .plato-home-count')?.textContent || 0)`);
  await nutri.eval(`[...document.querySelectorAll('#cards .plato-log-card--mood')].find((c) => c.textContent.includes('Mucha energía')).querySelector('button').click()`);
  await nutri.waitFor(`[...document.querySelectorAll('#cards .plato-log-card--mood')].find((c) => c.textContent.includes('Mucha energía'))?.textContent.includes('Vista')`);
  const after = await nutri.eval(`Number(document.querySelector('#tab-recent .plato-home-count')?.textContent || 0)`);
  const seen = (await api(`${MOOD}/${c2.json.id}`)).json;
  check('M5 Marcar vista saves it and the Recientes count drops by one', !!seen.seen_at && after === before - 1, `${before}→${after} ${seen.seen_at}`);
  const msg = await nutri.eval(`document.getElementById('plato-toasts')?.lastElementChild?.textContent || ''`);
  check('M5 the toast does not promise the patient will see it (moods are private to the nutritionist)', msg.includes('Marcada como vista') && !msg.includes('Tu paciente'), msg);
  const ch = await api(`${MOOD}/${c2.json.id}`, { method: 'PATCH', token: CT, body: { mood: 2 } });
  check('M5 the patient changing a seen check-in makes it new again', ch.status === 200 && !ch.json.seen_at, JSON.stringify(ch.json));
  await nutri.screenshot(`${OUT}/inicio.png`, { full: false });
});

await step('M6', async () => {
  const [mine] = await anaMoods();
  const cl = (await api(`${MOOD}?filter=${encodeURIComponent(`patient = "${ANA}"`)}`, { token: CT })).json.totalItems;
  const cc = await api(MOOD, { method: 'POST', token: CT, body: { patient: ANA, date: TODAY, mood: 1 } });
  const cu = await api(`${MOOD}/${mine.id}`, { method: 'PATCH', token: CT, body: { mood: 1 } });
  check('M6 Carlos cannot read, create or change Ana\'s check-ins', cl === 0 && cc.status === 400 && cu.status === 404, `${cl} ${cc.status} ${cu.status}`);
  await createNutritionist(BASE, { name: 'Otra', email: 'otra-mood@test.local', password: 'OtraMood123456' });
  const other = (await api('/api/collections/nutritionists/auth-with-password', { method: 'POST', token: null, body: { identity: 'otra-mood@test.local', password: 'OtraMood123456' } })).json.token;
  const ol = (await api(MOOD, { token: other })).json.totalItems;
  check('M6 another nutritionist sees none', ol === 0, ol);
  const as1 = await api(`${MOOD}/${mine.id}`, { method: 'PATCH', token: t.ana.token, body: { seen_at: '2026-01-01 00:00:00.000Z' } });
  const nm = await api(`${MOOD}/${mine.id}`, { method: 'PATCH', body: { mood: 5 } });
  const nn = await api(`${MOOD}/${mine.id}`, { method: 'PATCH', body: { note: 'cambiado' } });
  check('M6 Ana cannot set seen_at; her nutritionist cannot change the mood or the note', as1.status >= 400 && nm.status >= 400 && nn.status >= 400, `${as1.status} ${nm.status} ${nn.status}`);
  const d1 = await api(`${MOOD}/${mine.id}`, { method: 'DELETE', token: t.ana.token });
  const d2 = await api(`${MOOD}/${mine.id}`, { method: 'DELETE' });
  check('M6 nobody deletes a check-in', d1.status >= 400 && d2.status >= 400 && (await anaMoods()).length === 2, `${d1.status} ${d2.status}`);
  const nl = (await api(`${MOOD}?filter=${encodeURIComponent(`patient = "${ANA}"`)}`, { token: null })).json?.totalItems ?? 0;
  check('M6 without signing in: nothing', nl === 0, nl);
  const cl2 = await api(`/api/plato/patients/${CARLOS}/close`, { method: 'POST', body: {} });
  const after = await api(`${MOOD}/${globalThis.carlosToday}`, { method: 'PATCH', token: CT, body: { mood: 3 } });
  check('M6 an archived (closed) account cannot answer or change', cl2.status === 200 && after.status >= 400, `${cl2.status} ${after.status}`);
});

await step('M7', async () => {
  const nutri = globalThis.nutri;
  await nutri.goto(`${BASE}/export.html?id=${ANA}`);
  await nutri.waitFor(`!document.getElementById('json').disabled`, 20000);
  const sec = await nutri.eval(`[...document.querySelectorAll('.doc-section')].find((s) => s.querySelector('h2').textContent.startsWith('Cómo se ha sentido'))?.textContent.replace(/\\s+/g, ' ') || ''`);
  check('M7 the export has "Cómo se ha sentido (2)" with both days and the note', sec.startsWith('Cómo se ha sentido (2)') && sec.includes('Mal') && sec.includes('Regular') && sec.includes('Dormí muy poco'), sec);
  await nutri.eval(`window.__json = null; { const orig = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { b.text().then((x) => { window.__json = x; }); return orig(b); }; }`);
  await nutri.click('#json');
  await nutri.waitFor(`!!window.__json`);
  const j = JSON.parse(await nutri.eval(`window.__json`));
  check('M7 the JSON holds mood_logs (date, mood, word, note)', j.mood_logs?.length === 2 && j.mood_logs[1].mood_label === 'Regular' && j.mood_logs[1].note === 'Dormí muy poco', JSON.stringify(j.mood_logs));
});

await step('M8', async () => {
  await openToday();
  await ana.click('#mood-change');
  await ana.waitFor(`document.querySelectorAll('#mood input').length === 5`);
  const fit = await ana.eval(`(() => { const ls = [...document.querySelectorAll('#mood .plato-mood-face')]; const tops = new Set(ls.map((l) => Math.round(l.getBoundingClientRect().top)));
    return { oneRow: tops.size === 1, noScroll: document.documentElement.scrollWidth <= innerWidth, wordsFit: ls.every((l) => l.scrollWidth <= l.clientWidth + 1) }; })()`);
  check('M8 phone 390 px: the 5 faces fit in one row with their words, no sideways scroll', fit.oneRow && fit.noScroll && fit.wordsFit, JSON.stringify(fit));
  await ana.eval(`document.querySelector('#mood input:checked').focus()`);
  const ring = await ana.eval(`getComputedStyle(document.querySelector('#mood input:checked').closest('label')).outlineStyle`);
  check('M8 keyboard: the chosen face takes focus with a visible ring', ring !== 'none', ring);
  await ana.eval(`document.getElementById('mood').scrollIntoView({ block: 'center' })`);
  await ana.screenshot(`${OUT}/hoy-change-phone.png`, { full: true });
});

const errs = [ana, globalThis.nutri].filter(Boolean).flatMap((p) => p.errors).filter((e) => !/40[034]/.test(e)).join(' | ');
check('no console errors', !errs, errs);
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
