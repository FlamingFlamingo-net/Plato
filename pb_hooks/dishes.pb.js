/// <reference path="../pb_data/types.d.ts" />
// Dishes (spec "Feature: Recetas (dishes), slice (b)"): what the collection rules cannot express.
// - names trimmed; a client can never set the computed numbers, their dates, or archived_at (the server does)
// - items validated and the nutrition computed from the ingredients on every save (dishes_lib.js)
// - archived_at is the server's time (any non-empty value means "archive now"; "" restores), like diet templates
// - when an ingredient's numbers change, the dishes using it are recalculated and marked "Valores actualizados";
//   when an ingredient is deleted, its lines are flagged and the dish keeps its last numbers
// (Hooks run in separate JS runtimes: the shared helpers are required inside each handler.)

onRecordCreateRequest((e) => {
  const D = require(`${__hooks}/dishes_lib.js`);
  const r = e.record;
  r.set("name", String(r.getString("name") || "").replace(/\s+/g, " ").trim());
  r.set("serving_unit", String(r.getString("serving_unit") || "").replace(/\s+/g, " ").trim());
  r.set("notes", String(r.getString("notes") || "").trim());
  r.set("archived_at", "");
  r.set("values_updated_at", "");
  if (e.app.countRecords("dishes", $dbx.hashExp({ nutritionist: r.getString("nutritionist") })) >= 1000) throw new BadRequestError("Llegaste al límite de 1,000 recetas.");
  const out = D.compute(e.app, D.jget(r, "items"), "save");
  if (out.errors.length) throw new BadRequestError(out.errors.join(" "));
  r.set("items", out.items);
  r.set("nutrition", out.nutrition);
  r.set("computed_at", D.nowDb());
  e.next();
}, "dishes");

onRecordUpdateRequest((e) => {
  const D = require(`${__hooks}/dishes_lib.js`);
  const r = e.record, o = r.original();
  r.set("name", String(r.getString("name") || "").replace(/\s+/g, " ").trim());
  r.set("serving_unit", String(r.getString("serving_unit") || "").replace(/\s+/g, " ").trim());
  r.set("notes", String(r.getString("notes") || "").trim());
  // archive: server time
  const was = !!o.getString("archived_at"), is = !!r.getString("archived_at");
  if (is && !was) r.set("archived_at", D.nowDb());
  if (is && was) r.set("archived_at", o.getString("archived_at"));
  // the numbers belong to the server
  r.set("values_updated_at", o.getString("values_updated_at"));
  r.set("nutrition", D.jget(o, "nutrition"));
  r.set("computed_at", o.getString("computed_at"));
  if (JSON.stringify(D.jget(r, "items")) !== JSON.stringify(D.jget(o, "items"))) {
    const out = D.compute(e.app, D.jget(r, "items"), "save");
    if (out.errors.length) throw new BadRequestError(out.errors.join(" "));
    r.set("items", out.items);
    r.set("nutrition", out.nutrition);
    r.set("computed_at", D.nowDb());
    r.set("values_updated_at", "");   // the nutritionist's own edit is not a data update
  } else {
    r.set("items", D.jget(o, "items"));
  }
  e.next();
}, "dishes");

// Ingredient numbers changed (a data set was reloaded): recalculate the dishes that use it.
onRecordAfterUpdateSuccess((e) => {
  const D = require(`${__hooks}/dishes_lib.js`);
  const id = e.record.id;
  const rows = e.app.findRecordsByFilter("dishes", "items ~ {:id}", "", 1000, 0, { id });
  for (const dish of rows) {
    const items = D.jget(dish, "items");
    if (!Array.isArray(items) || !items.some((x) => x && x.ingredient === id)) continue;
    const out = D.compute(e.app, items, "recalc");
    if (out.missing) {   // a line cannot be computed now: keep the numbers, flag the lines
      dish.set("items", out.items);
      e.app.save(dish);
      continue;
    }
    const changed = !D.same(out.nutrition, D.jget(dish, "nutrition"));
    dish.set("items", out.items);   // names and grams follow the ingredient
    if (changed) {
      dish.set("nutrition", out.nutrition);
      dish.set("computed_at", D.nowDb());
      dish.set("values_updated_at", D.nowDb());
    }
    e.app.save(dish);
  }
  e.next();
}, "ingredients");

// An ingredient was deleted: flag its lines, keep the dish's last numbers.
onRecordAfterDeleteSuccess((e) => {
  const D = require(`${__hooks}/dishes_lib.js`);
  const id = e.record.id;
  const rows = e.app.findRecordsByFilter("dishes", "items ~ {:id}", "", 1000, 0, { id });
  for (const dish of rows) {
    const items = D.jget(dish, "items");
    if (!Array.isArray(items)) continue;
    let hit = false;
    for (const x of items) if (x && x.ingredient === id) { x.missing = true; hit = true; }
    if (hit) { dish.set("items", items); e.app.save(dish); }
  }
  e.next();
}, "ingredients");
