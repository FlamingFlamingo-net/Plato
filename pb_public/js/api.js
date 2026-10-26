// api.js — the only module that talks to PocketBase (same origin). Plain fetch, no SDK.
//
// Contract (see pb_migrations/1760914800_plato_v1.js and pb_hooks/plato.pb.js):
//   auth collections: nutritionists (public sign-up), patients (created by their nutritionist; join via invite link)
//   base collections: measurements, diets (one per patient, meals JSON), meal_logs (protected photo), patient_notes
//   hooks: POST /api/plato/invite {patient} · GET /api/plato/invite/{token} · POST /api/plato/join {token,email,password}
//          POST /api/plato/patients/{id}/close · POST /api/plato/patients/{id}/reopen (nutritionist; archive / un-archive)
//   PocketBase answers 404 (not 403) when a rule refuses a view/update/delete.

const KEY = 'plato.auth';

export const SLOTS = [
  ['breakfast', 'Desayuno'],
  ['snack_am', 'Colación de la mañana'],
  ['lunch', 'Comida'],
  ['snack_pm', 'Colación de la tarde'],
  ['dinner', 'Cena'],
];
export const SLOT_LABEL = Object.fromEntries(SLOTS);
export const WEEKDAYS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export class ApiError extends Error {
  constructor(status, message, data = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const OFFLINE_MSG = 'Sin conexión. Inténtalo de nuevo cuando tengas internet.';

const FIELD_MSG = {
  validation_required: 'Este dato es obligatorio.',
  validation_not_unique: 'Ya existe.',
  validation_invalid_email: 'Escribe un correo válido.',
  validation_min_text_constraint: 'Es demasiado corto.',
  validation_length_out_of_range: 'La longitud no es válida.',
  validation_min_number_constraint: 'El número es demasiado bajo.',
  validation_max_number_constraint: 'El número es demasiado alto.',
  validation_file_size_limit: 'La foto pesa demasiado (máx. 5 MB).',
  validation_invalid_mime_type: 'Ese archivo no es una foto válida.',
  validation_values_mismatch: 'Las contraseñas no coinciden.',
};

function friendly(status, body) {
  if (status === 0) return OFFLINE_MSG;
  const fields = body?.data && typeof body.data === 'object' ? body.data : {};
  const first = Object.values(fields)[0];
  if (first?.code && FIELD_MSG[first.code]) return FIELD_MSG[first.code];
  if (status === 404) return 'No encontrado.';
  if (status === 429) return 'Demasiados intentos. Espera un minuto e inténtalo otra vez.';
  if (status === 401 || status === 403) return 'Tu sesión terminó. Vuelve a entrar.';
  if (status === 400 && body?.message && !/^Failed|^Something/i.test(body.message)) {
    // Hook messages are already Spanish; PocketBase's generic ones are not.
    if (/[áéíóúñ¿¡]|enlace|correo|contraseña/i.test(body.message)) return body.message;
    if (/authenticate/i.test(body.message)) return 'Correo o contraseña incorrectos.';
  }
  if (status >= 500) return 'El servidor tuvo un problema. Inténtalo otra vez.';
  return 'No se pudo guardar. Revisa los datos.';
}

// ---- session ----
export function session() {
  try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; }
}
function saveSession(token, record) {
  localStorage.setItem(KEY, JSON.stringify({ token, record, collection: record.collectionName }));
}
export function signOut() {
  localStorage.removeItem(KEY);
  location.href = '/';
}

// ---- low level ----
export async function request(path, { method = 'GET', body, form, auth = true } = {}) {
  const headers = {};
  const s = session();
  if (auth && s?.token) headers.Authorization = s.token;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError(0, OFFLINE_MSG);
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, friendly(res.status, data), data?.data || {});
  return data;
}

const enc = encodeURIComponent;
const col = (name) => `/api/collections/${name}/records`;

