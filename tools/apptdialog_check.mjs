// "Nueva cita" / "Editar cita" dialog on small phones: nothing off screen, Agendar always visible.
// Usage: node tools/apptdialog_check.mjs <base-url> <demo-tokens.json> <out-dir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const browser = await launch({ port: 9358, profileDir: `${OUT}/chrome-profile` });
for (const [w, h] of [[320, 568], [360, 640], [390, 844], [320, 300], [1366, 900]]) {
  const p = await browser.newPage({ width: w, height: h, mobile: w < 500 });
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: t.nutritionist.token, record: t.nutritionist.record, collection: 'nutritionists' }))})`);
  await p.goto(`${BASE}/agenda.html?new=1`);
  await p.waitFor(`document.querySelector('#ap-dialog')?.open && document.querySelector('#ap-save')`, 15000);
  await new Promise((r) => setTimeout(r, 400));
  const r = await p.eval(`(() => { const vw = innerWidth, vh = innerHeight; const ids = ['ap-patient','ap-type','ap-date','ap-time','ap-min','ap-note','ap-save'];
    const out = {}; for (const id of ids) { const b = document.getElementById(id).getBoundingClientRect(); out[id] = [Math.round(b.left), Math.round(b.right), Math.round(b.bottom)]; }
    const d = document.querySelector('#ap-dialog > div').getBoundingClientRect(); const s = document.getElementById('ap-save').getBoundingClientRect();
    return { vw, vh, out, dLeft: d.left, dRight: d.right, dBottom: d.bottom, saveVisible: s.top >= 0 && s.bottom <= vh && s.left >= 0 && s.right <= vw, pageScroll: document.documentElement.scrollWidth > vw }; })()`);
  const fieldsIn = ['ap-patient', 'ap-type', 'ap-date', 'ap-time', 'ap-min', 'ap-note'].every((id) => r.out[id][0] >= 0 && r.out[id][1] <= r.vw);
  check(`${w}x${h}: dialog inside the screen, every field within the width`, r.dLeft >= 0 && r.dRight <= r.vw && r.dBottom <= r.vh && fieldsIn, JSON.stringify(r));
  check(`${w}x${h}: "Agendar cita" fully visible without scrolling`, r.saveVisible, JSON.stringify(r.out['ap-save']));
  await p.screenshot(`${OUT}/dlg-${w}x${h}.png`);
}
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
