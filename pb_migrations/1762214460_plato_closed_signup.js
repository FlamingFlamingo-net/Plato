/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: nutritionist accounts are created by the admin (owner, 2026-10-29), not by public sign-up.
// createRule null = only a superuser (admin screen /_/) can create a nutritionist. Patients still join
// through their nutritionist's invite link (the /api/plato/ invite routes, unchanged).
// Undo (ask first): /pb/pocketbase migrate down 1

migrate((app) => {
  const n = app.findCollectionByNameOrId("nutritionists");
  n.createRule = null;
  app.save(n);
}, (app) => {
  const n = app.findCollectionByNameOrId("nutritionists");
  n.createRule = "";
  app.save(n);
});