export function list(name, { filter = '', sort = '', perPage = 200, fields = '' } = {}) {
  const q = new URLSearchParams({ perPage: String(perPage), skipTotal: '1' });
  if (filter) q.set('filter', filter);
  if (sort) q.set('sort', sort);
  if (fields) q.set('fields', fields);
  return request(`${col(name)}?${q}`).then((r) => r.items);
}
export const view = (name, id) => request(`${col(name)}/${enc(id)}`);
export const create = (name, body) => request(col(name), { method: 'POST', ...(body instanceof FormData ? { form: body } : { body }) });
export const update = (name, id, body) => request(`${col(name)}/${enc(id)}`, { method: 'PATCH', body });
export const remove = (name, id) => request(`${col(name)}/${enc(id)}`, { method: 'DELETE' });

// Filters: quote values safely for PocketBase's filter syntax.
export const q = (v) => `'${String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// ---- auth ----
export async function signIn(collection, email, password) {
  const r = await request(`/api/collections/${collection}/auth-with-password`, {
    method: 'POST', auth: false, body: { identity: email, password },
  });
  saveSession(r.token, r.record);
  return r.record;
}

export async function signUpNutritionist({ name, clinic_name, email, password }) {
  await request(col('nutritionists'), {
    method: 'POST', auth: false,
    body: { name, clinic_name, email, password, passwordConfirm: password },
  });
  return signIn('nutritionists', email, password);
}

// Validates the stored token and refreshes the record. Offline: keep the stored session.
export async function refresh() {
  const s = session();
  if (!s) return null;
  try {
    const r = await request(`/api/collections/${s.collection}/auth-refresh`, { method: 'POST' });
    saveSession(r.token, r.record);
    return r.record;
  } catch (e) {
    if (e.status === 401 || e.status === 403 || e.status === 404) { localStorage.removeItem(KEY); return null; }
    return s.record; // offline or server error
  }
}

// Page guard: returns the signed-in record of the wanted role, or sends the visitor to the start page.
export async function requireRole(collection) {
  const s = session();
  if (!s || s.collection !== collection) { location.replace('/'); return new Promise(() => {}); }
  const rec = await refresh();
  // A patient whose session stopped working (account closed or access reset) gets a short explanation.
  if (!rec) { location.replace(collection === 'patients' ? '/?ended=1' : '/'); return new Promise(() => {}); }
  return rec;
}

// ---- patients ----
export function createPatient({ name, sex, birth_date, height_cm }) {
  const s = session();
  const pw = randomSecret(); // never shown; the patient sets their own password through the invite link
  const body = { name, sex, nutritionist: s.record.id, password: pw, passwordConfirm: pw };
  if (birth_date) body.birth_date = `${birth_date} 12:00:00.000Z`;
  if (height_cm) body.height_cm = Number(height_cm);
  return create('patients', body);
}

export const newInvite = (patient) => request('/api/plato/invite', { method: 'POST', body: { patient } });
export const closeAccount = (id) => request(`/api/plato/patients/${enc(id)}/close`, { method: 'POST', body: {} });
export const reopenAccount = (id) => request(`/api/plato/patients/${enc(id)}/reopen`, { method: 'POST', body: {} });
export const checkInvite = (token) => request(`/api/plato/invite/${enc(token)}`, { auth: false });
export async function join(token, email, password) {
  const r = await request('/api/plato/join', { method: 'POST', auth: false, body: { token, email, password } });
  saveSession(r.token, r.record);
  return r.record;
}

// ---- files (meal and progress photos are protected) ----
let fileToken = null;
let fileTokenAt = 0;
export async function photoUrl(rec, thumb = '400x400') {
  if (!fileToken || Date.now() - fileTokenAt > 90_000) {
    fileToken = (await request('/api/files/token', { method: 'POST' })).token;
    fileTokenAt = Date.now();
  }
  const t = thumb ? `&thumb=${thumb}` : '';
  return `/api/files/${enc(rec.collectionName || 'meal_logs')}/${enc(rec.id)}/${enc(rec.photo)}?token=${enc(fileToken)}${t}`;
}

// ---- helpers ----
function randomSecret() {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function localDate(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
// 1 = Monday … 7 = Sunday
export const isoWeekday = (d = new Date()) => ((d.getDay() + 6) % 7) + 1;
// PocketBase date "2026-10-19 12:00:00.000Z" → "2026-10-19"
export const dateOnly = (pbDate) => (pbDate || '').slice(0, 10);
