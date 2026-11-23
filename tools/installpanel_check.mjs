// iPhone "Instalar app" panel (spec "Design: iPhone 'Instalar app' panel"): which steps for which browser, open/close/focus, phone widths.
// Usage: node tools/installpanel_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server)
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const IOS = (v) => `Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ${v ? `Version/${v} ` : ''}Mobile/15E148 Safari/604.1`;
const UA = {
  ios26: IOS('26.0'), ios18: IOS('18.5'), unknown: IOS(''),
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0 (iPhone15,2; iOS 18_5; es_MX)',
  chromeios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.6778.73 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};
const browser = await launch({ port: 9373, profileDir: `${OUT}/chrome-profile` });
let errors = [];
async function open(ua, path = '/', w = 390, h = 844, patient = false) {
  const p = await browser.newPage({ width: w, height: h, mobile: w < 800 });
  await p.userAgent(ua);
  if (patient) {
    await p.goto(`${BASE}/manifest.webmanifest`);
    await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: t.ana.token, record: t.ana.record, collection: 'patients' }))})`);
  }
  await p.goto(`${BASE}${path}`);
  await sleep(1500);
  errors = errors.concat(p.errors);
  return p;
}
const steps = (p) => p.eval(`[...document.querySelectorAll('#install-panel .plato-install-steps li')].map((l) => l.textContent.trim())`);
const shown = (p, sel) => p.eval(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; })()`);

