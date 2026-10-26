/// <reference path="../pb_data/types.d.ts" />
// Plato: progress photos (spec "Feature: Patient activity dashboard", slice 2).
// - progress_photos: the patient uploads their own (private file); the nutritionist only marks "seen".
// - Delete: the nutritionist can always delete one (e.g. the patient asks, or a wrong upload).
//   The patient can delete their own only when their nutritionist turned on nutritionists.allow_progress_delete
//   (off by default) and the account is open.
// The date window is checked in pb_hooks/progress.pb.js.
// Undo (ask first, it deletes progress photos): docker exec pocketbase /pb/pocketbase migrate down 1

migrate((app) => {
  const nutritionists = app.findCollectionByNameOrId("nutritionists");
  nutritionists.fields.add(new BoolField({ name: "allow_progress_delete" }));
  app.save(nutritionists);

  const patients = app.findCollectionByNameOrId("patients");
  const photos = new Collection({
    type: "base",
    name: "progress_photos",
    fields: [
      { name: "patient", type: "relation", required: true, maxSelect: 1, collectionId: patients.id, cascadeDelete: true },
      { name: "date", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      { name: "pose", type: "select", required: true, maxSelect: 1, values: ["front", "side", "back", "other"] },
      { name: "photo", type: "file", required: true, maxSelect: 1, maxSize: 5242880, protected: true,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["400x400"] },
      { name: "note", type: "text", max: 300 },
      { name: "seen_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_progress_patient_date ON progress_photos (patient, date)"],
  });
  app.save(photos);

  const isNutri = '@request.auth.collectionName = "nutritionists"';
  const isPatient = '@request.auth.collectionName = "patients"';
  const nutriOfPatient = `${isNutri} && patient.nutritionist = @request.auth.id`;
  const onlySeen = ["patient", "date", "pose", "photo", "note"].map((f) => `@request.body.${f}:isset = false`).join(" && ");

  photos.listRule = `(${isPatient} && patient = @request.auth.id) || (${nutriOfPatient})`;
  photos.viewRule = photos.listRule;
  photos.createRule = `${isPatient} && @request.body.patient = @request.auth.id && @request.body.seen_at:isset = false && @request.auth.archived_at = ""`;
  photos.updateRule = `${nutriOfPatient} && ${onlySeen} && patient.archived_at = ""`;
  photos.deleteRule = `(${nutriOfPatient}) || (${isPatient} && patient = @request.auth.id && patient.archived_at = "" && patient.nutritionist.allow_progress_delete = true)`;
  app.save(photos);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("progress_photos"));
  const nutritionists = app.findCollectionByNameOrId("nutritionists");
  nutritionists.fields.removeByName("allow_progress_delete");
  app.save(nutritionists);
});
