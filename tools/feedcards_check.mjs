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
// one seen photo card (as the nutritionist), so a "Vista" mark is on screen
{ const N = t.nutritionist.token;
  const r = await (await fetch(`${BASE}/api/collections/meal_logs/records?perPage=1&filter=${encodeURIComponent(`patient = '${ANA}' && photo != ''`)}`, { headers: { Authorization: N } })).json();
  const s = await fetch(`${BASE}/api/collections/meal_logs/records/${r.items[0].id}`, { method: 'PATCH', headers: { Authorization: N, 'Content-Type': 'application/json' }, body: JSON.stringify({ seen_at: new Date().toISOString().replace('T', ' ') }) });
  made.push(s.status); }
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
    const g = await p.eval(`(() => [...document.querySelectorAll('#cards > li.plato-log-card')].map((c) => {
      const cr = c.getBoundingClientRect(), hd = c.querySelector('.plato-row--between'), name = hd.querySelector('.plato-home-person').getBoundingClientRect(), when = hd.querySelector('.plato-log-when').getBoundingClientRect();
      const row = c.querySelector('.plato-log-actions'), btns = row ? [...row.querySelectorAll('button')].map((b) => b.getBoundingClientRect()) : [];
      const left = btns.length ? Math.min(...btns.map((b) => b.left)) : 0, right = btns.length ? Math.max(...btns.map((b) => b.right)) : 0;
      return { kind: c.className, top: Math.round(cr.top), oneLine: Math.abs((name.top + name.bottom) / 2 - (when.top + when.bottom) / 2) < 6 && hd.getBoundingClientRect().height < 40,
        badge: [...c.querySelectorAll('.badge')].some((b) => b.textContent.includes('Vista')), mark: !!hd.querySelector('.plato-seen-mark'),
        btnBottom: btns.length ? Math.round(Math.max(...btns.map((b) => b.bottom))) : null, centred: !btns.length || Math.abs((left + right) / 2 - (cr.left + cr.right) / 2) <= 2,
        bottomGap: btns.length ? Math.round(cr.bottom - Math.max(...btns.map((b) => b.bottom))) : null }; }))()`);
    check(`G1 ${w}px: name and time always share one header row`, g.every((x) => x.oneLine), JSON.stringify(g.filter((x) => !x.oneLine)));
    const av = await p.eval(`[...document.querySelectorAll('#cards .plato-home-person .plato-avatar')].map((e) => Math.round(e.getBoundingClientRect().width))`);
    const nm = await p.eval(`[...document.querySelectorAll('#cards .plato-home-person strong')].map((e) => Math.round(e.getBoundingClientRect().width))`);
    check(`G1 ${w}px: avatars keep their full size and every name keeps room for at least a few letters (≥ 40 px)`, new Set(av).size === 1 && nm.every((x) => x >= 40), JSON.stringify({ av, nm }));
    check(`G2 ${w}px: no "Vista" badge row in any card; a seen card shows a small check next to its time`, !g.some((x) => x.badge) && g.some((x) => x.mark), JSON.stringify(g.map((x) => [x.badge, x.mark])));
    check(`G3 ${w}px: the buttons are centred in their card`, g.every((x) => x.centred), JSON.stringify(g.filter((x) => !x.centred).map((x) => x.kind)));
    const rows = {}; for (const x of g) if (x.btnBottom != null) (rows[x.top] ||= []).push(x.btnBottom);
    check(`G4 ${w}px: cards side by side have their buttons on the same line, at the same distance from the bottom`, Object.values(rows).every((b) => Math.max(...b) - Math.min(...b) <= 1) && new Set(g.filter((x) => x.bottomGap != null).map((x) => x.bottomGap)).size === 1, JSON.stringify({ rows, gaps: g.map((x) => x.bottomGap) }));
    const an = await p.eval(`(() => [...document.querySelectorAll('#cards > li.plato-log-card')].map((c) => {
      const cr = c.getBoundingClientRect(), off = (sel) => { const e = c.querySelector(sel); return e ? Math.round(e.getBoundingClientRect().top - cr.top) : null; };
      const pic = c.querySelector(':scope > .plato-photo-btn');
      return { photo: !!pic, first: c.firstElementChild.classList.contains('plato-row--between'), head: off(':scope > .plato-row--between'), pic: pic ? Math.round(pic.getBoundingClientRect().height) : null,
        title: off('.plato-log-title'), btns: [...c.querySelectorAll('.plato-log-actions button')].map((b) => b.dataset.variant + '/' + b.dataset.size + '/' + Math.round(b.getBoundingClientRect().height) + '/' + Math.round(b.getBoundingClientRect().width)) }; }))()`);
    const same = (xs) => new Set(xs).size === 1;
    check(`A1 ${w}px: every card starts with the same header (name · time), at the same place`, an.every((x) => x.first) && same(an.map((x) => x.head)), JSON.stringify(an.map((x) => [x.first, x.head])));
    check(`A2 ${w}px: photo cards: same photo height, title at the same height; text cards: title at the same height`, same(an.filter((x) => x.photo).map((x) => x.pic)) && same(an.filter((x) => x.photo).map((x) => x.title)) && same(an.filter((x) => !x.photo).map((x) => x.title)),
      JSON.stringify(an.map((x) => [x.photo, x.pic, x.title])));
    check(`A3 ${w}px: every button in every card has the same style, height and width`, same(an.flatMap((x) => x.btns)) && an.flatMap((x) => x.btns).length >= 6, JSON.stringify(an.map((x) => x.btns)));
    const ate = await p.eval(`(() => { const e = document.querySelector('#cards .plato-ate'); const probe = document.createElement('span'); probe.style.color = 'var(--primary)'; document.body.append(probe); const primary = getComputedStyle(probe).color; probe.remove();
      return { icon: document.querySelectorAll('#cards .plato-activity-icon').length, text: e?.textContent, green: !!e && getComputedStyle(e).color === primary }; })()`);
    const last = await p.eval(`[...document.querySelectorAll('#cards .plato-log-actions')].map((r) => { const b = [...r.querySelectorAll('button')]; return b.length ? b[b.length - 1].textContent : ''; })`);
    check(`A5 ${w}px: where a card has "Marcar vista", it is always the bottom button`, last.filter((x) => x.includes('Marcar vista')).length >= 3 && last.every((x) => !x || x.includes('Marcar vista') || !last.some(Boolean) || true) && (await p.eval(`[...document.querySelectorAll('#cards .plato-log-actions')].every((r) => { const b = [...r.querySelectorAll('button')]; const i = b.findIndex((x) => x.textContent.includes('Marcar vista')); return i < 0 || i === b.length - 1; })`)), JSON.stringify(last));
    check(`A4 ${w}px: no round icon badges in the cards; "lo comió" is plain green text`, ate.icon === 0 && ate.text === 'lo comió' && ate.green, JSON.stringify(ate));
    check(`F ${w}px: no sideways scroll`, await p.eval(`document.documentElement.scrollWidth <= innerWidth && innerWidth <= ${w} + 1`));
    await p.screenshot(`${OUT}/feed-${w}.png`, { full: true });
  });
}
const ok = results.filter(Boolean).length; console.log(`${ok}/${results.length} passed`);
await browser.close(); process.exit(ok === results.length ? 0 : 1);
