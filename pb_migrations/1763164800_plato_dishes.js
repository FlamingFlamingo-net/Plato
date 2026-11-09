/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: Recetas / dishes, slice b1 (spec "Feature: Recetas (dishes), slice (b)").
// dishes: a nutritionist's own dishes, built from ingredients; nutrition per serving is computed by pb_hooks/dishes.pb.js.
// Tag links can now point at a dish (item_tags.kind = "dish").
// Undo (ask first, it deletes dishes): /pb/pocketbase migrate down 1

migrate((app) => {
  const nutritionists = app.findCollectionByNameOrId("nutritionists");
  const owner = '@request.auth.collectionName = "nutritionists" && nutritionist = @request.auth.id';
  const dishes = new Collection({
    type: "base",
    name: "dishes",
    fields: [
      { name: "nutritionist", type: "relation", required: true, maxSelect: 1, collectionId: nutritionists.id, cascadeDelete: true },
      { name: "name", type: "text", required: true, min: 1, max: 120 },
      { name: "serving_unit", type: "text", required: true, min: 1, max: 30 },
      { name: "multi_serving", type: "bool" },
      { name: "notes", type: "text", max: 1000 },
      { name: "items", type: "json", maxSize: 30000 },
      { name: "nutrition", type: "json", maxSize: 2000 },
      { name: "computed_at", type: "date" },
      { name: "values_updated_at", type: "date" },
      { name: "archived_at", type: "date" },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    // One name per nutritionist (the screen offers "Duplicar", which adds "(copia)").
    indexes: ["CREATE UNIQUE INDEX idx_dishes_owner_name ON dishes (nutritionist, name)"],
    listRule: owner,
    viewRule: owner,
    createRule: '@request.auth.collectionName = "nutritionists" && @request.body.nutritionist = @request.auth.id',
    updateRule: `${owner} && @request.body.nutritionist:isset = false`,
    deleteRule: owner,
  });
  app.save(dishes);

  const links = app.findCollectionByNameOrId("item_tags");
  links.fields.getByName("kind").values = ["ingredient", "template", "dish"];
  app.save(links);
}, (app) => {
  const links = app.findCollectionByNameOrId("item_tags");
  for (const l of app.findRecordsByFilter("item_tags", "kind = 'dish'", "", 5000, 0)) app.delete(l);
  links.fields.getByName("kind").values = ["ingredient", "template"];
  app.save(links);
  app.delete(app.findCollectionByNameOrId("dishes"));
});
