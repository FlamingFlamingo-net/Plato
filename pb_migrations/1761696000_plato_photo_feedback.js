/// <reference path="../pb_data/types.d.ts" />
// Plato: photo feedback (spec "Feature: Photo feedback").
// One feedback per photo, stored on the photo record:
//   feedback_text   comment, up to 500 characters (meal and progress photos)
//   feedback_stars  1-3, meal photos only ("Puede mejorar" / "Bien" / "¡Excelente!")
//   feedback_at     when it was last given or changed (set by the hook, never by the client)
//   feedback_edited true after the first change (the patient sees "editada")
// Who can write: the existing update rules already allow only the patient's nutritionist on an open account.
// pb_hooks/feedback.pb.js trims, stamps feedback_at, marks the photo seen, and refuses stars on progress photos.
// Undo (ask first, it deletes all feedback): docker exec pocketbase /pb/pocketbase migrate down 1

migrate((app) => {
  const meals = app.findCollectionByNameOrId("meal_logs");
  meals.fields.add(new TextField({ name: "feedback_text", max: 500 }));
  meals.fields.add(new NumberField({ name: "feedback_stars", min: 1, max: 3, onlyInt: true }));
  meals.fields.add(new DateField({ name: "feedback_at" }));
  meals.fields.add(new BoolField({ name: "feedback_edited" }));
  app.save(meals);

  const progress = app.findCollectionByNameOrId("progress_photos");
  progress.fields.add(new TextField({ name: "feedback_text", max: 500 }));
  progress.fields.add(new DateField({ name: "feedback_at" }));
  progress.fields.add(new BoolField({ name: "feedback_edited" }));
  app.save(progress);
}, (app) => {
  const meals = app.findCollectionByNameOrId("meal_logs");
  for (const f of ["feedback_text", "feedback_stars", "feedback_at", "feedback_edited"]) meals.fields.removeByName(f);
  app.save(meals);
  const progress = app.findCollectionByNameOrId("progress_photos");
  for (const f of ["feedback_text", "feedback_at", "feedback_edited"]) progress.fields.removeByName(f);
  app.save(progress);
});
