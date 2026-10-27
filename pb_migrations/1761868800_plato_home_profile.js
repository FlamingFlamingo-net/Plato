/// <reference path="../pb_data/types.d.ts" />
// Plato: the nutritionist's home (spec "Feature: Patient activity dashboard", slice 3).
// Banner = the nutritionist's own photo with live text on top (upgrade 1): name and clinic already exist;
// this adds the cover photo and two contact fields. Edited by the nutritionist in Ajustes (update rule: own record).
// Undo (ask first): docker exec pocketbase /pb/pocketbase migrate down 1

migrate((app) => {
  const n = app.findCollectionByNameOrId("nutritionists");
  n.fields.add(new FileField({ name: "cover", maxSelect: 1, maxSize: 5242880, protected: true,
    mimeTypes: ["image/jpeg", "image/png", "image/webp"], thumbs: ["1600x0"] }));
  n.fields.add(new TextField({ name: "whatsapp", max: 20, pattern: "^[0-9 +()-]*$" }));
  n.fields.add(new TextField({ name: "instagram", max: 31, pattern: "^@?[A-Za-z0-9._]*$" }));
  app.save(n);
}, (app) => {
  const n = app.findCollectionByNameOrId("nutritionists");
  for (const f of ["cover", "whatsapp", "instagram"]) n.fields.removeByName(f);
  app.save(n);
});
