/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: appointment notifications (spec "Feature: Appointment reminders + clinic time zone", slice 2).
// - push_keys: the server's own web-push (VAPID) key pair, made on first use. No rules: superusers only.
// - push_subscriptions: one row per patient phone that turned "Avisos de citas" on. Only that patient reads,
//   adds or removes it; endpoint checks in pb_hooks/push.pb.js.
// - appointments.reminded_day_at / reminded_hour_at: what the job already sent (server-set only).
// Undo (ask first): /pb/pocketbase migrate down 1

migrate((app) => {
  const patients = app.findCollectionByNameOrId("patients");
  app.save(new Collection({
    type: "base",
    name: "push_keys",
    fields: [
      { name: "public_key", type: "text", required: true, max: 200 },
      { name: "private_key", type: "text", required: true, max: 200 },
      { name: "created", type: "autodate", onCreate: true },
    ],
    listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null,
  }));

  const own = '@request.auth.collectionName = "patients" && patient = @request.auth.id';
  app.save(new Collection({
    type: "base",
    name: "push_subscriptions",
    fields: [
      { name: "patient", type: "relation", required: true, collectionId: patients.id, maxSelect: 1, cascadeDelete: true },
      { name: "endpoint", type: "text", required: true, max: 1000 },
      { name: "p256dh", type: "text", required: true, max: 200 },
      { name: "auth", type: "text", required: true, max: 100 },
      { name: "created", type: "autodate", onCreate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_push_endpoint ON push_subscriptions (endpoint)"],
    listRule: own,
    viewRule: own,
    createRule: '@request.auth.collectionName = "patients" && @request.body.patient = @request.auth.id && @request.auth.archived_at = ""',
    updateRule: null,
    deleteRule: own,
  }));

  const appts = app.findCollectionByNameOrId("appointments");
  appts.fields.add(new DateField({ name: "reminded_day_at" }));
  appts.fields.add(new DateField({ name: "reminded_hour_at" }));
  const locked = " && @request.body.reminded_day_at:isset = false && @request.body.reminded_hour_at:isset = false";
  appts.createRule += locked;
  appts.updateRule += locked;
  app.save(appts);
}, (app) => {
  const appts = app.findCollectionByNameOrId("appointments");
  const locked = " && @request.body.reminded_day_at:isset = false && @request.body.reminded_hour_at:isset = false";
  appts.createRule = appts.createRule.replace(locked, "");
  appts.updateRule = appts.updateRule.replace(locked, "");
  appts.fields.removeByName("reminded_day_at");
  appts.fields.removeByName("reminded_hour_at");
  app.save(appts);
  app.delete(app.findCollectionByNameOrId("push_subscriptions"));
  app.delete(app.findCollectionByNameOrId("push_keys"));
});
