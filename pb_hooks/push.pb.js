/// <reference path="../pb_data/types.d.ts" />
// Appointment notifications (spec "Feature: Appointment reminders + clinic time zone", slice 2). Helpers: push_lib.js.
//   GET  /api/plato/push/key                patient → the server's public key (for the phone's subscription)
//   GET  /api/plato/patients/{id}/push      nutritionist → { enabled } ("Avisos: activados")
//   POST /api/plato/push/run                superuser → run the reminder job now ({ now } optional, for tests)
//   cron every 5 minutes                    the reminder job
//   appointment moved / cancelled           "Tu cita cambió" / "Tu cita se canceló" at once; reminders follow the new time

routerAdd("GET", "/api/plato/push/key", (e) => {
  if (!e.auth || e.auth.collection().name !== "patients") throw new UnauthorizedError("Inicia sesión.");
  const L = require(`${__hooks}/push_lib.js`);
  return e.json(200, { key: L.keys(e.app).publicKey });
});

routerAdd("GET", "/api/plato/patients/{id}/push", (e) => {
  const lib = require(`${__hooks}/plato_lib.js`);
  const patient = lib.ownedPatient(e, e.request.pathValue("id"));
  const n = e.app.countRecords("push_subscriptions", $dbx.hashExp({ patient: patient.id }));
  return e.json(200, { enabled: n > 0 });
});

routerAdd("POST", "/api/plato/push/run", (e) => {
  if (!e.hasSuperuserAuth()) throw new ForbiddenError("Solo administradores.");
  const L = require(`${__hooks}/push_lib.js`);
  const body = e.requestInfo().body || {};
  const now = body.now ? new Date(String(body.now)) : new Date();
  if (isNaN(now.getTime())) throw new BadRequestError("now inválido.");
  return e.json(200, { ran: L.runDue(e.app, now) });
});

cronAdd("plato_push_reminders", "*/5 * * * *", () => {
  const L = require(`${__hooks}/push_lib.js`);
  try { L.runDue($app, new Date()); } catch (err) { $app.logger().error("push reminders", "error", String(err)); }
});

// A phone turns notifications on: only real push services, well-formed keys; the same phone replaces its old row
// (also when another patient signs in on it).
onRecordCreateRequest((e) => {
  const L = require(`${__hooks}/push_lib.js`);
  const r = e.record;
  if (!L.allowedEndpoint(r.getString("endpoint"))) throw new BadRequestError("Este teléfono no tiene un servicio de avisos compatible.");
  if (!L.validKeys(r.getString("p256dh"), r.getString("auth"))) throw new BadRequestError("Datos de avisos incompletos.");
  try {
    const old = e.app.findFirstRecordByFilter("push_subscriptions", "endpoint = {:x}", { x: r.getString("endpoint") });
    e.app.delete(old);
  } catch (_) { /* new phone */ }
  e.next();
}, "push_subscriptions");

// Moved or cancelled by the nutritionist: reset the reminders, then tell the patient once the change is saved.
onRecordUpdateRequest((e) => {
  const L = require(`${__hooks}/push_lib.js`);
  const r = e.record, o = r.original();
  const now = new Date();
  const moved = String(r.get("starts_at")) !== String(o.get("starts_at"));
  const cancelled = !!r.getString("cancelled_at") && !o.getString("cancelled_at");
  if (moved) { r.set("reminded_day_at", ""); r.set("reminded_hour_at", ""); }
  e.next();
  const future = L.pbDate(r.getString("starts_at")).getTime() > now.getTime();
  const kind = cancelled ? "cancelled" : (moved && !r.getString("cancelled_at") ? "moved" : "");
  if (!kind || !future) return;
  try { L.notify(e.app, r, kind, now); } catch (err) { e.app.logger().warn("push change notice", "error", String(err)); }
}, "appointments");
