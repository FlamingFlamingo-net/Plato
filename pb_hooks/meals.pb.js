/// <reference path="../pb_data/types.d.ts" />
// Meal checklist rules the collection rules cannot express (spec "Feature: Weekly goals", slice 1).
// - date: today or yesterday in the patient's local day. The server doesn't know the patient's time zone, so it
//   uses the real limits: no zone is more than 14 h ahead of UTC or 12 h behind it.
// - a check (no photo) on a planned slot: only one per day and slot
// - an extra: needs a photo or a note
// - the patient adding a photo to their check makes it "new" again for the nutritionist
// - feedback only on logs with a photo
// (Hooks run in separate JS runtimes: everything is inside the handlers.)

onRecordCreateRequest((e) => {
  const r = e.record;
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const H = 3600e3;
  const now = Date.now();
  const date = r.getString("date");
  if (date > ymd(now + 14 * H)) throw new BadRequestError("La fecha no puede ser en el futuro.");
  if (date < ymd(now - 12 * H - 24 * H)) throw new BadRequestError("Solo puedes registrar comidas de hoy o de ayer.");

  const slot = r.getString("slot");
  // A JSON request (no file) makes findUploadedFiles throw: that means "no photo".
  let hasPhoto = false;
  try { hasPhoto = (e.findUploadedFiles("photo") || []).length > 0; } catch (_) { hasPhoto = false; }
  r.set("note", String(r.getString("note") || "").trim());
  if (slot === "extra") {
    if (!hasPhoto && !r.getString("note")) throw new BadRequestError("Agrega una foto o una nota de lo que comiste.");
  } else if (!hasPhoto) {
    const same = e.app.findRecordsByFilter("meal_logs", "patient = {:p} && date = {:d} && slot = {:s}", "", 1, 0,
      { p: r.getString("patient"), d: date, s: slot });
    if (same.length) throw new BadRequestError("Esta comida ya está marcada.");
  }
  e.next();
}, "meal_logs");

onRecordUpdateRequest((e) => {
  const r = e.record;
  const auth = e.auth;
  const body = e.requestInfo().body || {};
  if (auth && auth.collection().name === "patients") {
    let n = 0;
    try { n = (e.findUploadedFiles("photo") || []).length; } catch (_) { n = 0; }
    if (!n) throw new BadRequestError("Toma o elige una foto de tu comida.");
    r.set("seen_at", "");           // a new photo: the nutritionist sees it as new
    r.set("note", String(r.getString("note") || "").trim());
  } else if ((body.feedback_text !== undefined || body.feedback_stars !== undefined) && !r.original().getString("photo")) {
    throw new BadRequestError("La retroalimentación va en comidas con foto.");
  }
  e.next();
}, "meal_logs");
