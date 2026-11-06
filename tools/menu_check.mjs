// Nutritionist header on small phones: one Menú button, no overlap, panel works by keyboard and touch.
// Usage: node tools/menu_check.mjs <base-url> <demo-tokens.json> <out-dir>
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';
const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await launch({ port: 9359, profileDir: `${OUT}/chrome-profile` });
const PAGES = ['home', 'patients', 'agenda', 'settings', 'templates', 'report', `patient?id=${t.ana_id}`];
let first = true;
for (const w of [320, 360, 390]) {
  const p = await browser.newPage({ width: w, height: 700, mobile: true });
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: t.nutritionist.token, record: t.nutritionist.record, collection: 'nutritionists' }))})`);
  for (const pg of PAGES) {
    await p.goto(`${BASE}/${pg.includes('?') ? pg.replace('patient?', 'patient.html?') : pg + '.html'}`);
    await p.waitFor(`document.querySelector('.plato-menu-btn')`, 15000);
    if (pg === 'patients') await p.eval(`document.getElementById('clinic').textContent = 'Clínica de Nutrición y Entrenamiento Integral del Norte'`);
    await sleep(500);
    const r = await p.eval(`(() => { const hd = document.querySelector('.plato-top'), b = document.querySelector('.plato-menu-btn').getBoundingClientRect(), br = hd.querySelector('.plato-brand').getBoundingClientRect(), h = hd.getBoundingClientRect();
      const row = document.getElementById('nav-menu'); return { h: Math.round(h.height), overlap: br.right > b.left + 0.5, btnIn: b.right <= innerWidth && b.left >= 0, brandIn: br.left >= 0 && br.right <= innerWidth, closed: getComputedStyle(row).display === 'none', exp: document.querySelector('.plato-menu-btn').getAttribute('aria-expanded'), scroll: document.documentElement.scrollWidth > innerWidth }; })()`);
    check(`${w}px ${pg.split('?')[0]}: one-line header (two lines only where the clinic name sits under the brand), brand and Menú do not overlap, closed at first, no sideways scroll`,
      r.h <= (pg.startsWith('patient') ? 80 : 66) && !r.overlap && r.btnIn && r.brandIn && r.closed && r.exp === 'false' && !r.scroll, JSON.stringify(r));
  }
  // Open / close behaviour on the busiest page.
  await p.goto(`${BASE}/home.html`);
  await p.waitFor(`document.querySelector('.plato-menu-btn')`, 15000);
  await p.click('.plato-menu-btn');
  const o = await p.eval(`(() => { const links = [...document.querySelectorAll('#nav-menu > a, #nav-menu > button')].map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent.trim() || e.getAttribute('aria-label'), vis: r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.height >= 36 }; });
    return { exp: document.querySelector('.plato-menu-btn').getAttribute('aria-expanded'), links, cur: document.querySelector('#nav-menu [aria-current=page]')?.textContent.trim() }; })()`);
  check(`${w}px: Menú opens with all 7 entries visible inside the width, current page marked`, o.exp === 'true' && o.links.length === 7 && o.links.every((l) => l.vis) && o.cur === 'Inicio', JSON.stringify(o));
  if (first) { await p.screenshot(`${OUT}/menu-open-${w}.png`); }
  await p.press?.('Escape');
  await p.eval(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  const e = await p.eval(`({ exp: document.querySelector('.plato-menu-btn').getAttribute('aria-expanded'), focus: document.activeElement.classList.contains('plato-menu-btn') })`);
  check(`${w}px: Escape closes it and focus returns to the Menú button`, e.exp === 'false' && e.focus, JSON.stringify(e));
  await p.click('.plato-menu-btn');
  await p.eval(`document.querySelector('main').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  check(`${w}px: tapping outside closes it`, (await p.eval(`document.querySelector('.plato-menu-btn').getAttribute('aria-expanded')`)) === 'false');
  await p.click('.plato-menu-btn');
  await p.click('#nav-menu a[href="/agenda.html"]');
  await p.waitFor(`location.pathname === '/agenda.html'`, 10000);
  check(`${w}px: choosing a link goes there`, true);
  await p.goto(`${BASE}/patients.html`);
  await p.waitFor(`document.querySelector('.plato-menu-btn')`, 15000);
  await p.click('.plato-menu-btn');
  await p.click('#sign-out');
  await p.waitFor(`location.pathname === '/' || location.pathname === '/index.html'`, 10000);
  check(`${w}px: Salir inside the menu signs out`, true);
  first = false;
}
const d = await browser.newPage({ width: 1366, height: 900 });
await d.goto(`${BASE}/manifest.webmanifest`);
await d.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: t.nutritionist.token, record: t.nutritionist.record, collection: 'nutritionists' }))})`);
await d.goto(`${BASE}/home.html`);
await d.waitFor(`document.querySelector('.plato-menu-btn')`, 15000);
const wd = await d.eval(`({ btn: getComputedStyle(document.querySelector('.plato-menu-btn')).display, row: getComputedStyle(document.getElementById('nav-menu')).display, h: document.querySelector('.plato-top').getBoundingClientRect().height })`);
check('desktop 1366: no Menú button, links in the bar as before', wd.btn === 'none' && wd.row === 'flex' && wd.h < 70, JSON.stringify(wd));
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
