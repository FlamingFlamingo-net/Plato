/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: ingredients + tags (spec "Feature: Ingredients, slice (a)", incl. "Tags").
// ingredients: platform data per 100 g, loaded by the owner with tools/load_ingredients.py; nutritionists only read.
// tags: platform tags (nutritionist empty, from a dataset) and each nutritionist's own tags (private).
// item_tags: which tag is on which item. One link = one item; nothing is inherited between levels.
// Undo (ask first, it deletes ingredients and tags): /pb/pocketbase migrate down 1

migrate((app) => {
  const nutritionists = app.findCollectionByNameOrId("nutritionists");
  const nutri = '@request.auth.collectionName = "nutritionists"';

  const ingredients = new Collection({
    type: "base",
    name: "ingredients",
    fields: [
      { name: "name", type: "text", required: true, min: 1, max: 120 },
      { name: "state", type: "select", required: true, maxSelect: 1, values: ["crudo", "cocido", "otro"] },
      { name: "kcal", type: "number", min: 0, max: 1000 },
      { name: "protein_g", type: "number", min: 0, max: 100 },
      { name: "fat_g", type: "number", min: 0, max: 100 },
      { name: "carbs_g", type: "number", min: 0, max: 100 },
      { name: "fiber_g", type: "number", min: 0, max: 100 },
      { name: "extra", type: "json", maxSize: 5000 },
      { name: "piece_g", type: "number", min: 0, max: 5000 },
      { name: "density_g_ml", type: "number", min: 0, max: 5 },
      { name: "groups", type: "json", maxSize: 2000 },
      { name: "dataset", type: "text", required: true, min: 1, max: 40 },
      { name: "source", type: "text", max: 200 },
      { name: "version", type: "text", max: 40 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_ingredients_key ON ingredients (dataset, name, state)", "CREATE INDEX idx_ingredients_name ON ingredients (name)"],
    listRule: nutri,
    viewRule: nutri,
    createRule: null, updateRule: null, deleteRule: null,   // owner (admin) only
  });
  app.save(ingredients);

  const tags = new Collection({
    type: "base",
    name: "tags",
    fields: [
      { name: "name", type: "text", required: true, min: 1, max: 30 },
      { name: "norm", type: "text", hidden: true, max: 60 },
      { name: "nutritionist", type: "relation", maxSelect: 1, collectionId: nutritionists.id, cascadeDelete: true },   // empty = platform tag
      { name: "dataset", type: "text", max: 40 },                                                                      // platform tags: the dataset they came with
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_tags_owner_norm ON tags (nutritionist, norm)"],
    listRule: `${nutri} && (nutritionist = "" || nutritionist = @request.auth.id)`,
    viewRule: `${nutri} && (nutritionist = "" || nutritionist = @request.auth.id)`,
    createRule: `${nutri} && @request.body.nutritionist = @request.auth.id && @request.body.dataset:isset = false`,
    updateRule: null,
    deleteRule: `${nutri} && nutritionist = @request.auth.id`,
  });
  app.save(tags);

  const links = new Collection({
    type: "base",
    name: "item_tags",
    fields: [
      { name: "tag", type: "relation", required: true, maxSelect: 1, collectionId: tags.id, cascadeDelete: true },
      { name: "nutritionist", type: "relation", maxSelect: 1, collectionId: nutritionists.id, cascadeDelete: true },   // empty = platform link
      { name: "kind", type: "select", required: true, maxSelect: 1, values: ["ingredient", "template"] },
      { name: "item", type: "text", required: true, min: 15, max: 15 },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
    ],
    indexes: ["CREATE UNIQUE INDEX idx_item_tags_key ON item_tags (nutritionist, tag, kind, item)", "CREATE INDEX idx_item_tags_item ON item_tags (kind, item)"],
    listRule: `${nutri} && (nutritionist = "" || nutritionist = @request.auth.id)`,
    viewRule: `${nutri} && (nutritionist = "" || nutritionist = @request.auth.id)`,
    createRule: `${nutri} && @request.body.nutritionist = @request.auth.id`,
    updateRule: null,
    deleteRule: `${nutri} && nutritionist = @request.auth.id`,
  });
  app.save(links);
}, (app) => {
  for (const n of ["item_tags", "tags", "ingredients"]) app.delete(app.findCollectionByNameOrId(n));
});
