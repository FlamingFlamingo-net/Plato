/// <reference path="../pb_data/types.d.ts" />
// Activity log checks the collection rules cannot express (spec "Feature: Patient activity dashboard", slice 1).
// - date: today, or up to 7 days back (one extra day each way for time zones; dates are the patient's local day)
// - kind "other" needs a name; terrain only for walk/run/bike; distance only for walk/run/bike/swim

onRecordCreateRequest((e) => {
  const r = e.record;
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const now = Date.now();
  const date = r.getString("date");
  if (date > ymd(now + 864e5)) throw new BadRequestError("La fecha no puede ser en el futuro.");
  if (date < ymd(now - 8 * 864e5)) throw new BadRequestError("Solo puedes registrar actividad de los últimos 7 días.");

  const kind = r.getString("kind");
  const other = r.getString("kind_other").trim();
  if (kind === "other" && !other) throw new BadRequestError("Escribe qué actividad hiciste.");
  r.set("kind_other", kind === "other" ? other : "");
  if (["walk", "run", "bike"].indexOf(kind) < 0) r.set("terrain", "");
  if (["walk", "run", "bike", "swim"].indexOf(kind) < 0) r.set("distance_km", 0);
  e.next();
}, "activity_logs");
