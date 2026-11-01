// Appointment notifications, server side (spec "Feature: Appointment reminders + clinic time zone", slice 2).
// Usage: node tools/push_check.mjs <base-url> <demo-tokens.json>
//   Needs a throwaway server started with -e PLATO_PUSH_TEST_HOST=host.docker.internal:8099 (PB_CONTAINER=its name).
// This script plays the phones AND the push service: a fake service on :8099 receives what the server sends; each
// "phone" decrypts it with its own keys (RFC 8291) and checks the server's VAPID signature (RFC 8292).
import http from 'node:http';
import { createECDH, randomBytes, hkdfSync, createDecipheriv, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { superuser, createNutritionist } from './admin.mjs';

const [BASE, TOKENS] = process.argv.slice(2);
const t = JSON.parse(readFileSync(TOKENS, 'utf8'));
const HOST = 'host.docker.internal:8099';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  -> ${detail}`}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64u = (b) => Buffer.from(b).toString('base64url');

async function api(path, { method = 'GET', body, token } = {}) {
  for (let i = 0; i < 6; i++) {
    const r = await fetch(`${BASE}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.status === 429) { await sleep(8000); continue; }   // the server's /api/plato/ rate limit (20 a minute)
    return { status: r.status, json: await r.json().catch(() => ({})) };
  }
  throw new Error('rate limited');
}

// ---- the fake push service ----
const inbox = [];   // { path, headers, body }
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    inbox.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
    res.writeHead(req.url.startsWith('/sub/gone') ? 410 : 201); res.end();
  });
});
await new Promise((r) => server.listen(8099, '0.0.0.0', r));
const take = (path) => { const got = inbox.filter((m) => m.path === path); for (const m of got) inbox.splice(inbox.indexOf(m), 1); return got; };

