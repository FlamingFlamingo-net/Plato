// "Reportar un problema" (spec "Feature: Reportar un problema"): form, contact, refusals, owner status, privacy, phone.
// Usage: node tools/report_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER, PHOTO)
import { launch } from './cdp.mjs';
import { createNutritionist, superuser } from './admin.mjs';
import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const PHOTO = process.env.PHOTO;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const N = t.nutritionist.token, NID = t.nutritionist.record.id;
const COLL = '/api/collections/issue_reports/records';
async function api(path, { method = 'GET', body, form, token = N } = {}) {
  const headers = token ? { Authorization: token } : {};
  if (body) headers['Content-Type'] = 'application/json';
  const r = await fetch(`${BASE}${path}`, { method, headers, body: form || (body ? JSON.stringify(body) : undefined) });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
function fd(fields, files = []) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, String(v));
  for (const [path, type, name] of files) f.append('images', new Blob([readFileSync(path)], { type }), name);
  return f;
}
const mineApi = async (token = N) => (await api(`${COLL}?sort=-created&perPage=100`, { token })).json?.items || [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Test files: a 6+ MB noise PNG (big phone screenshot), and a PDF.
const BIG = `${OUT}/big.png`, PDF = `${OUT}/doc.pdf`;
execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', "color=s=2300x2300,geq=r='random(1)*255':g='random(2)*255':b='random(3)*255'", '-frames:v', '1', BIG]);
writeFileSync(PDF, '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
check('setup: the big test image is over 5 MB', statSync(BIG).size > 5 * 1024 * 1024, statSync(BIG).size);

const browser = await launch({ port: 9356, profileDir: `${OUT}/chrome-profile` });
async function as(token, record, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token, record, collection: record.collectionName }))})`);
  return p;
}
const nutri = await as(N, t.nutritionist.record, { width: 1366, height: 900 });
async function openFromSettings() {
  await nutri.goto(`${BASE}/settings.html`);
  await nutri.waitFor(`document.getElementById('report-from-settings')`);
  await nutri.click('#report-from-settings');
  await nutri.waitFor(`location.pathname === '/report.html' && document.getElementById('ctx-version').textContent.startsWith('v') && !document.getElementById('mine-status').textContent.startsWith('Cargando')`, 15000);
}
const addImage = async (path, expect) => { await nutri.setFile('#r-image', path); await nutri.waitFor(expect, 15000); };
const thumbCount = `document.querySelectorAll('#thumbs li').length`;

await step('R1', async () => {
  await openFromSettings();
  const ctx = await nutri.eval(`({ page: document.getElementById('ctx-page').textContent, v: document.getElementById('ctx-version').textContent, b: document.getElementById('ctx-browser').textContent,
    empty: document.getElementById('mine-status').textContent, contactHidden: document.getElementById('contact-fields').hidden, checked: document.getElementById('r-contact').checked })`);
  check('R1 the form shows what is sent too (page /settings.html, app version, browser)', ctx.page === '/settings.html' && /^v\d+$/.test(ctx.v) && ctx.b.startsWith('Chrome'), JSON.stringify(ctx));
  check('R1 "Tus reportes" is empty at first; contact is off with its boxes hidden', ctx.empty === 'Aún no has enviado reportes.' && ctx.contactHidden && !ctx.checked, JSON.stringify(ctx));
  await nutri.fill('#r-desc', 'Al guardar la dieta el botón se queda girando.\nPasó dos veces hoy.');
  await addImage(PHOTO, `${thumbCount} === 1`);
  await addImage(PHOTO, `${thumbCount} === 2`);
  await nutri.screenshot(`${OUT}/form-desk.png`, { full: true });
  await nutri.click('#send');
  await nutri.waitFor(`!document.getElementById('sent').hidden`, 15000);
  const [r] = await mineApi();
  check('R1 saved with 2 images, page, version and browser; status Nuevo; no contact stored',
    r && r.images.length === 2 && r.page === '/settings.html' && /^plato-v\d+$/.test(r.app_version) && r.user_agent.includes('Chrome') && r.status === 'nuevo' && !r.contact_ok && !r.contact_phone && !r.contact_email && r.nutritionist === NID, JSON.stringify(r));
  const ui = await nutri.eval(`({ sent: document.getElementById('sent').textContent.replace(/\\s+/g, ' ').trim(), focus: document.activeElement.id,
    item: document.querySelector('#mine li')?.textContent.replace(/\\s+/g, ' ') || '', desc: document.getElementById('r-desc').value, thumbs: ${thumbCount} })`);
  check('R1 "Gracias. Recibimos tu reporte." gets the focus; the form is cleared', ui.sent.startsWith('Gracias. Recibimos tu reporte.') && ui.sent.includes('Lo revisaremos pronto.') && ui.focus === 'sent' && !ui.desc && ui.thumbs === 0, JSON.stringify(ui));
  check('R1 "Tus reportes" lists it: 2 imágenes, Nuevo, the first line', ui.item.includes('2 imágenes') && ui.item.includes('Nuevo') && ui.item.includes('Al guardar la dieta el botón se queda girando.') && !ui.item.includes('Pasó dos veces'), ui.item);
  globalThis.first = r;
});

await step('R2', async () => {
  await openFromSettings();
  await nutri.fill('#r-desc', 'No puedo ver las fotos de progreso de Ana.');
  await nutri.click('#r-contact');
  const pre = await nutri.eval(`({ shown: !document.getElementById('contact-fields').hidden, email: document.getElementById('r-email').value })`);
  check('R2 ticking "Permitir que te contactemos" shows the boxes, email pre-filled from the account', pre.shown && pre.email === t.nutritionist.record.email, JSON.stringify(pre));
  await nutri.fill('#r-email', ''); await nutri.fill('#r-phone', '');
  await nutri.click('#send');
  await sleep(300);
  const err = await nutri.eval(`({ msg: document.getElementById('r-contact-error').textContent, focus: document.activeElement.id, n: 0 })`);
  check('R2 both empty → "Escribe un teléfono o un correo…" and the focus goes to Teléfono', err.msg.startsWith('Escribe un teléfono o un correo') && err.focus === 'r-phone', JSON.stringify(err));
  check('R2 …and nothing was sent', (await mineApi()).length === 1);
  await nutri.fill('#r-phone', '+52 614-123-4567');
  await nutri.click('#send');
  await nutri.waitFor(`!document.getElementById('sent').hidden`, 15000);
  const [r] = await mineApi();
  check('R2 phone only: saved as +526141234567, no email', r.contact_ok && r.contact_phone === '+526141234567' && !r.contact_email, JSON.stringify(r));
  check('R2 the thank-you adds "Te contactaremos si hace falta."', (await nutri.text('#sent-sub')) === 'Te contactaremos si hace falta.');
  const e1 = await api(COLL, { method: 'POST', form: fd({ nutritionist: NID, description: 'Correo solamente, por favor.', contact_ok: true, contact_email: '  Zz.Rep@Example.COM ' }) });
  const e2 = await api(COLL, { method: 'POST', form: fd({ nutritionist: NID, description: 'Teléfono y correo, los dos.', contact_ok: true, contact_phone: '614 123 4567', contact_email: 'a@b.mx' }) });
  check('R2 email only (saved lowercase) and both are accepted', e1.status === 200 && e1.json.contact_email === 'zz.rep@example.com' && !e1.json.contact_phone && e2.status === 200 && e2.json.contact_phone === '6141234567' && e2.json.contact_email === 'a@b.mx', `${e1.status} ${JSON.stringify(e1.json)} ${e2.status}`);
});

await step('R3', async () => {
  await openFromSettings();
  await nutri.fill('#r-desc', 'Escribí mi teléfono y luego quité la casilla.');
  await nutri.click('#r-contact');
  await nutri.fill('#r-phone', '6141234567');
  await nutri.click('#r-contact');
  await nutri.click('#send');
  await nutri.waitFor(`!document.getElementById('sent').hidden`, 15000);
  const [r] = await mineApi();
  check('R3 contact unticked after typing a phone: nothing stored', r.description.startsWith('Escribí mi teléfono') && !r.contact_ok && !r.contact_phone && !r.contact_email, JSON.stringify(r));
  const d = await api(COLL, { method: 'POST', form: fd({ nutritionist: NID, description: 'Mandado directo con datos ocultos.', contact_ok: false, contact_phone: '6141234567', contact_email: 'oculto@example.com' }) });
  check('R3 …also when the server is called directly with phone and email', d.status === 200 && !d.json.contact_phone && !d.json.contact_email, JSON.stringify(d.json));
});

await step('R4', async () => {
  await openFromSettings();
  await nutri.fill('#r-desc', 'Muy corto');
  await nutri.click('#send');
  await sleep(300);
  const e = await nutri.eval(`({ msg: document.getElementById('r-desc-error').textContent, inv: document.getElementById('r-desc').getAttribute('aria-invalid'), focus: document.activeElement.id })`);
  check('R4 a 9-character description is refused next to the field, focus on it', e.msg.startsWith('Cuéntanos un poco más') && e.inv === 'true' && e.focus === 'r-desc', JSON.stringify(e));
  await addImage(PDF, `!document.getElementById('r-image-error').hidden`);
  check('R4 a PDF is refused before sending', (await nutri.text('#r-image-error')).includes('no es una imagen') && (await nutri.eval(thumbCount)) === 0);
  await addImage(BIG, `${thumbCount} === 1`);
  check('R4 a 6+ MB photo is reduced automatically and added (changed during build: refusing big phone photos helps no one)', true);
  await addImage(PHOTO, `${thumbCount} === 2`);
  await addImage(PHOTO, `${thumbCount} === 3`);
  const full = await nutri.eval(`({ dis: document.getElementById('r-image').disabled, label: document.querySelector('#add-image-label span').textContent })`);
  check('R4 after 3 images a 4th cannot be added ("Máximo 3 imágenes")', full.dis && full.label === 'Máximo 3 imágenes', JSON.stringify(full));
  await nutri.click('#thumbs li:nth-child(2) button');
  check('R4 "Quitar" removes one (2 left, adding works again)', (await nutri.eval(thumbCount)) === 2 && !(await nutri.eval(`document.getElementById('r-image').disabled`)));
  await nutri.fill('#r-desc', 'Probando con una foto grande reducida.');
  await nutri.click('#send');
  await nutri.waitFor(`!document.getElementById('sent').hidden`, 20000);
  const [r] = await mineApi();
  check('R4 …and the reduced photo is accepted by the server', r.images.length === 2, JSON.stringify(r.images));
  const long = await api(COLL, { method: 'POST', form: fd({ nutritionist: NID, description: 'x'.repeat(2001) }) });
  const four = await api(COLL, { method: 'POST', form: fd({ nutritionist: NID, description: 'Cuatro imágenes directo.' }, [1, 2, 3, 4].map((i) => [PHOTO, 'image/jpeg', `f${i}.jpg`])) });
  const big = await api(COLL, { method: 'POST', form: fd({ nutritionist: NID, description: 'Imagen de más de 5 MB directo.' }, [[BIG, 'image/png', 'big.png']]) });
  const pdf = await api(COLL, { method: 'POST', form: fd({ nutritionist: NID, description: 'Un PDF directo al servidor.' }, [[PDF, 'application/pdf', 'doc.pdf']]) });
  const nine = await api(COLL, { method: 'POST', form: fd({ nutritionist: NID, description: 'Teléfono de nueve dígitos.', contact_ok: true, contact_phone: '614123456' }) });
  check('R4 the server refuses 2,001 characters, a 4th image, over 5 MB, a PDF and a 9-digit phone',
    [long, four, big, pdf, nine].every((x) => x.status === 400), [long, four, big, pdf, nine].map((x) => x.status).join(' '));
});

let SU;
await step('R5', async () => {
  SU = await superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
  const u = await api(`${COLL}/${globalThis.first.id}`, { method: 'PATCH', token: SU, body: { status: 'resuelto', owner_note: 'Arreglado en v28.' } });
  check('R5 the owner (admin panel) sets Resuelto and a private note', u.status === 200 && u.json.status === 'resuelto', `${u.status} ${JSON.stringify(u.json)}`);
  await nutri.goto(`${BASE}/report.html`);
  await nutri.waitFor(`document.querySelectorAll('#mine li').length >= 6`, 15000);
  const item = await nutri.eval(`[...document.querySelectorAll('#mine li')].find((li) => li.textContent.includes('Al guardar la dieta'))?.textContent || ''`);
  check('R5 the nutritionist sees "Resuelto" after a refresh', item.includes('Resuelto'), item);
  const v = await api(`${COLL}/${globalThis.first.id}`);
  check('R5 the owner\'s private note is not shown to the nutritionist', v.status === 200 && !('owner_note' in v.json), JSON.stringify(Object.keys(v.json)));
  const all = (await api(`${COLL}?perPage=200`, { token: SU })).json.totalItems;
  check('R5 the owner sees every report', all >= 7, all);
  await nutri.eval(`document.querySelector('#mine').scrollIntoView()`);
  await nutri.screenshot(`${OUT}/list-desk.png`, { full: true });
});

await step('R6', async () => {
  await createNutritionist(BASE, { name: 'Otra', email: 'otra-report@test.local', password: 'OtraReport12345' });
  const other = (await api('/api/collections/nutritionists/auth-with-password', { method: 'POST', token: null, body: { identity: 'otra-report@test.local', password: 'OtraReport12345' } })).json;
  const O = other.token, OID = other.record.id, id = globalThis.first.id;
  const ol = (await api(COLL, { token: O })).json.totalItems, ov = (await api(`${COLL}/${id}`, { token: O })).status;
  check('R6 another nutritionist sees none of my reports', ol === 0 && ov === 404, `${ol} ${ov}`);
  const pl = (await api(COLL, { token: t.ana.token })).json?.totalItems ?? 0;
  const pc = await api(COLL, { method: 'POST', token: t.ana.token, form: fd({ nutritionist: NID, description: 'Soy paciente y quiero reportar.' }) });
  check('R6 a patient sees none and cannot create one', pl === 0 && pc.status >= 400, `${pl} ${pc.status}`);
  const anon = (await api(COLL, { token: null })).json?.totalItems ?? 0;
  const anonc = await api(COLL, { method: 'POST', token: null, form: fd({ nutritionist: NID, description: 'Sin sesión, intento crear.' }) });
  check('R6 without signing in: nothing to read, nothing created', anon === 0 && anonc.status >= 400, `${anon} ${anonc.status}`);
  const ed = await api(`${COLL}/${id}`, { method: 'PATCH', body: { description: 'Lo cambio después de enviarlo.' } });
  const st = await api(`${COLL}/${id}`, { method: 'PATCH', body: { status: 'nuevo' } });
  const del = await api(`${COLL}/${id}`, { method: 'DELETE' });
  check('R6 the nutritionist cannot edit, change the status or delete a sent report', [ed, st, del].every((x) => x.status === 403 || x.status === 404) && (await api(`${COLL}/${id}`)).json.status === 'resuelto', [ed, st, del].map((x) => x.status).join(' '));
  const setStatus = await api(COLL, { method: 'POST', form: fd({ nutritionist: NID, description: 'Intento crear ya resuelto.', status: 'resuelto' }) });
  const forOther = await api(COLL, { method: 'POST', form: fd({ nutritionist: OID, description: 'Intento crear a nombre de otra.' }) });
  check('R6 a report cannot be created already "resuelto" or in another nutritionist\'s name', setStatus.status === 400 && forOther.status === 400, `${setStatus.status} ${forOther.status}`);
  const file = globalThis.first.images[0];
  const raw = await fetch(`${BASE}/api/files/issue_reports/${id}/${file}`);
  const ftok = (await api('/api/files/token', { method: 'POST', token: O })).json.token;
  const otherFile = await fetch(`${BASE}/api/files/issue_reports/${id}/${file}?token=${ftok}`);
  const ownTok = (await api('/api/files/token', { method: 'POST' })).json.token;
  const ownFile = await fetch(`${BASE}/api/files/issue_reports/${id}/${file}?token=${ownTok}`);
  check('R6 the images are protected: not without a sign-in, not for another nutritionist; yes for the author', raw.status >= 400 && otherFile.status >= 400 && ownFile.status === 200, `${raw.status} ${otherFile.status} ${ownFile.status}`);
  const codes = [];
  for (let i = 1; i <= 11; i++) codes.push((await api(COLL, { method: 'POST', token: O, form: fd({ nutritionist: OID, description: `Reporte número ${i} de hoy.` }) })).status);
  check('R6 10 reports in 24 h are fine; the 11th is refused', codes.slice(0, 10).every((c) => c === 200) && codes[10] === 400, codes.join(' '));
});

await step('R7', async () => {
  const phone = await as(N, t.nutritionist.record, { width: 390, height: 844, mobile: true });
  for (const pg of ['home', 'patients', 'agenda', 'settings', 'templates']) {
    await phone.goto(`${BASE}/${pg}.html`);
    await phone.waitFor(`document.querySelector('.plato-report-link')`);
    const fit = await phone.eval(`({ ok: document.documentElement.scrollWidth <= innerWidth, vis: document.querySelector('.plato-report-link').getBoundingClientRect().right <= innerWidth })`);
    check(`R7 phone: "${pg}" keeps the Reportar link in view, no sideways scroll`, fit.ok && fit.vis, JSON.stringify(fit));
  }
  await phone.goto(`${BASE}/patient.html?id=${t.ana_id}`);
  await phone.waitFor(`document.querySelector('.plato-report-link')`);
  check('R7 phone: the patient page has the link too, no sideways scroll', await phone.eval(`document.documentElement.scrollWidth <= innerWidth`));
  await phone.goto(`${BASE}/report.html`);
  await phone.waitFor(`!document.getElementById('mine-status').textContent.startsWith('Cargando')`);
  await phone.click('#r-contact');
  check('R7 phone 390 px: the report page fits, no sideways scroll', await phone.eval(`document.documentElement.scrollWidth <= innerWidth`));
  await phone.screenshot(`${OUT}/form-phone.png`, { full: true });
  const kb = await phone.eval(`(() => { const f = document.getElementById('r-image'); f.focus(); const fileOk = document.activeElement === f;
    const link = document.querySelector('.plato-report-link'); return { fileOk, linkName: link.getAttribute('aria-label'),
    described: ['r-desc', 'r-phone', 'r-email'].every((id) => document.getElementById(id).getAttribute('aria-describedby').includes(id + '-error')) }; })()`);
  check('R7 keyboard: the image picker takes focus; the menu link is named; errors are tied to their fields', kb.fileOk && kb.linkName === 'Reportar un problema' && kb.described, JSON.stringify(kb));
  globalThis.phone = phone;
});

const errs = [nutri, globalThis.phone].filter(Boolean).flatMap((p) => p.errors).filter((e) => !/\b40[034]\b|Failed to load resource/.test(e)).join(' | ');
check('no console errors', !errs, errs);
await browser.close();
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
