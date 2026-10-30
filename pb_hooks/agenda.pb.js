/// <reference path="../pb_data/types.d.ts" />
// Agenda rules the collection rules cannot express (spec "Feature: Agenda — the nutritionist's own calendar").
// - duration in steps of 5 minutes
// - changed_at = server time whenever the time, duration, type or cancellation changes (the patient's "Nueva")
// - cancelled_at: any non-empty value means "cancel now" (server time); "" re-opens it
// - a new nutritionist starts with the default consultation types
// (Hooks run in separate JS runtimes: everything is inside the handlers.)

onRecordCreateRequest((e) => {
  const r = e.record;
  const now = new Date().toISOString().replace("T", " ");
  if (r.getInt("duration_min") % 5 !== 0) throw new BadRequestError("La duración va de 5 en 5 minutos.");
  r.set("type", String(r.getString("type") || "").trim());
  if (!r.getString("type")) throw new BadRequestError("Elige el tipo de consulta.");
  if (r.getString("cancelled_at")) r.set("cancelled_at", now);
  r.set("changed_at", now);
  e.next();
}, "appointments");

onRecordUpdateRequest((e) => {
  const r = e.record, o = r.original();
  const now = new Date().toISOString().replace("T", " ");
  if (r.getInt("duration_min") % 5 !== 0) throw new BadRequestError("La duración va de 5 en 5 minutos.");
  r.set("type", String(r.getString("type") || "").trim());
  if (!r.getString("type")) throw new BadRequestError("Elige el tipo de consulta.");
  const wasCancelled = !!o.getString("cancelled_at"), isCancelled = !!r.getString("cancelled_at");
  if (isCancelled && !wasCancelled) r.set("cancelled_at", now);
  if (isCancelled && wasCancelled) r.set("cancelled_at", o.getString("cancelled_at"));
  const changed = ["starts_at", "duration_min", "type", "patient"].some((f) => String(r.get(f)) !== String(o.get(f))) || isCancelled !== wasCancelled;
  if (changed) r.set("changed_at", now);
  e.next();
}, "appointments");

onRecordCreateRequest((e) => {
  const r = e.record;
  let list = null;
  try { list = JSON.parse(r.getString("appointment_types") || "null"); } catch (_) { list = null; }
  if (!Array.isArray(list) || !list.length) {
    r.set("appointment_types", [
      { name: "Consulta nutricional inicial", minutes: 60 },
      { name: "Consulta nutricional seguimiento", minutes: 60 },
      { name: "Consulta de entrenamiento", minutes: 60 },
      { name: "Consulta de mediciones", minutes: 30 },
      { name: "Consulta de alto rendimiento deportivo", minutes: 90 },
    ]);
  }
  e.next();
}, "nutritionists");

onRecordUpdateRequest((e) => {
  const body = e.requestInfo().body || {};
  if (body.appointment_types !== undefined) {
    // Read the field as saved JSON text: the request body's list is a Go value, not a plain JS array.
    let list = null;
    try { list = JSON.parse(e.record.getString("appointment_types") || "null"); } catch (_) { list = null; }
    const ok = (x) => x && typeof x === "object" && typeof x.name === "string" && x.name.trim() && x.name.trim().length <= 80
      && Number.isInteger(x.minutes) && x.minutes >= 15 && x.minutes <= 240 && x.minutes % 5 === 0;
    if (!Array.isArray(list) || !list.length || list.length > 30 || !list.every(ok))
      throw new BadRequestError("Cada tipo de consulta necesita un nombre (hasta 80 letras) y una duración de 15 a 240 minutos, de 5 en 5. Máximo 30 tipos.");
    const seen = new Set(), clean = [];
    for (const x of list) {
      const name = x.name.trim();
      if (seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      clean.push({ name, minutes: x.minutes });
    }
    e.record.set("appointment_types", clean);
  }
  e.next();
}, "nutritionists");