// ---- phones ----
function phone(name) {
  const ecdh = createECDH('prime256v1'); ecdh.generateKeys();
  const auth = randomBytes(16);
  return { name, ecdh, auth, sub: { endpoint: `http://${HOST}/sub/${name}`, p256dh: b64u(ecdh.getPublicKey()), auth: b64u(auth) } };
}
function decrypt(p, body) {
  const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20];
  const asPub = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
  const shared = p.ecdh.computeSecret(asPub);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), p.ecdh.getPublicKey(), asPub]);
  const ikm = Buffer.from(hkdfSync('sha256', shared, p.auth, info, 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  if (rs !== 4096 || plain[plain.length - 1] !== 2) throw new Error('bad record');
  return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
}
function vapidOk(headers, serverKey) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(headers.authorization || '');
  if (!m || m[2] !== serverKey) return false;
  const [h, c, s] = m[1].split('.');
  const pt = Buffer.from(serverKey, 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(pt.subarray(1, 33)), y: b64u(pt.subarray(33, 65)) }, format: 'jwk' });
  const claims = JSON.parse(Buffer.from(c, 'base64url'));
  return verify('sha256', Buffer.from(`${h}.${c}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))
    && claims.aud === `http://${HOST}` && /^https:\/\//.test(claims.sub) && claims.exp > Date.now() / 1000;
}

// ---- people ----
const SU = await superuser(BASE, process.env.PB_CONTAINER || 'pb-check');
const N = t.nutritionist.token, NID = t.nutritionist.record.id, ANA = t.ana.token, ANA_ID = t.ana_id, CARLOS_ID = t.carlos_id;
const CARLOS = (await api(`/api/collections/patients/impersonate/${CARLOS_ID}`, { method: 'POST', body: { duration: 3600 }, token: SU })).json.token;
await createNutritionist(BASE, { name: 'Otra Nutrióloga', email: 'otra-push@test.local', password: 'OtraPush12345' });
const OTHER = (await api('/api/collections/nutritionists/auth-with-password', { method: 'POST', body: { identity: 'otra-push@test.local', password: 'OtraPush12345' } })).json.token;
await api(`/api/collections/nutritionists/records/${NID}`, { method: 'PATCH', body: { timezone: 'America/Chihuahua' }, token: N });

const run = (now) => api('/api/plato/push/run', { method: 'POST', body: { now: new Date(now).toISOString() }, token: SU });
const AP = '/api/collections/appointments/records';
const pb = (ms) => new Date(ms).toISOString().replace('T', ' ');
const step5 = (ms) => Math.ceil(ms / 300000) * 300000;

try {
  // P1 — the server's public key
  const key = await api('/api/plato/push/key', { token: ANA });
  const SERVER_KEY = key.json.key;
  check('P1 a patient gets the server\'s public key (65-byte point)', key.status === 200 && Buffer.from(SERVER_KEY || '', 'base64url').length === 65 && Buffer.from(SERVER_KEY, 'base64url')[0] === 4, JSON.stringify(key));
  check('P1 the key stays the same', (await api('/api/plato/push/key', { token: CARLOS })).json.key === SERVER_KEY);
  check('P1 a guest gets no key', (await api('/api/plato/push/key')).status === 401);

  // P2 — subscribing a phone
  const anaPhone = phone('ana'), carlosPhone = phone('carlos'), gonePhone = phone('gone');
  const SUBS = '/api/collections/push_subscriptions/records';
  const s1 = await api(SUBS, { method: 'POST', body: { patient: ANA_ID, ...anaPhone.sub }, token: ANA });
  check('P2 Ana turns notifications on for her phone', s1.status === 200, JSON.stringify(s1.json));
  check('P2 Carlos turns them on too', (await api(SUBS, { method: 'POST', body: { patient: CARLOS_ID, ...carlosPhone.sub }, token: CARLOS })).status === 200);
  const evil = await api(SUBS, { method: 'POST', body: { patient: ANA_ID, ...anaPhone.sub, endpoint: 'https://evil.example.com/collect' }, token: ANA });
  check('P2 an address that is not a push service is refused', evil.status === 400, evil.status);
  const badKeys = await api(SUBS, { method: 'POST', body: { patient: ANA_ID, endpoint: `http://${HOST}/sub/x`, p256dh: 'abc', auth: 'def' }, token: ANA });
  check('P2 malformed keys are refused', badKeys.status === 400, badKeys.status);
  const forOther = await api(SUBS, { method: 'POST', body: { patient: CARLOS_ID, ...phone('x').sub }, token: ANA });
  check('P2 Ana cannot add a phone for Carlos', forOther.status === 400 || forOther.status === 403, forOther.status);
  const byNutri = await api(SUBS, { method: 'POST', body: { patient: ANA_ID, ...phone('y').sub }, token: N });
  check('P2 the nutritionist cannot turn them on for a patient', byNutri.status === 400 || byNutri.status === 403, byNutri.status);
  const again = await api(SUBS, { method: 'POST', body: { patient: ANA_ID, ...anaPhone.sub }, token: ANA });
  const anaList = (await api(SUBS, { token: ANA })).json;
  check('P2 the same phone again replaces its row (no duplicates)', again.status === 200 && anaList.totalItems === 1, `${again.status} ${anaList.totalItems}`);

  // P3 — who can see what
  check('P3 Carlos cannot see Ana\'s phones', (await api(`${SUBS}?filter=${encodeURIComponent(`patient = "${ANA_ID}"`)}`, { token: CARLOS })).json.totalItems === 0);
  check('P3 the nutritionist cannot read phone details', ((await api(SUBS, { token: N })).json.totalItems || 0) === 0);
  const st = await api(`/api/plato/patients/${ANA_ID}/push`, { token: N });
  check('P3 the nutritionist sees "Avisos: activados" for Ana', st.status === 200 && st.json.enabled === true, JSON.stringify(st));
  await api(`${SUBS}/${(await api(SUBS, { token: CARLOS })).json.items[0].id}`, { method: 'DELETE', token: CARLOS });
  check('P3 …and "no activados" after Carlos turns them off', (await api(`/api/plato/patients/${CARLOS_ID}/push`, { token: N })).json.enabled === false);
  check('P3 another nutritionist cannot ask', (await api(`/api/plato/patients/${ANA_ID}/push`, { token: OTHER })).status === 404);
  await api(SUBS, { method: 'POST', body: { patient: CARLOS_ID, ...carlosPhone.sub }, token: CARLOS });

  // P4 — the day-before reminder
  const T = step5(Date.now() + 30 * 3600e3);
  const ap = (await api(AP, { method: 'POST', body: { nutritionist: NID, patient: ANA_ID, starts_at: pb(T), duration_min: 30, type: 'Consulta de mediciones' }, token: N })).json;
  await api('/api/collections/appointment_notes/records', { method: 'POST', body: { appointment: ap.id, nutritionist: NID, text: 'NOTA-PRIVADA-XYZ' }, token: N });
  take('/sub/ana');
  check('P4 a new appointment sends nothing (the patient sees "Nueva" in the app)', inbox.length === 0, inbox.map((m) => m.path).join());
  await run(T - 24 * 3600e3 + 60e3);
  let got = take('/sub/ana');
  const msg = got[0] ? decrypt(anaPhone, got[0].body) : {};
  check('P4 24 h before: one message to Ana\'s phone', got.length === 1, got.length);
  check('P4 her phone decrypts it: kind "day", the exact moment, minutes, type, clinic zone',
    msg.kind === 'day' && msg.id === ap.id && msg.at === new Date(T).toISOString() && msg.minutes === 30 && msg.type === 'Consulta de mediciones' && msg.zone === 'America/Chihuahua', JSON.stringify(msg));
  check('P4 signed by the server (VAPID) for that push service', got[0] && vapidOk(got[0].headers, SERVER_KEY));
  check('P4 no private note, no names in the message', !JSON.stringify(msg).includes('NOTA') && !JSON.stringify(msg).includes('Ana'));
  check('P4 TTL = until the appointment', got[0] && Math.abs(Number(got[0].headers.ttl) - (24 * 3600 - 60)) <= 5, got[0]?.headers.ttl);
  await run(T - 24 * 3600e3 + 120e3);
  check('P4 only once', take('/sub/ana').length === 0);

  // P5 — one hour before
  await run(T - 59 * 60e3);
  got = take('/sub/ana');
  check('P5 1 hour before: kind "hour", urgency high', got.length === 1 && decrypt(anaPhone, got[0].body).kind === 'hour' && got[0].headers.urgency === 'high', got.length);
  await run(T - 50 * 60e3);
  check('P5 only once', take('/sub/ana').length === 0);

  // P6 — moved: notice now, reminders follow the new time
  const T2 = T + 2 * 3600e3;
  await api(`${AP}/${ap.id}`, { method: 'PATCH', body: { starts_at: pb(T2) }, token: N });
  await sleep(300);
  got = take('/sub/ana');
  const mv = got[0] ? decrypt(anaPhone, got[0].body) : {};
  check('P6 moving it sends "moved" at once with the new time', got.length === 1 && mv.kind === 'moved' && mv.at === new Date(T2).toISOString(), JSON.stringify(mv));
  await run(T2 - 24 * 3600e3 + 60e3);
  got = take('/sub/ana');
  check('P6 the day-before reminder comes again for the new time', got.length === 1 && decrypt(anaPhone, got[0].body).kind === 'day', got.length);
  await api(`${AP}/${ap.id}`, { method: 'PATCH', body: { type: 'Consulta de entrenamiento' }, token: N });
  await sleep(300);
  check('P6 changing only the type sends nothing', take('/sub/ana').length === 0);

  // P7 — cancelled
  await api(`${AP}/${ap.id}`, { method: 'PATCH', body: { cancelled_at: pb(Date.now()) }, token: N });
  await sleep(300);
  got = take('/sub/ana');
  check('P7 cancelling sends "cancelled"', got.length === 1 && decrypt(anaPhone, got[0].body).kind === 'cancelled', got.length);
  await run(T2 - 59 * 60e3);
  check('P7 no reminders after a cancellation', take('/sub/ana').length === 0);

  // P8 — made less than 24 h ahead: no day-before reminder, but the 1-hour one
  const T3 = step5(Date.now() + 3 * 3600e3);
  const late = (await api(AP, { method: 'POST', body: { nutritionist: NID, patient: ANA_ID, starts_at: pb(T3), duration_min: 60, type: 'Consulta nutricional inicial' }, token: N })).json;
  const r8 = await run(Date.now());
  check('P8 made 3 h ahead: no "mañana" reminder', take('/sub/ana').length === 0 && r8.json.ran.some((x) => x.id === late.id && x.kind === 'day' && x.skipped), JSON.stringify(r8.json));
  await run(T3 - 59 * 60e3);
  got = take('/sub/ana');
  check('P8 …the 1-hour reminder still comes', got.length === 1 && decrypt(anaPhone, got[0].body).kind === 'hour', got.length);

  // P9 — nothing ever went to Carlos
  check('P9 Carlos\'s phone got none of Ana\'s messages', take('/sub/carlos').length === 0);

  // P10 — a phone the push service says is gone is removed
  await api(SUBS, { method: 'POST', body: { patient: ANA_ID, ...gonePhone.sub }, token: ANA });
  const T4 = step5(Date.now() + 26 * 3600e3);
  await api(AP, { method: 'POST', body: { nutritionist: NID, patient: ANA_ID, starts_at: pb(T4), duration_min: 30, type: 'Consulta de mediciones' }, token: N });
  await run(T4 - 24 * 3600e3 + 60e3);
  const left = (await api(SUBS, { token: ANA })).json.items.map((x) => x.endpoint);
  check('P10 a gone phone (410) is removed; the good one stays', take('/sub/gone').length === 1 && take('/sub/ana').length === 1 && left.length === 1 && left[0].endsWith('/sub/ana'), left.join());

  // P11 — closing an account removes its phones
  await api(`/api/plato/patients/${CARLOS_ID}/close`, { method: 'POST', body: {}, token: N });
  const cl = await api(`/api/collections/push_subscriptions/records?filter=${encodeURIComponent(`patient = "${CARLOS_ID}"`)}`, { token: SU });
  check('P11 closing Carlos\'s account removes his phones', cl.json.totalItems === 0, JSON.stringify(cl.json).slice(0, 120));

  // P12 — the job route is for superusers only
  const p12 = [await api('/api/plato/push/run', { method: 'POST', body: {}, token: N }), await api('/api/plato/push/run', { method: 'POST', body: {}, token: ANA }), await api('/api/plato/push/run', { method: 'POST', body: {} })];
  check('P12 nobody but a superuser can run the job', p12.every((r) => r.status === 403 || r.status === 401), p12.map((r) => r.status).join());
  check('P12 the server keys are not readable', (await api('/api/collections/push_keys/records', { token: N })).status === 403
    && (await api('/api/collections/push_keys/records', { token: ANA })).status === 403);
  check('P12 nobody sets the reminder fields by hand', (await api(AP, { method: 'POST', body: { nutritionist: NID, patient: ANA_ID, starts_at: pb(T4 + 3600e3), duration_min: 30, type: 'X', reminded_day_at: pb(Date.now()) }, token: N })).status === 400);
} catch (e) {
  check('push checks ran to the end', false, e.stack);
} finally {
  server.close();
}
const passed = results.filter((r) => r.ok).length;
console.log(`${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
