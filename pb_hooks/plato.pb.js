/// <reference path="../pb_data/types.d.ts" />
// Plato invite links. Permission rules cannot set another account's password, so this is a hook.
//   POST /api/plato/invite        {patient}                 nutritionist only → new link, old links stop working
//   GET  /api/plato/invite/{token}                          → {name, nutritionist} if the link still works
//   POST /api/plato/join          {token, email, password}  → patient auth response (signed in)
// Helpers live in plato_lib.js (no ".pb." in the name) and are required inside each handler.

routerAdd("POST", "/api/plato/invite", (e) => {
  const lib = require(`${__hooks}/plato_lib.js`);
  const auth = e.auth;
  if (!auth || auth.collection().name !== "nutritionists") {
    throw new UnauthorizedError("Inicia sesión como nutrióloga o nutriólogo.");
  }
  const pid = String(e.requestInfo().body.patient || "");
  let patient = null;
  try { patient = e.app.findRecordById("patients", pid); } catch (_) { patient = null; }
  if (!patient || patient.getString("nutritionist") !== auth.id) {
    throw new NotFoundError("Paciente no encontrado.");
  }

  const token = $security.randomString(40);
  const expires = lib.isoIn(7);
  e.app.runInTransaction((tx) => {
    const old = tx.findRecordsByFilter("invites", "patient = {:p} && used = false", "", 0, 0, { p: pid });
    for (const r of old) { r.set("used", true); tx.save(r); }
    const r = new Record(tx.findCollectionByNameOrId("invites"));
    r.set("patient", pid);
    r.set("token", token);
    r.set("expires", expires);
    r.set("used", false);
    tx.save(r);
  });
  return e.json(200, { token: token, expires: expires });
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
