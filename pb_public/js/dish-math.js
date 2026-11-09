// dish-math.js — the nutrition of a dish, the same arithmetic as pb_hooks/dishes_lib.js (the server stores the official numbers;
// this shows them live while building, and a test proves the two agree). Spec "Feature: Recetas (dishes), slice (b)".
export const KEYS = ['kcal', 'protein_g', 'fat_g', 'carbs_g', 'fiber_g'];
export const MAX_LINES = 40;

// What units can this ingredient be measured in? [{ value, label }]  (g always; ml only with a density; its household portions)
export function unitsOf(ing) {
  const out = [{ value: 'g', label: 'g' }];
  if (ing.density_g_ml > 0) out.push({ value: 'ml', label: 'ml' });
  const portions = Array.isArray(ing.portions) ? ing.portions : [];
  for (const p of portions) if (p?.label && p.grams > 0) out.push({ value: p.label, label: `${p.label} (${fmt(p.grams)} g)` });
  if (!portions.length && ing.piece_g > 0) out.push({ value: 'pieza', label: `pieza (${fmt(ing.piece_g)} g)` });
  return out;
}
const fmt = (n) => new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 }).format(n);

// grams of one line: { grams } or { error }
export function gramsOf(ing, amount, unit) {
  if (!(amount > 0)) return { error: 'la cantidad debe ser mayor que 0' };
  if (unit === 'g') return { grams: amount };
  if (unit === 'ml') return ing.density_g_ml > 0 ? { grams: amount * ing.density_g_ml } : { error: 'no se puede dar en ml (no tiene densidad)' };
  const p = (ing.portions || []).find((x) => x?.label === unit);
  if (p && p.grams > 0) return { grams: amount * p.grams };
  if (unit === 'pieza' && ing.piece_g > 0) return { grams: amount * ing.piece_g };
  return { error: `no tiene la porción “${unit}”` };
}

// lines: [{ ingredient: id, amount, unit }], byId: Map(id → ingredient). → { nutrition, lines: [{ grams, kcal, error, missing }] }
export function compute(lines, byId) {
  const total = Object.fromEntries(KEYS.map((k) => [k, 0]));
  const info = lines.map((l) => {
    const ing = byId.get(l.ingredient);
    if (!ing) return { missing: true };
    const g = gramsOf(ing, Number(l.amount), l.unit);
    if (g.error) return { error: g.error };
    for (const k of KEYS) total[k] += (g.grams / 100) * ing[k];
    return { grams: g.grams, kcal: (g.grams / 100) * ing.kcal };
  });
  return { nutrition: total, lines: info, ok: info.length > 0 && info.every((i) => i.grams != null) };
}
