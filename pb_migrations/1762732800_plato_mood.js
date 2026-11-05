/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: mood check-in (spec "Feature: Mood check-in").
// mood_logs: one per patient per day. The patient adds and changes their own (today or yesterday: pb_hooks/mood.pb.js);
// their nutritionist reads them and sets only seen_at. Nobody deletes one (a patient's permanent delete cascades).
// Undo (ask first): /pb/pocketbase migrate down 1

migrate((app) => {
  const patients = app.findCollectionByNameOrId("patients");
  const isNutri = '@request.auth.collectionName = "nutritionists"';
  const isPatient = '@request.auth.collectionName = "patients"';
  const nutriOfPatient = `${isNutri} && patient.nutritionist = @request.auth.id`;
  const onlySeen = ["patient", "date", "mood", "note"].map((f) => `@request.body.${f}:isset = false`).join(" && ");
  const own = `${isPatient} && patient = @request.auth.id && @request.auth.archived_at = ""`;
  const c = new Collection({
    type: "base",
    name: "mood_logs",
    fields: [
      { name: "patient", type: "relation", required: true, maxSelect: 1, collectionId: patients.id, cascadeDelete: true },
      { name: "date", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      { name: "mood", type: "number", required: true, min: 1, max: 5, onlyInt: true },
      { name: "note", type: "text", max: 200 },
      { name: "seen_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_mood_patient_date ON mood_logs (patient, date)"],
    listRule: `(${isPatient} && patient = @request.auth.id) || (${nutriOfPatient})`,
    viewRule: `(${isPatient} && patient = @request.auth.id) || (${nutriOfPatient})`,
    createRule: `${isPatient} && @request.body.patient = @request.auth.id && @request.body.seen_at:isset = false && @request.auth.archived_at = ""`,
    updateRule: `(${own} && @request.body.patient:isset = false && @request.body.date:isset = false && @request.body.seen_at:isset = false)`
      + ` || (${nutriOfPatient} && ${onlySeen} && patient.archived_at = "")`,
    deleteRule: null,
  });
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("mood_logs"));
});
