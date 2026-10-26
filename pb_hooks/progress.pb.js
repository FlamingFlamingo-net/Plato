/// <reference path="../pb_data/types.d.ts" />
// Progress photo checks the rules cannot express (spec "Feature: Patient activity dashboard", slice 2).
// date = the patient's local day, so today with one day of slack each way for time zones.

onRecordCreateRequest((e) => {
  const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
  const now = Date.now();
  const date = e.record.getString("date");
  if (date > ymd(now + 864e5) || date < ymd(now - 864e5)) {
    throw new BadRequestError("La foto de progreso es de hoy. Revisa la fecha de tu teléfono.");
  }
  e.next();
}, "progress_photos");
