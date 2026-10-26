/// <reference path="../pb_data/types.d.ts" />
// Progress photo checks the rules cannot express (spec "Feature: Patient activity dashboard", slice 2).
// date = the patient's local day, so today with one day of slack each way for time zones.
// Age limits (spec "Feature: Age limits"): no progress photos under 18, or with no birth date on file.

onRecordCreateRequest((e) => {
  const lib = require(`${__hooks}/plato_lib.js`);
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const now = Date.now();
  const date = e.record.getString("date");
  if (date > ymd(now + 864e5) || date < ymd(now - 864e5)) {
    throw new BadRequestError("La foto de progreso es de hoy. Revisa la fecha de tu teléfono.");
  }
  let patient = null;
  try { patient = e.app.findRecordById("patients", e.record.getString("patient")); } catch (_) { patient = null; }
  if (patient) {
    const birth = patient.getString("birth_date");
    if (!birth) throw new BadRequestError("Falta tu fecha de nacimiento. Pídele a tu nutrióloga o nutriólogo que la agregue.");
    if (lib.isMinor(birth)) throw new BadRequestError("Por tu edad, Plato no guarda fotos de progreso.");
  }
  e.next();
}, "progress_photos");
