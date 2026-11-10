// plan-math.js — the totals of a diet's dishes, the same arithmetic as pb_hooks/plan_lib.js (the server stores the official numbers;
// the editor shows them live and a test proves they agree). Spec "Feature: Diets using dishes, slice (c)".
import { KEYS } from './dish-math.js';
import { num } from './ui.js';
export { KEYS };

export const MIN_SERVINGS = 0.25, MAX_SERVINGS = 20, MAX_PER_SLOT = 8;
export const validServings = (s) => Number.isFinite(s) && s >= MIN_SERVINGS && s <= MAX_SERVINGS && Math.abs(s * 4 - Math.round(s * 4)) < 1e-9;
export const fmtServings = (s) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(s);
export const lineText = (l) => `${fmtServings(l.servings)} × ${l.name}`;
export const slotLines = (plan, d, k) => { const v = plan?.[d]?.[k]; return Array.isArray(v) ? v : []; };
// The server's numbers (plan_calc) exist on a patient's screen only when the nutritionist switched them on.
export const slotNumbers = (calc, d, k) => calc?.days?.[d]?.slots?.[k] || null;
export const dayNumbers = (calc, d) => calc?.days?.[d] || null;
export const kcalText = (s) => `${num(s.kcal, 0)} kcal${s.free_text ? ' + texto libre' : ''}`;
export const macrosText = (t) => `P ${num(t.protein_g)} g · G ${num(t.fat_g)} g · C ${num(t.carbs_g)} g`;
const text = (meals, d, k) => String(meals?.[d]?.[k] || '').trim();

// plan: { day: { slot: [{dish, servings}] } }; snap: { dishId: { per_serving } }; shown: the slot keys that count.
// → { slots: { key: {kcal…, free_text} }, total: {kcal…}, free_text } or null when the day has no dishes.
export function dayTotals(plan, meals, d, shown, snap) {
  const slots = {}, total = Object.fromEntries(KEYS.map((k) => [k, 0]));
  let any = false, free = false;
  for (const k of shown) {
    const lines = slotLines(plan, d, k), t = text(meals, d, k);
    if (!lines.length) { if (t) free = true; continue; }
    any = true;
    const s = Object.fromEntries(KEYS.map((x) => [x, 0]));
    for (const l of lines) for (const x of KEYS) s[x] += l.servings * (Number(snap[l.dish]?.per_serving?.[x]) || 0);
    for (const x of KEYS) total[x] += s[x];
    s.free_text = !!t; if (t) free = true;
    slots[k] = s;
  }
  return any ? { slots, total, free_text: free } : null;
}
