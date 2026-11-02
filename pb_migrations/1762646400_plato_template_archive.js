/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: archive diet templates (spec "Feature: Archive and restore catalogue items").
// diet_templates.archived_at: empty = active. Set to the server's time by pb_hooks/catalog.pb.js; the existing
// rules (only the owner nutritionist) cover archiving and restoring.
// Undo (ask first): /pb/pocketbase migrate down 1

migrate((app) => {
  const c = app.findCollectionByNameOrId("diet_templates");
  c.fields.add(new DateField({ name: "archived_at" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("diet_templates");
  c.fields.removeByName("archived_at");
  app.save(c);
});
