/// <reference path="../pb_data/types.d.ts" />
// Shared helpers for plato.pb.js. Required inside handlers (hooks run in separate JS runtimes).

function isoIn(days) {
  return new Date(Date.now() + days * 864e5).toISOString().replace("T", " ");
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
  return { invite: invite, patient: patient };
}

module.exports = { isoIn: isoIn, usableInvite: usableInvite };
