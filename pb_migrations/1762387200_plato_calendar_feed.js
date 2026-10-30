/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: Google Calendar subscription link (spec "Feature: Agenda", Slice 2).
// calendar_feeds: one per nutritionist; the secret token of their calendar address. Own collection (like the
// private notes) so patients, who can read their nutritionist's profile, never see it. Only the nutritionist reads
// it; only the server writes it (routes in pb_hooks/calendar.pb.js).
// Undo (ask first): /pb/pocketbase migrate down 1

migrate((app) => {
  const nutris = app.findCollectionByNameOrId("nutritionists");
  const own = '@request.auth.collectionName = "nutritionists" && nutritionist = @request.auth.id';
  const c = new Collection({
    type: "base",
    name: "calendar_feeds",
    fields: [
      { name: "nutritionist", type: "relation", required: true, collectionId: nutris.id, maxSelect: 1, cascadeDelete: true },
      { name: "token", type: "text", required: true, min: 40, max: 80 },
      { name: "enabled", type: "bool" },
      { name: "created", type: "autodate", onCreate: true },
      { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
    ],
    indexes: [
      "CREATE UNIQUE INDEX idx_calfeed_nutri ON calendar_feeds (nutritionist)",
      "CREATE UNIQUE INDEX idx_calfeed_token ON calendar_feeds (token)",
    ],
    listRule: own,
    viewRule: own,
    createRule: null,
    updateRule: null,
    deleteRule: null,
  });
  app.save(c);
}, (app) => {
  app.delete(app.findCollectionByNameOrId("calendar_feeds"));
});
