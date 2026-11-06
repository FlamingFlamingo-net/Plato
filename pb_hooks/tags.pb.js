/// <reference path="../pb_data/types.d.ts" />
// Tags (spec "Feature: Ingredients, slice (a)" → "Tags"): what the collection rules cannot express.
// - a tag name is trimmed, spaces collapsed; two names that differ only in capitals/accents are the same tag
// - max 200 own tags; a name that a platform tag already has is refused (use the starter one)
// - a link needs an existing item (an ingredient, or the nutritionist's OWN template) and a tag the nutritionist can see
// - deleting an ingredient or a template removes its links
// (Hooks run in separate JS runtimes: helpers are inside each handler.)

onRecordCreateRequest((e) => {
  const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const r = e.record;
  if (e.hasSuperuserAuth()) {   // the loader (platform tags): keep nutritionist/dataset, only fill the comparison name
    r.set("norm", norm(r.getString("name")));
    return e.next();
  }
  const name = String(r.getString("name") || "").replace(/\s+/g, " ").trim();
  if (!name) throw new BadRequestError("Escribe un nombre para la etiqueta.");
  if (name.length > 30) throw new BadRequestError("La etiqueta puede tener hasta 30 caracteres.");
  r.set("name", name);
  r.set("norm", norm(name));
  r.set("dataset", "");
  const mine = r.getString("nutritionist");
  const dup = e.app.findRecordsByFilter("tags", "norm = {:n} && (nutritionist = '' || nutritionist = {:me})", "", 1, 0, { n: norm(name), me: mine });
  if (dup.length) throw new BadRequestError(dup[0].getString("nutritionist") ? "Ya tienes una etiqueta con ese nombre." : "Esa etiqueta ya existe (viene incluida): úsala.");
  const count = e.app.countRecords("tags", $dbx.hashExp({ nutritionist: mine }));
  if (count >= 200) throw new BadRequestError("Llegaste al límite de 200 etiquetas propias.");
  e.next();
}, "tags");

onRecordCreateRequest((e) => {
  if (e.hasSuperuserAuth()) return e.next();   // the loader (platform links)
  const r = e.record;
  const me = r.getString("nutritionist"), kind = r.getString("kind"), item = r.getString("item");
  let found = null;
  try {
    found = kind === "ingredient" ? e.app.findRecordById("ingredients", item)
      : e.app.findFirstRecordByFilter("diet_templates", "id = {:id} && nutritionist = {:me}", { id: item, me });
  } catch (_) { found = null; }
  if (!found) throw new BadRequestError(kind === "ingredient" ? "Ese ingrediente no existe." : "Esa plantilla no existe.");
  let tag = null;
  try { tag = e.app.findRecordById("tags", r.getString("tag")); } catch (_) { tag = null; }
  if (!tag || (tag.getString("nutritionist") && tag.getString("nutritionist") !== me)) throw new BadRequestError("Esa etiqueta no existe.");
  e.next();
}, "item_tags");

onRecordAfterDeleteSuccess((e) => {
  const rows = e.app.findRecordsByFilter("item_tags", "kind = 'ingredient' && item = {:id}", "", 500, 0, { id: e.record.id });
  for (const l of rows) e.app.delete(l);
  e.next();
}, "ingredients");

onRecordAfterDeleteSuccess((e) => {
  const rows = e.app.findRecordsByFilter("item_tags", "kind = 'template' && item = {:id}", "", 500, 0, { id: e.record.id });
  for (const l of rows) e.app.delete(l);
  e.next();
}, "diet_templates");
