/// <reference path="../pb_data/types.d.ts" />
// Mood check-in rules the collection rules cannot express (spec "Feature: Mood check-in").
// - date: today or yesterday in the patient's local day (the same real time-zone limits as meals: UTC+14 / UTC−12)
// - a patient's change keeps that window and makes the check-in "new" again for the nutritionist
// (Hooks run in separate JS runtimes: everything is inside the handlers.)

onRecordCreateRequest((e) => {
  const r = e.record;
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const H = 3600e3, now = Date.now();
  const date = r.getString("date");
  if (date > ymd(now + 14 * H)) throw new BadRequestError("La fecha no puede ser en el futuro.");
  if (date < ymd(now - 12 * H - 24 * H)) throw new BadRequestError("Solo puedes responder por hoy o por ayer.");
  r.set("note", String(r.getString("note") || "").trim());
  e.next();
}, "mood_logs");

onRecordUpdateRequest((e) => {
  const r = e.record;
  if (e.auth && e.auth.collection().name === "patients") {
    const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
    const H = 3600e3, now = Date.now();
    if (r.original().getString("date") < ymd(now - 12 * H - 24 * H)) throw new BadRequestError("Solo puedes cambiar lo de hoy o de ayer.");
    r.set("note", String(r.getString("note") || "").trim());
    r.set("seen_at", "");   // changed by the patient: new again for the nutritionist
  }
  e.next();
}, "mood_logs");
