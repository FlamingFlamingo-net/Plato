/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: ingredients get the USDA id and a list of household portions (spec "Plan: USDA FoodData Central").
// fdc_id: the FoodData Central id the row came from (0 = not from USDA), so a later import updates the same food.
// portions: [{ "label": "cup", "grams": 172 }, { "label": "large", "grams": 50 }] (what one cup / one large piece weighs).
// Undo (ask first): /pb/pocketbase migrate down 1

migrate((app) => {
  const c = app.findCollectionByNameOrId("ingredients");
  c.fields.add(new Field({ name: "fdc_id", type: "number", min: 0, max: 99999999, onlyInt: true }));
  c.fields.add(new Field({ name: "portions", type: "json", maxSize: 5000 }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("ingredients");
  c.fields.removeByName("fdc_id");
  c.fields.removeByName("portions");
  app.save(c);
});