await step('I1', async () => {
  const p = await open(UA.ios26);
  check('I1 iPhone Safari 26: the "Instalar app" button shows on the start page (and says it opens a panel)', (await shown(p, '#install-app')) && (await p.eval(`document.getElementById('install-app').getAttribute('aria-haspopup')`)) === 'dialog');
  check('I1 the old one-line hint is gone', await p.eval(`!document.getElementById('install-help')`));
  await p.click('#install-app');
  await p.waitFor(`document.getElementById('install-panel')?.open`);
  const s = await steps(p);
  check('I1 the panel opens with the 4 iOS 26 steps (•••, Compartir, Agregar a inicio / Ver más, Abrir como app web)', s.length === 4 && s[0].includes('•••') && s[1].includes('Compartir') && s[2].includes('Ver más') && s[3].includes('Abrir como app web'), JSON.stringify(s));
  check('I1 title, "Listo" line; no older-steps link, no copy button', (await p.text('#install-title')) === 'Instala AHT Fitness en tu iPhone' && (await shown(p, '.plato-install-done')) && !(await shown(p, '.plato-install-older')) && !(await shown(p, '.plato-install-copy')));
  check('I1 focus goes into the panel (Entendido)', await p.eval(`document.activeElement.id === 'install-ok'`));
  await p.click('#install-ok');
  await p.waitFor(`!document.getElementById('install-panel').open`);
  await sleep(150);
  check('I1 Entendido closes it and the focus returns to the button', await p.eval(`document.activeElement.id === 'install-app'`));
  await p.click('#install-app'); await p.waitFor(`document.getElementById('install-panel').open`);
  await p.press('Escape');
  await sleep(250);
  check('I1 Escape closes it', !(await p.eval(`document.getElementById('install-panel').open`)));
  await p.click('#install-app'); await p.waitFor(`document.getElementById('install-panel').open`);
  await p.eval(`document.getElementById('install-panel').dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
  await sleep(200);
  check('I1 a tap outside the box closes it', !(await p.eval(`document.getElementById('install-panel').open`)));
});

await step('I2', async () => {
  const p = await open(UA.ios18);
  await p.click('#install-app'); await p.waitFor(`document.getElementById('install-panel')?.open`);
  const s = await steps(p);
  check('I2 iPhone Safari 18: the 3 older steps (Compartir in the bottom bar, Agregar a inicio, Agregar)', s.length === 3 && s[0].includes('barra de abajo') && s[1].includes('Agregar a inicio') && s[2].includes('Agregar'), JSON.stringify(s));
  const u = await open(UA.unknown);
  await u.click('#install-app'); await u.waitFor(`document.getElementById('install-panel')?.open`);
  check('I2 version unknown: the iOS 26 steps plus "¿Tu iPhone es más antiguo?"', (await steps(u)).length === 4 && (await shown(u, '.plato-install-older')));
  await u.click('.plato-install-older');
  await sleep(150);
  check('I2 the link switches to the 3 older steps and goes away', (await steps(u)).length === 3 && !(await shown(u, '.plato-install-older')));
});

await step('I3', async () => {
  for (const [k, label] of [['instagram', 'Instagram'], ['chromeios', 'Chrome on iPhone']]) {
    const p = await open(UA[k]);
    await p.click('#install-app'); await p.waitFor(`document.getElementById('install-panel')?.open`);
    const s = await steps(p);
    check(`I3 ${label}: "solo desde Safari" steps with "Copiar enlace", no "Listo" line`, s[0].includes('solo se instala desde Safari') && (await shown(p, '.plato-install-copy')) && !(await shown(p, '.plato-install-done')), JSON.stringify(s));
    await p.click('.plato-install-copy');
    await p.waitFor(`document.querySelector('.plato-install-copied').textContent.length > 0`);
    const msg = await p.text('.plato-install-copied');
    check(`I3 ${label}: "Copiar enlace" gives the app address (${BASE}/)`, msg.endsWith(`${BASE}/`) && /Enlace copiado|Copia este enlace/.test(msg), msg);
  }
});

await step('I4', async () => {
  const a = await open(UA.android);
  check('I4 Android Chrome without the system prompt: no button, no panel (unchanged)', !(await shown(a, '#install-app')) && (await a.eval(`!document.getElementById('install-panel')`)));
  const d = await open('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', '/', 1280, 900);
  check('I4 desktop: no button (unchanged)', !(await shown(d, '#install-app')));
});

await step('I5', async () => {
  const p = await open(UA.ios26, '/today.html', 390, 844, true);
  await p.waitFor(`document.getElementById('install-app')`, 15000);
  check('I5 in the patient app (Hoy, Safari, not installed) the same button opens the panel', (await shown(p, '#install-app')));
  await p.click('#install-app'); await p.waitFor(`document.getElementById('install-panel')?.open`);
  check('I5 iOS 26 steps there too', (await steps(p)).length === 4);
});

await step('P1', async () => {
  for (const w of [320, 360, 390]) {
    for (const k of ['ios26', 'instagram']) {
      const p = await open(UA[k], '/', w, 640);
      await p.click('#install-app'); await p.waitFor(`document.getElementById('install-panel')?.open`);
      if (k === 'instagram') { await p.click('.plato-install-copy'); await sleep(300); }
      const m = await p.eval(`(() => { const vw = innerWidth, vh = innerHeight; const box = document.querySelector('#install-panel > div').getBoundingClientRect();
        const inside = [...document.querySelectorAll('#install-panel *')].every((e) => { const r = e.getBoundingClientRect(); return r.width === 0 || (r.left >= -0.5 && r.right <= vw + 0.5); });
        return { box: box.left >= 0 && box.right <= vw + 0.5 && box.bottom <= vh + 0.5, inside, page: document.documentElement.scrollWidth <= vw && vw <= ${w} + 1, ok: document.getElementById('install-ok').getBoundingClientRect().bottom <= vh }; })()`);
      check(`P1 ${w}px ${k}: the panel fits the screen, nothing sticks out, Entendido reachable`, m.box && m.inside && m.page, JSON.stringify(m));
      if (w === 320) await p.screenshot(`${OUT}/panel-${k}-320.png`);
    }
  }
});

const errs = errors.filter((e) => !/\b40[134]\b|Failed to load resource/.test(e)).join(' | ');
check('no console errors', !errs, errs);
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
