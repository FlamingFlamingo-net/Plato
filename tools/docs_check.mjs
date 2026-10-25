// tools/docs_check.mjs — acceptance for "Print the weekly diet" and "Export a patient's data".
// THROWAWAY server seeded with tools/seed.py (it writes demo-tokens.json):
//   node tools/docs_check.mjs http://127.0.0.1:8091 <seed-out-dir>/demo-tokens.json <outDir>
// PDF checks call tools/pdf_info.py with $PDF_PYTHON (a Python that has PyMuPDF).
import { launch } from './cdp.mjs';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const PY = process.env.PDF_PYTHON || 'python';
const PDF_INFO = fileURLToPath(new URL('./pdf_info.py', import.meta.url));
const pdfInfo = (file, png) => JSON.parse(execFileSync(PY, [PDF_INFO, file, ...(png ? ['--png', png] : [])], { encoding: 'utf8' }));
const A4 = ([w, h]) => Math.abs(w - 595.28) < 1.5 && Math.abs(h - 841.89) < 1.5;
const A4L = ([w, h]) => Math.abs(w - 841.89) < 1.5 && Math.abs(h - 595.28) < 1.5;

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };

const browser = await launch({ port: 9335, profileDir: `${OUT}/chrome-profile` });
async function as(who, viewport = { width: 1280, height: 900 }) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}
const api = (p, method, path, body) => p.eval(`(async () => {
  const s = JSON.parse(localStorage.getItem('plato.auth'));
  const r = await fetch(${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { 'Content-Type': 'application/json', Authorization: s.token }, body: ${body ? JSON.stringify(JSON.stringify(body)) : 'undefined'} });
  return { status: r.status, body: await r.json().catch(() => null) };
})()`);

const nutri = await as('nutritionist');
const ana = await as('ana', { width: 390, height: 844, mobile: true });
const anaId = t.ana_id, carlosId = t.carlos_id;
const tableText = (p) => p.eval(`document.querySelector('.week-table').innerText.replace(/\\s+/g, ' ').trim()`);
let nutriTable = '';

// ---------- Print: acceptance 1 ----------
await step('P1', async () => {
  await nutri.goto(`${BASE}/diet-print.html?id=${anaId}`);
  await nutri.waitFor(`!document.getElementById('sheet').hidden`);
  const cols = await nutri.eval(`document.querySelectorAll('.week-table thead th').length - 1`);
  const rows = await nutri.eval(`document.querySelectorAll('.week-table tbody tr').length`);
  const head = await nutri.eval(`document.querySelector('.sheet-head').innerText`);
  nutriTable = await tableText(nutri);
  await nutri.screenshot(`${OUT}/print-nutri-screen.png`);
  await nutri.pdf(`${OUT}/print-ana.pdf`);
  const info = pdfInfo(`${OUT}/print-ana.pdf`, `${OUT}/print-ana`);
  check('P1 nutritionist sheet: 7 day columns, 5 meal rows', cols === 7 && rows === 5, `${cols}x${rows}`);
  check('P1 header shows plan, patient, nutritionist + clinic, printed date',
    /Plan para bajar de peso/.test(head) && /Ana López Ríos/.test(head) && /Plan de Laura Méndez · Consultorio Demo/.test(head) && /Impreso el/.test(head), head);
  check('P1 PDF is 1 page, A4 landscape', info.pages === 1 && A4L(info.sizes[0]), JSON.stringify(info.sizes));
  check('P1 PDF has every day and every meal name', ['Lunes', 'Domingo', 'Desayuno', 'Cena', 'Avena con plátano'].every((w) => info.text[0].includes(w)), 'missing text');
});

// ---------- Print: acceptance 2 (patient from Today) ----------
await step('P2', async () => {
  await ana.goto(`${BASE}/today.html`);
  await ana.waitFor(`document.getElementById('print-week')`);
  await ana.click('#print-week');
  await ana.waitUrl('/diet-print.html');
  await ana.waitFor(`!document.getElementById('sheet').hidden`);
  const txt = await tableText(ana);
  await ana.screenshot(`${OUT}/print-phone.png`, { full: false });
  check('P2 patient opens "Imprimir mi semana" from Today: same week as the nutritionist sees', txt === nutriTable, 'tables differ');
  const back = await ana.eval(`document.getElementById('back').getAttribute('href')`);
  check('P2 patient "Volver" goes to Today', back === '/today.html', back);
});

