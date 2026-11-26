// Home feed cards are all the same size (owner comments on home.html, 2026-11-25: a photo card "too big", a check card "too small").
// Usage: node tools/feedcards_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PHOTO = a jpg)
import { launch } from './cdp.mjs';
import { mkdirSync, readFileSync } from 'node:fs';

const [BASE, TOKENS, OUT] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (n, ok, d = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'} ${n}${ok ? '' : `  -> ${d}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const A = t.ana.token, ANA = t.ana_id;
const day = (d = 0) => { const x = new Date(); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const post = async (coll, body, file) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(body)) fd.append(k, String(v));
  if (file) fd.append(file.field, new Blob([readFileSync(process.env.PHOTO)], { type: 'image/jpeg' }), 'p.jpg');
  const r = await fetch(`${BASE}/api/collections/${coll}/records`, { method: 'POST', headers: { Authorization: A }, body: fd });
  return r.status;
};
// every kind of card: (seed: 2 meal photos + 1 activity) + a meal check with a long note, a mood, a progress photo
const made = [
  await post('meal_logs', { patient: ANA, date: day(-1), slot: 'dinner', note: 'Cené ligero porque salí tarde del trabajo; me comí la mitad del plato y guardé el resto para mañana, sin postre.' }),
  await post('mood_logs', { patient: ANA, date: day(0), mood: 4, note: 'Bien' }),
  await post('progress_photos', { patient: ANA, date: day(0), pose: 'front' }, { field: 'photo' }),
];
check('setup: a meal check, a mood and a progress photo are added by the patient', made.every((s) => s === 200), made.join(' '));

const browser = await launch({ port: 9376, profileDir: `${OUT}/chrome-profile` });
async function open(w, h, mobile = false) {
  const p = await browser.newPage({ width: w, height: h, mobile });
  await p.goto(`${BASE}/manifest.webmanifest`);
  await p.eval(`localStorage.setItem('plato.auth', ${JSON.stringify(JSON.stringify({ token: t.nutritionist.token, record: t.nutritionist.record, collection: 'nutritionists' }))})`);
  await p.goto(`${BASE}/home.html`);
  await p.waitFor(`document.querySelectorAll('#cards > li.plato-log-card').length >= 6`, 20000);
  await p.eval(`document.querySelectorAll('#cards img').forEach((i) => { i.loading = 'eager'; })`);   // photos below the fold load lazily
  await p.waitFor(`[...document.querySelectorAll('#cards img')].every((i) => i.complete && i.src)`, 20000);
  await sleep(500);
  return p;
}
const measure = (p) => p.eval(`(() => [...document.querySelectorAll('#cards > li.plato-log-card')].map((c) => { const r = c.getBoundingClientRect();
  const act = [...c.querySelectorAll('button, .badge')].map((b) => b.getBoundingClientRect());
  return { kind: c.className.replace('plato-log-card', '').trim() || 'photo', h: Math.round(r.height), w: Math.round(r.width),
    inside: act.every((b) => b.top >= r.top - 0.5 && b.bottom <= r.bottom + 0.5 && b.right <= r.right + 0.5), img: c.querySelector('img') ? Math.round(c.querySelector('img').getBoundingClientRect().height) : null }; }))()`);

for (const [w, h, mobile] of [[1366, 900, false], [390, 844, true], [320, 700, true]]) {
  await step(`F${w}`, async () => {
    const p = await open(w, h, mobile);
    const m = await measure(p);
    const kinds = new Set(m.map((x) => x.kind));
    check(`F ${w}px: every kind of card is on the feed (photo, progress, check, mood, activity)`, ['photo', 'plato-log-card--progress', 'plato-log-card--check', 'plato-log-card--mood', 'plato-log-card--activity'].every((k) => kinds.has(k)), [...kinds].join());
    check(`F ${w}px: all ${m.length} cards have the same height and width`, new Set(m.map((x) => x.h)).size === 1 && Math.max(...m.map((x) => x.w)) - Math.min(...m.map((x) => x.w)) <= 1, JSON.stringify(m.map((x) => [x.kind, x.h, x.w])));
    check(`F ${w}px: every button and "Vista" badge is fully inside its card (nothing cut off); photos keep a real size (≥ 90 px)`, m.every((x) => x.inside) && m.filter((x) => x.img != null).every((x) => x.img >= 90), JSON.stringify(m.filter((x) => !x.inside || (x.img != null && x.img < 90))));
    const pad = await p.eval(`[...document.querySelectorAll('#cards > li.plato-log-card--check, #cards > li.plato-log-card--mood')].map((c) => getComputedStyle(c).paddingLeft)`);
    check(`F ${w}px: the mood card has the same inner spacing as the meal-check card`, pad.length >= 2 && new Set(pad).size === 1 && pad[0] !== '0px', pad.join());
    check(`F ${w}px: no sideways scroll`, await p.eval(`document.documentElement.scrollWidth <= innerWidth && innerWidth <= ${w} + 1`));
    await p.screenshot(`${OUT}/feed-${w}.png`, { full: true });
  });
}
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
