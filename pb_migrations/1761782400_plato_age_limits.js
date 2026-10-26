/// <reference path="../pb_data/types.d.ts" />
// Plato: age limits (spec "Feature: Age limits").
// - A new patient needs a birth date; an existing one cannot be cleared. (Not a required field, so older
//   patients without one still save; the progress-photo hook treats them as minors.)
// - Progress photos are refused under 18: pb_hooks/progress.pb.js computes the age at each upload.
// Undo (ask first): docker exec pocketbase /pb/pocketbase migrate down 1

migrate((app) => {
  const p = app.findCollectionByNameOrId("patients");
  p.createRule = `${p.createRule} && @request.body.birth_date != ""`;
  p.updateRule = `${p.updateRule} && (@request.body.birth_date:isset = false || @request.body.birth_date != "")`;
  app.save(p);
}, (app) => {
  const p = app.findCollectionByNameOrId("patients");
  p.createRule = p.createRule.replace(' && @request.body.birth_date != ""', "");
  p.updateRule = p.updateRule.replace(' && (@request.body.birth_date:isset = false || @request.body.birth_date != "")', "");
  app.save(p);
});