// ---------- Print: acceptance 3 (long diet → 2 pages, header repeats, no split meal) ----------
await step('P3', async () => {
  const pw = randomBytes(16).toString('hex');
  const p = await api(nutri, 'POST', '/api/collections/patients/records', { name: 'ZZ Dieta Larga', sex: 'female', nutritionist: t.nutritionist.record.id, password: pw, passwordConfirm: pw });
  const long = 'Pechuga de pollo a la plancha con verduras al vapor, arroz integral y ensalada verde con aguacate. ';
  const slots = ['breakfast', 'snack_am', 'lunch', 'snack_pm', 'dinner'];
  const meals = {};
  for (let d = 1; d <= 7; d++) { meals[d] = {}; for (const s of slots) meals[d][s] = `INI${d}${s} ${long.repeat(2)}FIN${d}${s}`; }
  const r = await api(nutri, 'POST', '/api/collections/diets/records', { patient: p.body.id, title: 'Larga', meals });
  if (r.status !== 200) throw new Error(`diet create ${r.status}`);
  await nutri.goto(`${BASE}/diet-print.html?id=${p.body.id}`);
  await nutri.waitFor(`!document.getElementById('sheet').hidden`);
  await nutri.pdf(`${OUT}/print-long.pdf`);
  const info = pdfInfo(`${OUT}/print-long.pdf`, `${OUT}/print-long`);
  const flat = info.text.map((x) => x.replace(/\s+/g, ''));
  let split = [];
  for (let d = 1; d <= 7; d++) for (const s of slots) {
    const a = flat.findIndex((x) => x.includes(`INI${d}${s}`)), b = flat.findIndex((x) => x.includes(`FIN${d}${s}`));
    if (a < 0 || a !== b) split.push(`${d}${s}:${a}/${b}`);
  }
  check('P3 long diet: 2+ pages, all A4 landscape', info.pages >= 2 && info.sizes.every(A4L), `${info.pages} ${JSON.stringify(info.sizes)}`);
  check('P3 day names repeat at the top of every page', info.text.every((x) => x.includes('Lunes') && x.includes('Domingo')), 'missing on a page');
  check('P3 no meal text is cut across two pages', split.length === 0, split.join(' '));
});

// ---------- Print: acceptance 4 (no diet) ----------
await step('P4', async () => {
  await nutri.goto(`${BASE}/diet-print.html?id=${carlosId}`);
  await nutri.waitFor(`document.getElementById('status').textContent === 'Aún no hay dieta.'`);
  const hidden = await nutri.eval(`document.getElementById('print').hidden && document.getElementById('sheet').hidden`);
  check('P4 patient with no diet: "Aún no hay dieta." and no print button', hidden, hidden);
});

// ---------- Print + export: acceptance (second nutritionist) ----------
let other;
await step('P5', async () => {
  other = await browser.newPage({ width: 1280, height: 900 });
  const email = `zz-other-${randomBytes(3).toString('hex')}@test.local`, pw = randomBytes(12).toString('base64url');
  await other.goto(`${BASE}/`);
  await other.click('#tab-nutri'); await other.click('#to-signup');
  await other.fill('#s-name', 'ZZ Otra'); await other.fill('#s-email', email); await other.fill('#s-password', pw);
  await other.click('#nutri-signup [type=submit]');
  await other.waitUrl('/patients.html');
  await other.goto(`${BASE}/diet-print.html?id=${anaId}`);
  await other.waitFor(`document.getElementById('status').textContent.startsWith('No encontrado')`);
  check('P5 second nutritionist opening Ana\'s print page: "No encontrado"', await other.eval(`document.getElementById('sheet').hidden`));
  await other.goto(`${BASE}/export.html?id=${anaId}`);
  await other.waitFor(`document.getElementById('status').textContent.startsWith('No encontrado')`);
  check('E3 second nutritionist opening Ana\'s export: "No encontrado"', await other.eval(`document.getElementById('sheet').hidden`));
});

// ---------- Print: acceptance 6 (black and white) ----------
await step('P6', async () => {
  await nutri.goto(`${BASE}/diet-print.html?id=${anaId}`);
  await nutri.waitFor(`!document.getElementById('sheet').hidden`);
  await nutri.eval(`document.documentElement.style.filter = 'grayscale(1)'`);
  await nutri.screenshot(`${OUT}/print-grey.png`);
  const labels = await nutri.eval(`[...document.querySelectorAll('.week-table tbody th')].map(th => th.innerText.trim())`);
  check('P6 every meal row is labelled by name, not only by colour', labels.join('|') === 'Desayuno|Colación de la mañana|Comida|Colación de la tarde|Cena', labels.join('|'));
});

// ---------- Print: unsaved diet changes ----------
await step('P7', async () => {
  await nutri.goto(`${BASE}/patient.html?id=${anaId}&tab=diet`);
  await nutri.waitFor(`document.getElementById('meal-breakfast')?.value`);
  await nutri.fill('#meal-breakfast', 'Cambio sin guardar');
  await nutri.click('#print-week');
  await new Promise((r) => setTimeout(r, 600));
  const where = await nutri.eval('location.pathname');
  const toastTxt = await nutri.eval(`document.getElementById('plato-toasts')?.innerText || ''`);
  check('P7 unsaved diet: "Imprimir semana" asks to save first and stays', where === '/patient.html' && toastTxt.includes('Guarda la dieta'), `${where} ${toastTxt}`);
  await nutri.goto(`${BASE}/manifest.webmanifest`); // leave without saving
});

