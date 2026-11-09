// Helpers for pb_hooks/dishes.pb.js (required inside each handler): the nutrition of a dish (spec "Feature: Recetas (dishes), slice (b)").
// A dish is entered PER SERVING. Each line: an ingredient, an amount and a unit: "g", "ml" (needs the ingredient's density),
// or the label of a household portion that ingredient has (e.g. "large", "cup"; "pieza" uses piece_g when there is no portion).
// grams -> nutrition = grams / 100 x the ingredient's per-100 g value. The total is the sum of the lines. Nothing is guessed.

const KEYS = ["kcal", "protein_g", "fat_g", "carbs_g", "fiber_g"];
const MAX_LINES = 40;
const MAX_AMOUNT = 100000;
const round4 = (x) => Math.round(x * 10000) / 10000;

function jget(rec, name) {
  try { const v = JSON.parse(rec.getString(name)); return v === null ? null : v; } catch (_) { return null; }
}

// grams of one line, or { error }
function gramsOf(ing, line) {
  const amount = Number(line.amount), unit = String(line.unit || "");
  if (unit === "g") return { grams: amount };
  if (unit === "ml") {
    const d = ing.getFloat("density_g_ml");
    return d > 0 ? { grams: amount * d } : { error: "no se puede dar en ml (no tiene densidad); usa gramos" };
  }
  const portions = jget(ing, "portions");
  const p = Array.isArray(portions) ? portions.find((x) => x && x.label === unit) : null;
  if (p && Number(p.grams) > 0) return { grams: amount * Number(p.grams) };
  if (unit === "pieza" && ing.getFloat("piece_g") > 0) return { grams: amount * ing.getFloat("piece_g") };
  return { error: `no tiene la porción “${unit}”` };
}

// items from the request -> { items (cleaned, with the server's snapshot), nutrition, errors[] }
// mode "save": every ingredient must exist. mode "recalc": a missing ingredient is flagged instead of refused.
function compute(app, raw, mode) {
  const errors = [], items = [];
  const total = Object.fromEntries(KEYS.map((k) => [k, 0]));
  let missing = false;
  if (!Array.isArray(raw) || raw.length < 1) return { items: [], nutrition: null, errors: ["Agrega al menos un ingrediente."], missing };
  if (raw.length > MAX_LINES) return { items: [], nutrition: null, errors: [`Máximo ${MAX_LINES} ingredientes por receta.`], missing };
  raw.forEach((line, i) => {
    const n = i + 1, fail = (m) => errors.push(`Ingrediente ${n}: ${m}.`);
    if (!line || typeof line !== "object") return fail("línea no válida");
    const amount = Number(line.amount), unit = String(line.unit || "").trim();
    if (!(amount > 0) || amount > MAX_AMOUNT) return fail("la cantidad debe ser mayor que 0");
    if (!unit || unit.length > 60) return fail("falta la unidad");
    let ing = null;
    try { ing = app.findRecordById("ingredients", String(line.ingredient || "")); } catch (_) { ing = null; }
    if (!ing) {
      if (mode === "recalc") { missing = true; items.push(Object.assign({}, line, { missing: true })); return; }
      return fail(line.missing ? "ese ingrediente ya no existe; quítalo o cámbialo" : "ese ingrediente no existe");
    }
    const g = gramsOf(ing, { amount, unit });
    if (g.error) {
      if (mode === "recalc") { items.push(Object.assign({}, line, { problem: `${ing.getString("name")}: ${g.error}` })); missing = true; return; }
      return fail(`${ing.getString("name")} ${g.error}`);
    }
    for (const k of KEYS) total[k] += (g.grams / 100) * ing.getFloat(k);
    items.push({ ingredient: ing.id, fdc_id: ing.getInt("fdc_id"), name: ing.getString("name"), state: ing.getString("state"), amount, unit, grams: round4(g.grams) });
  });
  if (errors.length) return { items: [], nutrition: null, errors, missing };
  return { items, nutrition: Object.fromEntries(KEYS.map((k) => [k, round4(total[k])])), errors, missing };
}

const same = (a, b) => !!a && !!b && KEYS.every((k) => Math.abs(Number(a[k]) - Number(b[k])) < 0.00005);
const nowDb = () => new Date().toISOString().replace("T", " ");

module.exports = { KEYS, MAX_LINES, compute, jget, same, nowDb, round4 };
