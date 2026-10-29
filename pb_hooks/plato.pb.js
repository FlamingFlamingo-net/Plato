/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness invite links. Permission rules cannot set another account's password, so this is a hook.
//   POST /api/plato/invite        {patient}                 nutritionist only → new link, old links stop working
//   GET  /api/plato/invite/{token}                          → {name, nutritionist} if the link still works
//   POST /api/plato/join          {token, email, password}  → patient auth response (signed in)
//   POST /api/plato/patients/{id}/close                     nutritionist → account closed (archived, read-only)
//   POST /api/plato/patients/{id}/reopen                    nutritionist → active again; needs a new invite link
// Helpers live in plato_lib.js (no ".pb." in the name) and are required inside each handler.

routerAdd("POST", "/api/plato/invite", (e) => {
  const lib = require(`${__hooks}/plato_lib.js`);
  const patient = lib.ownedPatient(e, e.requestInfo().body.patient);
  if (patient.getString("archived_at")) throw new BadRequestError("Esta cuenta está cerrada. Reactívala antes de crear un enlace.");
  const pid = patient.id;

  const token = $security.randomString(40);
  const expires = lib.isoIn(7);
  e.app.runInTransaction((tx) => {
    lib.voidInvites(tx, pid);
    const r = new Record(tx.findCollectionByNameOrId("invites"));
    r.set("patient", pid);
    r.set("token", token);
    r.set("expires", expires);
    r.set("used", false);
    tx.save(r);
  });
  return e.json(200, { token: token, expires: expires });
});

// Close: the patient can no longer sign in; the data stays, read-only (spec: archive, not delete).
routerAdd("POST", "/api/plato/patients/{id}/close", (e) => {
  const lib = require(`${__hooks}/plato_lib.js`);
  const patient = lib.ownedPatient(e, e.request.pathValue("id"));
  if (patient.getString("archived_at")) throw new BadRequestError("Esta cuenta ya está cerrada.");
  const at = lib.nowIso();
  e.app.runInTransaction((tx) => {
    patient.set("archived_at", at);
    patient.set("joined", false);
    patient.setEmail("");
    patient.setVerified(false);
    patient.setPassword($security.randomString(40));
    patient.refreshTokenKey(); // ends every open session on every device
    tx.save(patient);
    lib.voidInvites(tx, patient.id);
  });
  return e.json(200, { archived_at: at });
});

routerAdd("POST", "/api/plato/patients/{id}/reopen", (e) => {
  const lib = require(`${__hooks}/plato_lib.js`);
  const patient = lib.ownedPatient(e, e.request.pathValue("id"));
  if (!patient.getString("archived_at")) throw new BadRequestError("Esta cuenta no está cerrada.");
  patient.set("archived_at", "");
  e.app.save(patient);
  return e.json(200, { archived_at: "" });
});

routerAdd("GET", "/api/plato/invite/{token}", (e) => {
  const lib = require(`${__hooks}/plato_lib.js`);
  const found = lib.usableInvite(e.app, e.request.pathValue("token"));
  const nutri = e.app.findRecordById("nutritionists", found.patient.getString("nutritionist"));
  return e.json(200, {
    name: found.patient.getString("name").split(" ")[0],
    nutritionist: nutri.getString("name"),
    rejoin: found.patient.getBool("joined"),
  });
});

routerAdd("POST", "/api/plato/join", (e) => {
  const lib = require(`${__hooks}/plato_lib.js`);
  const body = e.requestInfo().body;
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestError("Escribe un correo válido.");
  if (password.length < 8) throw new BadRequestError("La contraseña necesita al menos 8 caracteres.");
  if (password.length > 71) throw new BadRequestError("La contraseña es demasiado larga.");

  const found = lib.usableInvite(e.app, String(body.token || ""));
  const patient = found.patient;

  let taken = false;
  try { taken = e.app.findAuthRecordByEmail("patients", email).id !== patient.id; } catch (_) { taken = false; }
  if (taken) throw new BadRequestError("Ese correo ya está en uso. Usa otro.");

  e.app.runInTransaction((tx) => {
    patient.setEmail(email);
    patient.setPassword(password);
    patient.setVerified(true);
    patient.set("joined", true);
    tx.save(patient);
    found.invite.set("used", true);
    tx.save(found.invite);
  });
  return $apis.recordAuthResponse(e, patient, "password", null);
});
