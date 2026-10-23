// tools/smoke.mjs — screenshots of the seeded demo on a server, using session tokens from seed/demo-tokens.json.
//   node tools/smoke.mjs http://127.0.0.1:8090 seed/demo-tokens.json <outDir>
import { launch } from './cdp.mjs';
import { readFileSync, mkdirSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const browser = await launch({ port: 9334, profileDir: `${OUT}/chrome-profile` });

async function as(who, viewport) {
  const p = await browser.newPage(viewport);
  await p.goto(`${BASE}/manifest.webmanifest`);
  const s = t[who];
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: s.token, record: s.record, collection: s.record.collectionName }))})`);
  return p;
}

const n = await as('nutritionist', { width: 1280, height: 860 });
await n.goto(`${BASE}/patients.html`);
await n.waitFor(`document.querySelectorAll('.plato-patient-link').length === 2`);
console.log('patients:', await n.eval(`[...document.querySelectorAll('.plato-patient-link')].map(a => a.innerText.replace(/\\s+/g,' ')).join(' | ')`));
await n.screenshot(`${OUT}/demo-patients.png`, { full: false });
await n.goto(`${BASE}/patient.html?id=${t.ana_id}`);
await n.waitFor(`document.querySelectorAll('.chart-dot').length === 4`);
await n.screenshot(`${OUT}/demo-ana-overview.png`, { full: false });
await n.goto(`${BASE}/patient.html?id=${t.ana_id}&tab=log`);
await n.waitFor(`[...document.querySelectorAll('.plato-log-card img')].length === 2 && [...document.querySelectorAll('.plato-log-card img')].every(i => i.naturalWidth > 0)`);
await n.screenshot(`${OUT}/demo-ana-log.png`, { full: false });

const a = await as('ana', { width: 390, height: 844, mobile: true });
await a.goto(`${BASE}/today.html`);
await a.waitFor(`document.querySelector('.plate-count')`);
console.log('ana today plate:', await a.text('.plate-count'), '| meals:', await a.eval(`document.querySelectorAll('.plato-meal').length`));
await a.screenshot(`${OUT}/demo-ana-today.png`, { full: false });
await a.goto(`${BASE}/progress.html`);
await a.waitFor(`document.querySelectorAll('.chart-dot').length === 4`);
console.log('ana progress:', await a.text('.plato-chart figcaption'));
await a.screenshot(`${OUT}/demo-ana-progress.png`, { full: false });

console.log('errors:', [...n.errors, ...a.errors].length ? [...n.errors, ...a.errors] : 'none');
await browser.close();
