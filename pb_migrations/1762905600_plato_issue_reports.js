/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: "Reportar un problema" (spec "Feature: Reportar un problema").
// issue_reports: a nutritionist reports a problem to the owner (superuser, admin panel). The nutritionist creates and
// reads only their own; nobody but the superuser changes or deletes one. Contact details only with contact_ok
// (pb_hooks/report.pb.js clears them otherwise, normalises them, and limits 10 reports per 24 h).
// Undo (ask first): /pb/pocketbase migrate down 1

migrate((app) => {
  const nutritionists = app.findCollectionByNameOrId("nutritionists");
  const mine = '@request.auth.collectionName = "nutritionists" && nutritionist = @request.auth.id';
  const c = new Collection({
    type: "base",
    name: "issue_reports",
    fields: [
      { name: "description", type: "text", required: true, min: 10, max: 2000 },
      { name: "status", type: "select", required: true, maxSelect: 1, values: ["nuevo", "en_revision", "resuelto"] },
      { name: "images", type: "file", maxSelect: 3, maxSize: 5242880, protected: true,
        mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["200x200"] },
      { name: "contact_ok", type: "bool" },
      { name: "contact_phone", type: "text", max: 20, pattern: "^(\\+?[0-9]{10,15})?$" },
      { name: "contact_email", type: "email" },
      { name: "page", type: "text", max: 200 },
      { name: "app_version", type: "text", max: 20 },
      { name: "user_agent", type: "text", max: 400 },
      { name: "owner_note", type: "text", max: 5000, hidden: true },
      { name: "nutritionist", type: "relation", required: true, maxSelect: 1, collectionId: nutritionists.id, cascadeDelete: true },
      { name: "created", type: "autodate", onCreate: true, onUpdate: false },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: ["CREATE INDEX idx_issue_reports_nutri ON issue_reports (nutritionist, created)"],
    listRule: mine,
    viewRule: mine,
    createRule: '@request.auth.collectionName = "nutritionists" && @request.body.nutritionist = @request.auth.id'
      + ' && @request.body.status:isset = false && @request.body.owner_note:isset = false',
    updateRule: null,
    deleteRule: null,
  });
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("issue_reports"));
});
