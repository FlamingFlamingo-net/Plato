// Helpers for pb_hooks/plan.pb.js (required inside each handler): dishes in a diet (spec "Feature: Diets using dishes, slice (c)").
// plan = { "1": { "breakfast": [ { dish, servings } ] } } (days 1-7, like meals). The server keeps, per diet, ONE snapshot of each
// dish it uses (name, unit, nutrition per serving) in plan_calc.dishes, and the totals per slot and per day. A saved diet never
// changes because a dish changed: the snapshot is only renewed when the nutritionist asks (body.plan_refresh = [dish ids] | "all").

const KEYS = ["kcal", "protein_g", "fat_g", "carbs_g", "fiber_g"];
const SLOTS = ["snack_early", "breakfast", "snack_am", "lunch", "snack_pm", "dinner", "snack_night"];
const SNACKS_SHOWN = [[], ["snack_pm"], ["snack_am", "snack_pm"], ["snack_am", "snack_pm", "snack_night"], ["snack_early", "snack_am", "snack_pm", "snack_night"]];
const MAX_PER_SLOT = 8, MIN_SERVINGS = 0.25, MAX_SERVINGS = 20;
const round4 = (x) => Math.round(x * 10000) / 10000;

function jget(rec, name) {
  try { const v = JSON.parse(rec.getString(name)); return v === null ? null : v; } catch (_) { return null; }
}
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
const text = (meals, d, k) => String((meals && meals[d] && meals[d][k]) || "").trim();

function ownerOf(app, rec) {
  const direct = rec.getString("nutritionist");
  if (direct) return direct;
  const p = app.findRecordById("patients", rec.getString("patient"));
  return p.getString("nutritionist");
}

// -> { plan, calc } or throws BadRequestError
function build(app, rec, original, refresh) {
  const fail = (m) => { throw new BadRequestError(m); };
  let plan = jget(rec, "plan");
  if (plan === null) plan = {};
  if (!isObj(plan)) fail("El plan de recetas no es válido.");
  const owner = ownerOf(app, rec);
  const old = original ? jget(original, "plan_calc") : null;
  const oldDishes = old && isObj(old.dishes) ? old.dishes : {};
  const snacks = rec.getString("snacks") === "" ? 2 : rec.getInt("snacks");
  const shown = SLOTS.filter((k) => !k.startsWith("snack") || (SNACKS_SHOWN[snacks] || SNACKS_SHOWN[2]).includes(k));
  const meals = jget(rec, "meals") || {};

  // 1. validate the shape, collect the dish ids
  const clean = {}, ids = [];
  for (const d of Object.keys(plan)) {
    if (!/^[1-7]$/.test(d)) fail(`Día no válido en el plan (${d}).`);
    if (!isObj(plan[d])) fail("El plan de recetas no es válido.");
    for (const k of Object.keys(plan[d])) {
      if (!SLOTS.includes(k)) fail(`Comida no válida en el plan (${k}).`);
      const lines = plan[d][k];
      if (!Array.isArray(lines)) fail("El plan de recetas no es válido.");
      if (!lines.length) continue;
      if (lines.length > MAX_PER_SLOT) fail(`Máximo ${MAX_PER_SLOT} recetas por comida.`);
      for (const l of lines) {
        const id = isObj(l) ? String(l.dish || "") : "";
        const s = isObj(l) ? Number(l.servings) : NaN;
        if (!id) fail("Cada receta del plan necesita su id.");
        if (!(s >= MIN_SERVINGS && s <= MAX_SERVINGS) || Math.abs(s * 4 - Math.round(s * 4)) > 1e-9) fail(`Las porciones deben ir de ${MIN_SERVINGS} a ${MAX_SERVINGS}, de 0.25 en 0.25.`);
        if (!ids.includes(id)) ids.push(id);
      }
      (clean[d] || (clean[d] = {}))[k] = lines.map((l) => ({ dish: String(l.dish), servings: Number(l.servings) }));
    }
  }

  // 2. one snapshot per dish: keep the saved one unless it is new or the nutritionist asked to refresh it
  const dishes = {};
  const wantAll = refresh === "all", want = Array.isArray(refresh) ? refresh.map(String) : [];
  for (const id of ids) {
    const saved = isObj(oldDishes[id]) ? oldDishes[id] : null;
    if (saved && !wantAll && !want.includes(id)) { dishes[id] = saved; continue; }
    let dish = null;
    try { dish = app.findFirstRecordByFilter("dishes", "id = {:id} && nutritionist = {:me}", { id: id, me: owner }); } catch (_) { dish = null; }
    if (!dish) {
      if (saved) { dishes[id] = saved; continue; }            // deleted since: the snapshot stays
      fail("Una de las recetas no existe o no es tuya.");
    }
    if (!saved && dish.getString("archived_at")) fail(`La receta “${dish.getString("name")}” está archivada: restáurala para usarla.`);
    const n = jget(dish, "nutrition") || {};
    const per = {};
    for (const k of KEYS) per[k] = Number(n[k]) || 0;
    dishes[id] = { name: dish.getString("name"), serving_unit: dish.getString("serving_unit"), per_serving: per, at: dish.getString("computed_at") };
  }
  for (const d of Object.keys(clean)) for (const k of Object.keys(clean[d])) for (const l of clean[d][k]) { l.name = dishes[l.dish].name; l.unit = dishes[l.dish].serving_unit; }

  // 3. totals per slot and per day (only the shown meals count; free text is never counted, only flagged)
  const days = {};
  for (let i = 1; i <= 7; i++) {
    const d = String(i), slots = {}, total = {};
    for (const k of KEYS) total[k] = 0;
    let dishLines = 0, free = false;
    for (const k of shown) {
      const lines = (clean[d] && clean[d][k]) || [];
      const t = text(meals, d, k);
      if (!lines.length) continue;
      const s = {};
      for (const key of KEYS) s[key] = 0;
      for (const l of lines) for (const key of KEYS) s[key] += l.servings * dishes[l.dish].per_serving[key];
      for (const key of KEYS) { s[key] = round4(s[key]); total[key] += s[key]; }
      s.free_text = !!t;
      if (t) free = true;
      slots[k] = s;
      dishLines += lines.length;
    }
    if (!dishLines) continue;
    // a shown meal with free text only makes the day's total partial too
    for (const k of shown) if (!(slots[k]) && text(meals, d, k)) free = true;
    for (const key of KEYS) total[key] = round4(total[key]);
    days[d] = { slots: slots, total: total, free_text: free };
  }
  return { plan: clean, calc: { dishes: dishes, days: days } };
}

module.exports = { build, jget, KEYS, SLOTS };
