// Inicio order: small screens = Hoy, Marcar todo como visto, buttons, list right under the buttons; wide = buttons left, Hoy right.
// Usage: node tools/homeorder_check.mjs <base-url> <demo-tokens.json> <out-dir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const browser = await launch({ port: 9361, profileDir: `${OUT}/chrome-profile` });
for (const w of [320, 360, 390, 600, 860, 861, 1366]) {
  const p = await browser.newPage({ width: w, height: 800, mobile: w < 600 });
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: t.nutritionist.token, record: t.nutritionist.record, collection: 'nutritionists' }))})`);
  await p.goto(`${BASE}/home.html`);
  await p.waitFor(`document.querySelectorAll('#tabs .plato-home-tab').length >= 3 && document.querySelectorAll('#today li').length >= 3`, 15000);
  await new Promise((r) => setTimeout(r, 500));
  const r = await p.eval(`(() => { const R = (s) => document.querySelector(s).getBoundingClientRect();
    const today = R('.plato-home-today'), all = R('#all-seen'), tabs = R('#tabs'), feed = R('#feed');
    const dom = [...document.querySelectorAll('.plato-home-today, #all-seen, #tabs, #feed')].map((e) => e.id || e.className.split(' ')[0]);
    return { today: [today.top, today.left, today.bottom], all: [all.top, all.bottom], tabs: [tabs.top, tabs.left, tabs.bottom, tabs.right], feed: feed.top, dom }; })()`);
  const stacked = w <= 860;
  const ok = stacked
    ? r.today[0] < r.all[0] && r.all[0] < r.tabs[0] && r.tabs[2] <= r.feed && r.feed - r.tabs[2] < 40
    : r.tabs[3] <= r.today[1] + 1 && Math.abs(r.tabs[0] - r.today[0]) < 4;
  check(`${w}px: ${stacked ? 'Hoy, Marcar todo, buttons, list right under the buttons' : 'buttons left, Hoy right, same row'}`, ok, JSON.stringify(r));
  check(`${w}px: reading/keyboard order in the page = Hoy, Marcar todo, buttons, list`, r.dom.join() === 'plato-home-today,all-seen,tabs,feed', r.dom.join());
  if (w === 320) await p.screenshot(`${OUT}/order-320.png`);
}
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
