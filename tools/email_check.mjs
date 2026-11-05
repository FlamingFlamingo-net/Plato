// Emails ignore capitals (spec "Fix: Emails ignore capitals").
// Usage: node tools/email_check.mjs <base-url> <demo-tokens.json> <out-dir>   (seeded throwaway server; PB_CONTAINER)
// The one-time cleanup migration is checked separately by tools/email_migration_check.sh.
import { createNutritionist } from './admin.mjs';
import { readFileSync } from 'node:fs';

const [BASE, TOKENS] = process.argv.slice(2);
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const step = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, e.message.split('\n')[0]); } };
async function api(path, { method = 'GET', body, token = t.nutritionist.token } = {}) {
  const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await r.json(); } catch {}
  return { status: r.status, json };
}
const login = (coll, identity, password) => api(`/api/collections/${coll}/auth-with-password`, { method: 'POST', token: null, body: { identity, password } });
const PW = 'CasoPrueba12345';

await step('E1', async () => {
  const r = await createNutritionist(BASE, { name: 'Caso', email: '  Zz.Caso@Example.com ', password: PW });
  check('E1 an account saved as "Zz.Caso@Example.com" (admin/API) is stored lowercase', r.email === 'zz.caso@example.com', r.email);
});

await step('E2', async () => {
  for (const id of ['Zz.Caso@Example.com', 'zz.caso@example.com', 'ZZ.CASO@EXAMPLE.COM', ' zz.caso@example.com ']) {
    const r = await login('nutritionists', id, PW);
    check(`E2 sign-in typed as "${id}" works (server side, any screen version)`, r.status === 200 && r.json?.record?.email === 'zz.caso@example.com', r.status);
  }
  const bad = await login('nutritionists', 'ZZ.CASO@EXAMPLE.COM', 'wrong-password-123');
  check('E2 a wrong password still fails', bad.status === 400, bad.status);
  const none = await login('nutritionists', 'Nadie@Example.com', PW);
  check('E2 an unknown email still fails', none.status === 400, none.status);
  const cross = await login('patients', 'ZZ.CASO@EXAMPLE.COM', PW);
  check('E2 a nutritionist email does not sign in as a patient', cross.status === 400, cross.status);
});

await step('E3', async () => {
  const dup = await createNutritionist(BASE, { name: 'Caso2', email: 'zz.caso@example.com', password: PW }).then(() => 'created', (e) => e.message);
  const dup2 = await createNutritionist(BASE, { name: 'Caso3', email: 'ZZ.Caso@example.COM', password: PW }).then(() => 'created', (e) => e.message);
  check('E3 a second account differing only by capitals is refused', dup !== 'created' && dup2 !== 'created', `${dup} | ${dup2}`);
});

await step('E4', async () => {
  const inv = await api('/api/plato/invite', { method: 'POST', body: { patient: t.carlos_id } });
  const j = await api('/api/plato/join', { method: 'POST', token: null, body: { token: inv.json.token, email: 'Carlos.X@Example.com', password: PW } });
  check('E4 a patient joining as "Carlos.X@Example.com" is stored lowercase', j.status === 200 && j.json.record.email === 'carlos.x@example.com', `${j.status} ${j.json?.record?.email}`);
  const r = await login('patients', 'CARLOS.X@example.com', PW);
  check('E4 …and signs in with any capitals', r.status === 200, r.status);
});

await step('E5', async () => {
  const su = await (await import('./admin.mjs')).superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
  const n = (await api(`/api/collections/nutritionists/records?filter=${encodeURIComponent('email = "zz.caso@example.com"')}`, { token: su })).json.items[0];
  const u = await api(`/api/collections/nutritionists/records/${n.id}`, { method: 'PATCH', token: su, body: { email: 'ZZ.Caso.Nuevo@Example.com' } });
  check('E5 changing an email in the admin panel stores it lowercase too', u.status === 200 && u.json.email === 'zz.caso.nuevo@example.com', `${u.status} ${u.json?.email}`);
});

const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
