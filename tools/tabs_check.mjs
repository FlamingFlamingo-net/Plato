// Inicio buttons: no label is ever cut; icons hide only below 360 px.
// Usage: node tools/tabs_check.mjs <base-url> <demo-tokens.json> <out-dir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const browser = await launch({ port: 9360, profileDir: `${OUT}/chrome-profile` });
for (const w of [320, 340, 359, 360, 390, 430, 520, 600, 860, 1366]) {
  const p = await browser.newPage({ width: w, height: 800, mobile: w < 600 });
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: t.nutritionist.token, record: t.nutritionist.record, collection: 'nutritionists' }))})`);
  await p.goto(`${BASE}/home.html`);
  await p.waitFor(`document.querySelectorAll('#tabs .plato-home-tab').length >= 3`, 15000);
  await new Promise((r) => setTimeout(r, 600));
  const r = await p.eval(`(() => { const tabs = [...document.querySelectorAll('#tabs .plato-home-tab')];
    const cut = tabs.filter((b) => { const s = b.querySelector('strong'); return s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1; }).map((b) => b.textContent.trim().slice(0, 14));
    const out = tabs.filter((b) => b.getBoundingClientRect().right > innerWidth).length;
    const icons = tabs.map((b) => getComputedStyle(b.querySelector('.plato-home-tab-icon')).display);
    return { n: tabs.length, cut, out, icons: [...new Set(icons)], scroll: document.documentElement.scrollWidth > innerWidth || (innerWidth > ${w} + 1 && ${w} < 600), words: tabs.map((b) => b.querySelector('strong').textContent) }; })()`);
  check(`${w}px: ${r.n} buttons, no label cut or overflowing, no sideways scroll`, r.n >= 6 && !r.cut.length && !r.out && !r.scroll, JSON.stringify(r));
  check(`${w}px: icons ${w < 360 ? 'hidden' : 'shown'}`, r.icons.length === 1 && (w < 360 ? r.icons[0] === 'none' : r.icons[0] !== 'none'), JSON.stringify(r.icons));
  if (w === 320 || w === 360) await p.screenshot(`${OUT}/tabs-${w}.png`);
}
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
