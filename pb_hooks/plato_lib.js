/// <reference path="../pb_data/types.d.ts" />
// Shared helpers for plato.pb.js. Required inside handlers (hooks run in separate JS runtimes).

const CLOSED_MSG = "Esta cuenta está cerrada. Habla con tu nutrióloga o nutriólogo.";

function isoIn(days) {
  return new Date(Date.now() + days * 864e5).toISOString().replace("T", " ");
}

function nowIso() {
  return new Date().toISOString().replace("T", " ");
}

// Returns {invite, patient} or throws a 400 with a plain-language reason.
function usableInvite(app, token) {
  if (!token || token.length < 32) throw new BadRequestError("Este enlace no es válido.");
  let invite = null;
  try { invite = app.findFirstRecordByData("invites", "token", token); } catch (_) { invite = null; }
  if (!invite) throw new BadRequestError("Este enlace no es válido.");
  if (invite.getBool("used")) throw new BadRequestError("Este enlace ya se usó. Pide uno nuevo a tu nutrióloga o nutriólogo.");
  const expires = new Date(invite.getString("expires").replace(" ", "T"));
  if (!(expires > new Date())) throw new BadRequestError("Este enlace caducó. Pide uno nuevo a tu nutrióloga o nutriólogo.");
  const patient = app.findRecordById("patients", invite.getString("patient"));
  if (patient.getString("archived_at")) throw new BadRequestError(CLOSED_MSG);
  return { invite: invite, patient: patient };
}

// The caller must be a nutritionist who owns this patient. Otherwise 401 / 404 (same as the record API).
function ownedPatient(e, id) {
  const auth = e.auth;
  if (!auth || auth.collection().name !== "nutritionists") {
    throw new UnauthorizedError("Inicia sesión como nutrióloga o nutriólogo.");
  }
  let patient = null;
  try { patient = e.app.findRecordById("patients", String(id || "")); } catch (_) { patient = null; }
  if (!patient || patient.getString("nutritionist") !== auth.id) throw new NotFoundError("Paciente no encontrado.");
  return patient;
}

// Void every open invite link of a patient (call inside a transaction).
function voidInvites(tx, patientId) {
  const open = tx.findRecordsByFilter("invites", "patient = {:p} && used = false", "", 0, 0, { p: patientId });
  for (const r of open) { r.set("used", true); tx.save(r); }
}

// Age limits (spec "Feature: Age limits"): one platform-wide rule.
const ADULT_AGE = 18;
// Whole years on today's date (UTC) from a PocketBase date "YYYY-MM-DD hh:mm:ss.sssZ". null when empty.
function ageYears(birth) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(birth || ""));
  if (!m) return null;
  const now = new Date();
  const y = now.getUTCFullYear(), mo = now.getUTCMonth() + 1, d = now.getUTCDate();
  const by = +m[1], bm = +m[2], bd = +m[3];
  return y - by - (mo < bm || (mo === bm && d < bd) ? 1 : 0);
}
// No birth date counts as a minor (safe by default).
const isMinor = (birth) => { const a = ageYears(birth); return a === null || a < ADULT_AGE; };

module.exports = {
  CLOSED_MSG: CLOSED_MSG, isoIn: isoIn, nowIso: nowIso,
  usableInvite: usableInvite, ownedPatient: ownedPatient, voidInvites: voidInvites,
  ADULT_AGE: ADULT_AGE, ageYears: ageYears, isMinor: isMinor,
};
