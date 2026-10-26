/// <reference path="../pb_data/types.d.ts" />
// Plato: saved diet templates (spec "Feature: Saved diet templates").
// A template is a diet with no patient: same `meals` shape (days 1-7 x meal slots, free text).
// Private to the nutritionist who made it. Using one copies it into a patient's diet (on screen).
// Undo (ask first, it deletes templates): docker exec pocketbase /pb/pocketbase migrate down 1

migrate((app) => {
  const nutritionists = app.findCollectionByNameOrId("nutritionists");
  const templates = new Collection({
    type: "base",
    name: "diet_templates",
    fields: [
      { name: "nutritionist", type: "relation", required: true, maxSelect: 1, collectionId: nutritionists.id, cascadeDelete: true },
      { name: "title", type: "text", required: true, min: 1, max: 120 },
      { name: "meals", type: "json", maxSize: 50000 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    // One name per nutritionist: saving again with the same name is "replace" or "save as a copy" (screen asks).
    indexes: ["CREATE UNIQUE INDEX idx_templates_owner_title ON diet_templates (nutritionist, title)"],
  });
  app.save(templates);

  const owner = 'nutritionist = @request.auth.id && @request.auth.collectionName = "nutritionists"';
  templates.listRule = owner;
  templates.viewRule = owner;
  templates.createRule = '@request.auth.collectionName = "nutritionists" && @request.body.nutritionist = @request.auth.id';
  templates.updateRule = `${owner} && @request.body.nutritionist:isset = false`;
  templates.deleteRule = owner;
  app.save(templates);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("diet_templates"));
});
