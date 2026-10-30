/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: agenda, slice 1 (spec "Feature: Agenda — the nutritionist's own calendar").
// - appointments: made by the nutritionist, bound to one of their patients. The patient can READ their own
//   (time, duration, type, cancelled), never change anything.
// - appointment_notes: the nutritionist's private note for an appointment, in its own collection so a patient
//   can't read it or even filter by it.
// - nutritionists.appointment_types: the consultation types [{ name, minutes }] (editable in Ajustes).
// Hook: pb_hooks/agenda.pb.js (durations, changed_at, server time for cancellations).
// Undo (ask first): docker exec pocketbase /pb/pocketbase migrate down 1

// The client's consultation types; minutes = default duration (the longest he gave for each).
const TYPES = [
  { name: "Consulta nutricional inicial", minutes: 60 },
  { name: "Consulta nutricional seguimiento", minutes: 60 },
  { name: "Consulta de entrenamiento", minutes: 60 },
  { name: "Consulta de mediciones", minutes: 30 },
  { name: "Consulta de alto rendimiento deportivo", minutes: 90 },
];

migrate((app) => {
  const nutris = app.findCollectionByNameOrId("nutritionists");
  const patients = app.findCollectionByNameOrId("patients");
  const isNutri = '@request.auth.collectionName = "nutritionists"';
  const isPatient = '@request.auth.collectionName = "patients"';

  const appts = new Collection({
    type: "base",
    name: "appointments",
    fields: [
      { name: "nutritionist", type: "relation", required: true, collectionId: nutris.id, maxSelect: 1, cascadeDelete: true },
      { name: "patient", type: "relation", required: true, collectionId: patients.id, maxSelect: 1, cascadeDelete: true },
      { name: "starts_at", type: "date", required: true },
      { name: "duration_min", type: "number", required: true, onlyInt: true, min: 15, max: 240 },
      { name: "type", type: "text", required: true, max: 80 },
      { name: "cancelled_at", type: "date" },
      { name: "changed_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_appt_nutri_start ON appointments (nutritionist, starts_at)", "CREATE INDEX idx_appt_patient_start ON appointments (patient, starts_at)"],
    listRule: `(${isNutri} && nutritionist = @request.auth.id) || (${isPatient} && patient = @request.auth.id)`,
    viewRule: `(${isNutri} && nutritionist = @request.auth.id) || (${isPatient} && patient = @request.auth.id)`,
    createRule: `${isNutri} && @request.body.nutritionist = @request.auth.id && @request.body.patient.nutritionist = @request.auth.id && @request.body.patient.archived_at = "" && @request.body.changed_at:isset = false`,
    updateRule: `${isNutri} && nutritionist = @request.auth.id && patient.archived_at = "" && @request.body.nutritionist:isset = false && @request.body.changed_at:isset = false && (@request.body.patient:isset = false || (@request.body.patient.nutritionist = @request.auth.id && @request.body.patient.archived_at = ""))`,
    deleteRule: `${isNutri} && nutritionist = @request.auth.id`,
  });
  app.save(appts);

  const notes = new Collection({
    type: "base",
    name: "appointment_notes",
    fields: [
      { name: "appointment", type: "relation", required: true, collectionId: appts.id, maxSelect: 1, cascadeDelete: true },
      { name: "nutritionist", type: "relation", required: true, collectionId: nutris.id, maxSelect: 1, cascadeDelete: true },
      { name: "text", type: "text", max: 1000 },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_appt_note_one ON appointment_notes (appointment)"],
    listRule: `${isNutri} && nutritionist = @request.auth.id`,
    viewRule: `${isNutri} && nutritionist = @request.auth.id`,
    createRule: `${isNutri} && @request.body.nutritionist = @request.auth.id && @request.body.appointment.nutritionist = @request.auth.id`,
    updateRule: `${isNutri} && nutritionist = @request.auth.id && @request.body.nutritionist:isset = false && @request.body.appointment:isset = false`,
    deleteRule: `${isNutri} && nutritionist = @request.auth.id`,
  });
  app.save(notes);

  nutris.fields.add(new JSONField({ name: "appointment_types", maxSize: 5000 }));
  app.save(nutris);
  for (const r of app.findAllRecords("nutritionists")) {
    r.set("appointment_types", TYPES);
    app.saveNoValidate(r);
  }
}, (app) => {
  app.delete(app.findCollectionByNameOrId("appointment_notes"));
  app.delete(app.findCollectionByNameOrId("appointments"));
  const nutris = app.findCollectionByNameOrId("nutritionists");
  nutris.fields.removeByName("appointment_types");
  app.save(nutris);
});
