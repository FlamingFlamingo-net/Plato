// sources.js — which data set an ingredient comes from (spec "SMAE and USDA side by side"), and how SMAE's equivalent reads.
import { h } from './ui.js';

export const SOURCES = ['smae', 'usda', 'otros'];
export const sourceOf = (r) => { const d = String(r?.dataset || ''); return d.startsWith('smae') ? 'smae' : d.startsWith('usda') ? 'usda' : 'otros'; };
export const SOURCE_TAB = { smae: 'SMAE (español)', usda: 'USDA (inglés)', otros: 'Otros' };
export const SOURCE_SHORT = { smae: 'SMAE', usda: 'USDA', otros: 'Otro' };
export const SOURCE_LINE = {
  smae: 'Fuente: SMAE, Sistema Mexicano de Alimentos Equivalentes, 4.ª edición. Los valores por 100 g se calculan del equivalente del libro; “por confirmar” marca filas cuyas calorías no cuadran en el libro.',
  usda: 'Fuente: USDA FoodData Central (SR Legacy). Valores promedio por 100 g, no de una marca. Los nombres están en inglés por ahora.',
  otros: 'Otros datos cargados en la plataforma.',
};
export const sourceBadge = (r) => h('span', { class: `badge plato-src plato-src--${sourceOf(r)}`, 'data-variant': 'outline', text: SOURCE_SHORT[sourceOf(r)] });

const FRACTIONS = [[0.25, '1/4'], [1 / 3, '1/3'], [0.5, '1/2'], [2 / 3, '2/3'], [0.75, '3/4']];
const nf = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 1 });
// 2 → "2", 0.5 → "1/2", 1.5 → "1 1/2", 0.4 → "0.4"
export function amountText(x) {
  const whole = Math.floor(x + 1e-9), rest = x - whole;
  if (rest < 0.02) return String(whole);
  const f = FRACTIONS.find(([v]) => Math.abs(rest - v) < 0.02);
  return f ? (whole ? `${whole} ${f[1]}` : f[1]) : nf.format(x);
}
// The SMAE equivalent of a food: "1 equivalente = 1/2 taza (72 g)", or null when it has none.
export function equivalentText(r) {
  const eq = (r.portions || []).find((p) => p?.label === 'equivalente');
  if (!eq) return null;
  const other = (r.portions || []).find((p) => p?.label && p.label !== 'equivalente' && p.grams > 0);
  return other ? `1 equivalente = ${amountText(eq.grams / other.grams)} ${other.label} (${nf.format(eq.grams)} g)` : `1 equivalente = ${nf.format(eq.grams)} g`;
}
export const fiberMissing = (r) => !!r?.extra?.fiber_missing;
