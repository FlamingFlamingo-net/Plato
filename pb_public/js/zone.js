// zone.js — clinic time zone (spec "Feature: Appointment reminders + clinic time zone", slice 1).
// Appointments are exact moments (UTC). Nutritionist screens show and enter them in the clinic's zone; patient
// screens use the phone's own zone and add the clinic time when it gives another hour. Built on Intl only.

export const deviceZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } };
export const validZone = (z) => { if (!z) return false; try { new Intl.DateTimeFormat('en', { timeZone: z }); return true; } catch { return false; } };

let display;      // undefined = this device's zone (patients); the clinic zone on nutritionist screens
let clinic = '';
export function useClinicZone(z) { clinic = validZone(z) ? z : ''; display = clinic || undefined; }   // nutritionist screens
export function setClinicZone(z) { clinic = validZone(z) ? z : ''; }                                   // patient screens
export const displayZone = () => display;
export const clinicZone = () => clinic;

const cache = new Map();
const fmt = (zone, opts) => {
  const key = `${zone || ''}|${JSON.stringify(opts)}`;
  if (!cache.has(key)) cache.set(key, new Intl.DateTimeFormat('es-MX', zone ? { ...opts, timeZone: zone } : opts));
  return cache.get(key);
};
export const timeIn = (date, zone) => fmt(zone, { hour: 'numeric', minute: '2-digit' }).format(date);
export const weekdayIn = (date, zone) => fmt(zone, { weekday: 'long' }).format(date);
export const dayLabelIn = (date, zone) => { const s = fmt(zone, { weekday: 'long', day: 'numeric', month: 'long' }).format(date); return s[0].toUpperCase() + s.slice(1); };

// Wall-clock parts of a moment in a zone.
export function partsIn(date, zone) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: zone || deviceZone(), hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return { ymd: `${p.year}-${p.month}-${p.day}`, hhmm: `${p.hour}:${p.minute}`, y: +p.year, mo: +p.month, d: +p.day, H: +p.hour, M: +p.minute, S: +p.second };
}
export const ymdIn = (date, zone) => partsIn(date, zone).ymd;
export const hhmmIn = (date, zone) => partsIn(date, zone).hhmm;

// Minutes the zone is ahead of UTC at that moment (Chihuahua: -360).
export function offsetMin(date, zone) {
  const p = partsIn(date, zone);
  return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.H, p.M, p.S) - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

// "2026-11-05" + "16:00" read as a wall clock in `zone` -> the exact moment (Date).
export function zonedToDate(ymd, hhmm, zone) {
  if (!zone) return new Date(`${ymd}T${hhmm}:00`);
  const [y, mo, d] = ymd.split('-').map(Number), [H, M] = hhmm.split(':').map(Number);
  const wall = Date.UTC(y, mo - 1, d, H, M);
  const t1 = wall - offsetMin(new Date(wall), zone) * 60000;
  const t2 = wall - offsetMin(new Date(t1), zone) * 60000;      // second pass settles clock-change days
  const hit = [t2, t1].find((t) => hhmmIn(new Date(t), zone) === hhmm && ymdIn(new Date(t), zone) === ymd);
  return new Date(hit ?? Math.max(t1, t2));                     // a time skipped by a clock change: just after the jump
}

// "America/Ciudad_Juarez" -> "Ciudad Juarez"; offset label "UTC−6".
const NAMES = { Mexico_City: 'Ciudad de México', Ciudad_Juarez: 'Ciudad Juárez', Mazatlan: 'Mazatlán', Merida: 'Mérida', Cancun: 'Cancún', Bahia_Banderas: 'Bahía de Banderas' };
export const zoneCity = (z) => { const c = String(z || '').split('/').pop(); return NAMES[c] || c.replace(/_/g, ' '); };
export function utcLabel(zone, at = new Date()) {
  const m = offsetMin(at, zone), s = m < 0 ? '−' : '+', a = Math.abs(m);
  return `UTC${s}${Math.floor(a / 60)}${a % 60 ? `:${String(a % 60).padStart(2, '0')}` : ''}`;
}

// Mexico's zones first, then every other zone the browser knows.
export const MEXICO_ZONES = ['America/Mexico_City', 'America/Chihuahua', 'America/Ciudad_Juarez', 'America/Ojinaga', 'America/Hermosillo',
  'America/Mazatlan', 'America/Tijuana', 'America/Monterrey', 'America/Matamoros', 'America/Merida', 'America/Cancun', 'America/Bahia_Banderas'];
export function allZones() {
  let all = [];
  try { all = Intl.supportedValuesOf('timeZone'); } catch { all = []; }
  return [...MEXICO_ZONES.filter(validZone), ...all.filter((z) => !MEXICO_ZONES.includes(z))];
}
