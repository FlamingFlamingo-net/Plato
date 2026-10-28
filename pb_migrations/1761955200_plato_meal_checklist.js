/// <reference path="../pb_data/types.d.ts" />
// Plato: today's meals as a checklist (spec "Feature: Weekly goals", slice 1).
// - A meal log no longer needs a photo: a log without photo on a planned slot = "lo comí" (a check).
// - New slot "extra" (something outside the diet): needs a photo or a note (checked by pb_hooks/meals.pb.js).
// - The patient may add a photo to their own check later (only the photo and the note; only while it has none).
// Undo (ask first): docker exec pocketbase /pb/pocketbase migrate down 1

const SLOTS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

migrate((app) => {
  const m = app.findCollectionByNameOrId("meal_logs");
  m.fields.getByName("photo").required = false;
  m.fields.getByName("slot").values = [...SLOTS, "extra"];
  const isPatient = '@request.auth.collectionName = "patients"';
  const locked = ["patient", "date", "slot", "seen_at", "feedback_text", "feedback_stars", "feedback_at", "feedback_edited"]
    .map((f) => `@request.body.${f}:isset = false`).join(" && ");
  const attachPhoto = `(${isPatient} && patient = @request.auth.id && patient.archived_at = "" && photo = "" && slot != "extra" && ${locked})`;
  m.updateRule = `(${m.updateRule}) || ${attachPhoto}`;
  app.save(m);
}, (app) => {
  const m = app.findCollectionByNameOrId("meal_logs");
  // Checks and extras cannot exist with the old schema: remove them first.
  for (const r of app.findRecordsByFilter("meal_logs", 'photo = "" || slot = "extra"', "", 0, 0)) app.delete(r);
  m.fields.getByName("photo").required = true;
  m.fields.getByName("slot").values = SLOTS;
  const rule = m.updateRule;
  const cut = rule.indexOf(") || (");
  m.updateRule = cut > 0 ? rule.slice(1, cut) : rule;
  app.save(m);
});
