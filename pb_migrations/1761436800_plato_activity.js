/// <reference path="../pb_data/types.d.ts" />
// Plato: physical activity log (spec "Feature: Patient activity dashboard", slice 1).
// Same shape and lock as meal_logs: the patient creates their own; the nutritionist only marks "seen".
// Field checks the rules cannot express (date window, "Otra" name, details per activity) are in pb_hooks/plato.pb.js.
// Undo (ask first, it deletes activity data): docker exec pocketbase /pb/pocketbase migrate down 1

migrate((app) => {
  const patients = app.findCollectionByNameOrId("patients");
  const activity = new Collection({
    type: "base",
    name: "activity_logs",
    fields: [
      { name: "patient", type: "relation", required: true, maxSelect: 1, collectionId: patients.id, cascadeDelete: true },
      { name: "date", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      { name: "kind", type: "select", required: true, maxSelect: 1,
        values: ["walk", "run", "bike", "swim", "gym", "yoga", "dance", "team", "other"] },
      { name: "kind_other", type: "text", max: 60 },
      { name: "minutes", type: "number", required: true, min: 1, max: 600, onlyInt: true },
      { name: "intensity", type: "select", maxSelect: 1, values: ["light", "moderate", "vigorous"] },
      { name: "terrain", type: "select", maxSelect: 1, values: ["flat", "hills", "mixed", "indoor"] },
      { name: "distance_km", type: "number", min: 0.01, max: 300 },
      { name: "note", type: "text", max: 300 },
      { name: "seen_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_activity_patient_date ON activity_logs (patient, date)"],
  });
  app.save(activity);

  const isNutri = '@request.auth.collectionName = "nutritionists"';
  const isPatient = '@request.auth.collectionName = "patients"';
  const nutriOfPatient = `${isNutri} && patient.nutritionist = @request.auth.id`;
  const onlySeen = ["patient", "date", "kind", "kind_other", "minutes", "intensity", "terrain", "distance_km", "note"]
    .map((f) => `@request.body.${f}:isset = false`).join(" && ");

  activity.listRule = `(${isPatient} && patient = @request.auth.id) || (${nutriOfPatient})`;
  activity.viewRule = activity.listRule;
  activity.createRule = `${isPatient} && @request.body.patient = @request.auth.id && @request.body.seen_at:isset = false && @request.auth.archived_at = ""`;
  activity.updateRule = `${nutriOfPatient} && ${onlySeen} && patient.archived_at = ""`;
  activity.deleteRule = `${isPatient} && patient = @request.auth.id && created >= @todayStart && patient.archived_at = ""`;
  app.save(activity);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("activity_logs"));
});