// ---------- Export: acceptance 1 + 2 ----------
await step('E1', async () => {
  await nutri.goto(`${BASE}/export.html?id=${anaId}`);
  await nutri.waitFor(`!document.getElementById('sheet').hidden`);
  await nutri.waitFor(`[...document.querySelectorAll('.doc-log img')].every(i => i.complete && i.naturalWidth > 0)`, 15000);
  const counts = await nutri.eval(`({
    m: document.querySelectorAll('.doc-table tbody tr').length,
    dots: document.querySelectorAll('.doc-chart .chart-dot').length,
    days: document.querySelectorAll('.week-day').length,
    photos: document.querySelectorAll('.doc-log img').length,
    notesHidden: document.getElementById('notes-section').hidden,
    alta: [...document.querySelectorAll('.doc-facts div')].find(d => d.querySelector('dt').textContent === 'Alta en Plato').querySelector('dd').textContent,
  })`);
  const expectAlta = await nutri.eval(`(async () => {
    const s = JSON.parse(localStorage.getItem('plato.auth'));
    const p = await fetch('/api/collections/patients/records/${anaId}', { headers: { Authorization: s.token } }).then(r => r.json());
    return new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(p.created.replace(' ', 'T')));
  })()`);
  check('E1 timestamps show the LOCAL date ("Alta en Plato")', counts.alta === expectAlta, `${counts.alta} vs ${expectAlta}`);
  check('E1 export page: 4 measurements, chart with 4 points, 7 diet days, 2 photos, notes hidden',
    counts.m === 4 && counts.dots === 4 && counts.days === 7 && counts.photos === 2 && counts.notesHidden, JSON.stringify(counts));
  await nutri.pdf(`${OUT}/export-no-notes.pdf`);
  const info = pdfInfo(`${OUT}/export-no-notes.pdf`, `${OUT}/export`);
  const all = info.text.join('\n');
  check('E2 export PDF: every page A4 portrait', info.sizes.every(A4), JSON.stringify(info.sizes));
  check('E2 export PDF: each photo whole on one page (2 images total)', info.images.reduce((a, b) => a + b, 0) === 2, JSON.stringify(info.images));
  check('E1 export PDF has no private notes when unticked', !all.includes('Notas privadas') && !all.includes('antojos'), 'notes leaked');
  check('E1 export PDF has no email address', !/@/.test(all), 'found @');

  // JSON download, captured instead of saved.
  const grab = () => nutri.eval(`new Promise((ok) => {
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b) => { b.text().then(ok); URL.createObjectURL = orig; return orig.call(URL, b); };
    HTMLAnchorElement.prototype.click = function () {};
    document.getElementById('json').click();
  })`);
  const j1 = JSON.parse(await grab());
  check('E1 JSON: 4 measurements, 7 diet days, 2 meal logs, no private notes, no email',
    j1.measurements.length === 4 && Object.keys(j1.diet.meals).length === 7 && j1.meal_logs.length === 2 && !('private_notes' in j1) && !JSON.stringify(j1).includes('@'),
    JSON.stringify({ m: j1.measurements.length, l: j1.meal_logs.length, n: 'private_notes' in j1 }));
  await nutri.click('#with-notes');
  const shown = await nutri.eval(`!document.getElementById('notes-section').hidden && document.querySelectorAll('#notes-section li').length`);
  const j2 = JSON.parse(await grab());
  check('E1 "Incluir notas privadas" adds 1 note to the page and the JSON', shown === 1 && j2.private_notes?.length === 1, `${shown} ${j2.private_notes?.length}`);
  await nutri.pdf(`${OUT}/export-with-notes.pdf`);
  const info2 = pdfInfo(`${OUT}/export-with-notes.pdf`);
  check('E1 export PDF with notes ticked contains the note', info2.text.join('\n').includes('antojos'), 'note missing');
  writeFileSync(`${OUT}/export-sample.json`, JSON.stringify(j2, null, 2));
});

// ---------- Export: acceptance 4 (patient) ----------
await step('E4', async () => {
  await ana.goto(`${BASE}/export.html?id=${anaId}`);
  await ana.waitFor(`location.pathname === '/today.html'`);
  check('E4 patient opening the export address is sent back to Today', true);
});

const errs = [...nutri.errors, ...ana.errors, ...(other?.errors || [])].filter((e) => !/404|Not Found|beforeunload/i.test(e)); // beforeunload: P7 leaves unsaved changes on purpose
check('no console errors', errs.length === 0, errs.join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
