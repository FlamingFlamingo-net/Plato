/// <reference path="../pb_data/types.d.ts" />
// Plato v1 — collections and access rules. Spec: specs/plato.md (Build notes).
// Undo (ask first, it deletes Plato data): docker exec pocketbase /pb/pocketbase migrate down 1

migrate((app) => {
  const autodates = [
    { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
  ];

  // Nutritionists: public sign-up with email + password.
  const nutritionists = new Collection({
    type: "auth",
    name: "nutritionists",
    fields: [
      { name: "name", type: "text", required: true, max: 120 },
      { name: "clinic_name", type: "text", max: 120 },
      ...autodates,
    ],
  });
  app.save(nutritionists);

  // Patients: created by their nutritionist. They get email + password only via an invite link (hook).
  const patients = new Collection({
    type: "auth",
    name: "patients",
    fields: [
      { name: "name", type: "text", required: true, max: 120 },
      { name: "sex", type: "select", required: true, maxSelect: 1, values: ["female", "male"] },
      { name: "birth_date", type: "date" },
      { name: "height_cm", type: "number", min: 40, max: 250 },
      { name: "nutritionist", type: "relation", required: true, maxSelect: 1, collectionId: nutritionists.id, cascadeDelete: false },
      { name: "joined", type: "bool" },
      ...autodates,
    ],
  });
  app.save(patients); // system auth fields (email, password, …) exist only after the first save
  patients.fields.getByName("email").required = false;
  app.save(patients);

  const patientRel = { name: "patient", type: "relation", required: true, maxSelect: 1, collectionId: patients.id, cascadeDelete: true };

  const invites = new Collection({
    type: "base",
    name: "invites",
    fields: [
      patientRel,
      { name: "token", type: "text", required: true, hidden: true, min: 32, max: 64 },
      { name: "expires", type: "date", required: true },
      { name: "used", type: "bool" },
      ...autodates,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_invites_token ON invites (token)"],
  });
  app.save(invites);

  const measurements = new Collection({
    type: "base",
    name: "measurements",
    fields: [
      patientRel,
      { name: "date", type: "date", required: true },
      { name: "weight_kg", type: "number", required: true, min: 1, max: 400 },
      { name: "body_fat_pct", type: "number", min: 1, max: 80 },
      { name: "waist_cm", type: "number", min: 20, max: 300 },
      ...autodates,
    ],
  });
  app.save(measurements);

  // One diet per patient. meals = { "1": { breakfast, snack_am, lunch, snack_pm, dinner }, … "7": {…} } (1 = Monday).
  const diets = new Collection({
    type: "base",
    name: "diets",
    fields: [
      patientRel,
      { name: "title", type: "text", max: 120 },
      { name: "meals", type: "json", maxSize: 50000 },
      ...autodates,
    ],
    indexes: ["CREATE UNIQUE INDEX idx_diets_patient ON diets (patient)"],
  });
  app.save(diets);

  const mealLogs = new Collection({
    type: "base",
    name: "meal_logs",
    fields: [
      patientRel,
      { name: "date", type: "text", required: true, pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      { name: "slot", type: "select", required: true, maxSelect: 1, values: ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"] },
      { name: "photo", type: "file", required: true, maxSelect: 1, maxSize: 5242880, protected: true,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["400x400"] },
      { name: "note", type: "text", max: 500 },
      { name: "seen_at", type: "date" },
      ...autodates,
    ],
  });
  app.save(mealLogs);

  // Private notes live in their own collection, so no patient rule can ever reach them.
  const notes = new Collection({
    type: "base",
    name: "patient_notes",
    fields: [patientRel, { name: "text", type: "text", required: true, max: 5000 }, ...autodates],
  });
  app.save(notes);

  // ---- Rules (set after the first save; see pocketbase-jsvm notes) ----
  const isNutri = '@request.auth.collectionName = "nutritionists"';
  const isPatient = '@request.auth.collectionName = "patients"';

  nutritionists.listRule = 'id = @request.auth.id || id = @request.auth.nutritionist';
  nutritionists.viewRule = 'id = @request.auth.id || id = @request.auth.nutritionist';
  nutritionists.createRule = "";
  nutritionists.updateRule = "id = @request.auth.id";
  nutritionists.deleteRule = null;
  app.save(nutritionists);

  const ownsPatient = `${isNutri} && nutritionist = @request.auth.id`;
  patients.listRule = `id = @request.auth.id || (${ownsPatient})`;
  patients.viewRule = `id = @request.auth.id || (${ownsPatient})`;
  patients.createRule = `${isNutri} && @request.body.nutritionist = @request.auth.id && @request.body.joined:isset = false`;
  patients.updateRule = `${ownsPatient} && @request.body.nutritionist:isset = false && @request.body.joined:isset = false && @request.body.email:isset = false && @request.body.password:isset = false`;
  patients.deleteRule = ownsPatient;
  app.save(patients);

  // invites: no API access at all; only the hook touches them.
  invites.listRule = invites.viewRule = invites.createRule = invites.updateRule = invites.deleteRule = null;
  app.save(invites);

  const nutriOfPatient = `${isNutri} && patient.nutritionist = @request.auth.id`;
  const readers = `(${isPatient} && patient = @request.auth.id) || (${nutriOfPatient})`;
  const noPatientMove = "@request.body.patient:isset = false";

  for (const c of [measurements, diets]) {
    c.listRule = readers;
    c.viewRule = readers;
    c.createRule = `${isNutri} && @request.body.patient.nutritionist = @request.auth.id`;
    c.updateRule = `${nutriOfPatient} && ${noPatientMove}`;
    c.deleteRule = nutriOfPatient;
    app.save(c);
  }

  mealLogs.listRule = readers;
  mealLogs.viewRule = readers;
  mealLogs.createRule = `${isPatient} && @request.body.patient = @request.auth.id && @request.body.seen_at:isset = false`;
  // Nutritionist may only set seen_at.
  mealLogs.updateRule = `${nutriOfPatient} && ${noPatientMove} && @request.body.photo:isset = false && @request.body.note:isset = false && @request.body.date:isset = false && @request.body.slot:isset = false`;
  // Patient may delete their own log on the same (UTC) day.
  mealLogs.deleteRule = `${isPatient} && patient = @request.auth.id && created >= @todayStart`;
  app.save(mealLogs);

  notes.listRule = nutriOfPatient;
  notes.viewRule = nutriOfPatient;
  notes.createRule = `${isNutri} && @request.body.patient.nutritionist = @request.auth.id`;
  notes.updateRule = `${nutriOfPatient} && ${noPatientMove}`;
  notes.deleteRule = nutriOfPatient;
  app.save(notes);
}, (app) => {
  for (const name of ["patient_notes", "meal_logs", "diets", "measurements", "invites", "patients", "nutritionists"]) {
    try { app.delete(app.findCollectionByNameOrId(name)); } catch (_) { /* already gone */ }
  }
});
