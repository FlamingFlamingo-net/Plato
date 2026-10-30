/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: consultation types get a default duration ({ name, minutes }).
// Only for servers that ran the first agenda migration while it still stored plain names; on a fresh
// server there is nothing to convert. The old starting list becomes the client's list; any other plain name
// is kept with 60 minutes.
const OLD = ["Consulta nutricional presencial", "Consulta nutricional en línea", "Consulta de nutrición y entrenamiento", "Seguimiento", "Valoración inicial"];
const TYPES = [
  { name: "Consulta nutricional inicial", minutes: 60 },
  { name: "Consulta nutricional seguimiento", minutes: 60 },
  { name: "Consulta de entrenamiento", minutes: 60 },
  { name: "Consulta de mediciones", minutes: 30 },
  { name: "Consulta de alto rendimiento deportivo", minutes: 90 },
];

migrate((app) => {
  for (const r of app.findAllRecords("nutritionists")) {
    let list = null;
    try { list = JSON.parse(r.getString("appointment_types") || "null"); } catch (_) { list = null; }
    if (!Array.isArray(list) || !list.length) { r.set("appointment_types", TYPES); app.saveNoValidate(r); continue; }
    if (!list.some((x) => typeof x === "string")) continue;
    const same = list.length === OLD.length && list.every((x, i) => x === OLD[i]);
    r.set("appointment_types", same ? TYPES : list.map((x) => (typeof x === "string" ? { name: x, minutes: 60 } : x)));
    app.saveNoValidate(r);
  }
}, (app) => {
  // Nothing to undo: the screens read both shapes.
});
