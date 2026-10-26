// activity.js — physical activity: labels, which details apply, and the one-line summary every screen shows.
// Speed is never typed: it comes from distance and minutes.
import { num } from './ui.js';

export const KINDS = [
  ['walk', 'Caminar'], ['run', 'Correr'], ['bike', 'Bicicleta'], ['swim', 'Nadar'],
  ['gym', 'Gimnasio / pesas'], ['yoga', 'Yoga / estiramiento'], ['dance', 'Baile'],
  ['team', 'Deporte en equipo'], ['other', 'Otra'],
];
export const KIND_LABEL = Object.fromEntries(KINDS);
export const INTENSITY = [['light', 'Ligera'], ['moderate', 'Moderada'], ['vigorous', 'Intensa']];
export const INTENSITY_LABEL = Object.fromEntries(INTENSITY);
export const TERRAIN = [['flat', 'Plano'], ['hills', 'Subidas'], ['mixed', 'Mixto'], ['indoor', 'Caminadora / bici fija']];
export const TERRAIN_LABEL = Object.fromEntries(TERRAIN);

export const hasTerrain = (kind) => ['walk', 'run', 'bike'].includes(kind);
export const hasDistance = (kind) => ['walk', 'run', 'bike', 'swim'].includes(kind);
export const hasPace = (kind) => ['walk', 'run'].includes(kind);

export const activityName = (a) => (a.kind === 'other' ? a.kind_other || 'Otra' : KIND_LABEL[a.kind] || a.kind);

// km/h and, for walking and running, minutes per km. Null when there is no distance.
export function speedOf(kind, minutes, km) {
  if (!(km > 0 && minutes > 0)) return null;
  const kmh = km / (minutes / 60);
  const pace = minutes / km;
  const mm = Math.floor(pace);
  const ss = Math.round((pace - mm) * 60);
  const [m2, s2] = ss === 60 ? [mm + 1, 0] : [mm, ss];
  return {
    kmh: `${num(kmh)} km/h`,
    pace: hasPace(kind) ? `${m2}:${String(s2).padStart(2, '0')} min/km` : null,
  };
}

// "Correr · 30 min · 5 km · 10 km/h · 6:00 min/km · plano · intensa"
export function activitySummary(a) {
  const sp = hasDistance(a.kind) ? speedOf(a.kind, a.minutes, a.distance_km) : null;
  return [
    activityName(a),
    `${a.minutes} min`,
    hasDistance(a.kind) && a.distance_km > 0 ? `${num(a.distance_km, 2)} km` : null,
    sp?.kmh, sp?.pace,
    hasTerrain(a.kind) && a.terrain ? TERRAIN_LABEL[a.terrain].toLowerCase() : null,
    a.intensity ? INTENSITY_LABEL[a.intensity].toLowerCase() : null,
  ].filter(Boolean).join(' · ');
}
