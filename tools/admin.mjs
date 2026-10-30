// tools/admin.mjs — test helper: nutritionist accounts are made by the admin (public sign-up is closed).
// Creates a throwaway superuser inside the THROWAWAY test container, then the nutritionist through it.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

let suToken = null;
async function superuser(BASE, box) {
  if (suToken) return suToken;
  const email = 'zz-admin@test.local', pw = `Zz${randomBytes(12).toString('hex')}`;
  execFileSync('docker', ['exec', box, '/pb/pocketbase', 'superuser', 'upsert', email, pw]);
  const r = await fetch(`${BASE}/api/collections/_superusers/auth-with-password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ identity: email, password: pw }) });
  if (!r.ok) throw new Error(`superuser sign-in: ${r.status}`);
  suToken = (await r.json()).token;
  return suToken;
}

export async function createNutritionist(BASE, { name, clinic_name = '', email, password }, box = process.env.PB_CONTAINER || 'pb-check') {
  const token = await superuser(BASE, box);
  const r = await fetch(`${BASE}/api/collections/nutritionists/records`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: token },
    body: JSON.stringify({ name, clinic_name, email, password, passwordConfirm: password }) });
  if (!r.ok) throw new Error(`create nutritionist: ${r.status} ${await r.text()}`);
  return r.json();
}
