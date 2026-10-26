/// <reference path="../pb_data/types.d.ts" />
// Plato: close a patient's account (spec "Feature: Close a patient's account").
// - patients.archived_at: empty = active. Only the hook (pb_hooks/plato.pb.js) sets or clears it.
// - Archived patient = read-only: no new or changed measurements, diet, meal logs or notes.
// - Permanent delete works only on an archived patient (related rows and photos go with it).
// Undo (ask first): docker exec pocketbase /pb/pocketbase migrate down 1

const isNutri = '@request.auth.collectionName = "nutritionists"';
const isPatient = '@request.auth.collectionName = "patients"';
const ownsPatient = `${isNutri} && nutritionist = @request.auth.id`;
const nutriOfPatient = `${isNutri} && patient.nutritionist = @request.auth.id`;
const notSet = (fields) => fields.map((f) => `@request.body.${f}:isset = false`).join(" && ");
const noPatientMove = "@request.body.patient:isset = false";

// Rules as they were before this migration (for down).
const before = {
  patients: {
    create: `${isNutri} && @request.body.nutritionist = @request.auth.id && ${notSet(["joined", "email", "emailVisibility", "verified"])}`,
    update: `${ownsPatient} && ${notSet(["nutritionist", "joined", "email", "emailVisibility", "verified", "password"])}`,
    delete: ownsPatient,
  },
  owned: { // measurements, diets, patient_notes
    create: `${isNutri} && @request.body.patient.nutritionist = @request.auth.id`,
    update: `${nutriOfPatient} && ${noPatientMove}`,
    delete: nutriOfPatient,
  },
  meal_logs: {
    create: `${isPatient} && @request.body.patient = @request.auth.id && @request.body.seen_at:isset = false`,
    update: `${nutriOfPatient} && ${noPatientMove} && @request.body.photo:isset = false && @request.body.note:isset = false && @request.body.date:isset = false && @request.body.slot:isset = false`,
    delete: `${isPatient} && patient = @request.auth.id && created >= @todayStart`,
  },
};

const active = 'patient.archived_at = ""';
const bodyActive = '@request.body.patient.archived_at = ""';

function apply(app, r) {
  const p = app.findCollectionByNameOrId("patients");
  p.createRule = r.patients.create;
  p.updateRule = r.patients.update;
  p.deleteRule = r.patients.delete;
  app.save(p);
  for (const name of ["measurements", "diets", "patient_notes"]) {
    const c = app.findCollectionByNameOrId(name);
    c.createRule = r.owned.create;
    c.updateRule = r.owned.update;
    c.deleteRule = r.owned.delete;
    app.save(c);
  }
  const m = app.findCollectionByNameOrId("meal_logs");
  m.createRule = r.meal_logs.create;
  m.updateRule = r.meal_logs.update;
  m.deleteRule = r.meal_logs.delete;
  app.save(m);
}

migrate((app) => {
  const patients = app.findCollectionByNameOrId("patients");
  patients.fields.add(new DateField({ name: "archived_at" }));
  app.save(patients);

  apply(app, {
    patients: {
      create: `${before.patients.create} && @request.body.archived_at:isset = false`,
      update: `${before.patients.update} && @request.body.archived_at:isset = false && archived_at = ""`,
      delete: `${ownsPatient} && archived_at != ""`,
    },
    owned: {
      create: `${before.owned.create} && ${bodyActive}`,
      update: `${before.owned.update} && ${active}`,
      delete: `${before.owned.delete} && ${active}`,
    },
    meal_logs: {
      create: `${before.meal_logs.create} && @request.auth.archived_at = ""`,
      update: `${before.meal_logs.update} && ${active}`,
      delete: `${before.meal_logs.delete} && ${active}`,
    },
  });
}, (app) => {
  apply(app, before);
  const patients = app.findCollectionByNameOrId("patients");
  patients.fields.removeByName("archived_at");
  app.save(patients);
});
