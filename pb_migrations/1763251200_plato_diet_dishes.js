/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: diets using dishes, slice (c) (spec "Feature: Diets using dishes, slice (c)").
// - diets and diet_templates: plan (dishes x servings per day and meal) and plan_calc (snapshots and totals, written by the server)
// - patients.show_numbers: the nutritionist's switch for showing calories and macros to that patient (off by default)
// Undo (ask first, it deletes plans): /pb/pocketbase migrate down 1

migrate((app) => {
  for (const name of ["diets", "diet_templates"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.add(new JSONField({ name: "plan", maxSize: 60000 }));
    c.fields.add(new JSONField({ name: "plan_calc", maxSize: 120000 }));
    app.save(c);
  }
  const p = app.findCollectionByNameOrId("patients");
  p.fields.add(new BoolField({ name: "show_numbers" }));
  app.save(p);
}, (app) => {
  for (const name of ["diets", "diet_templates"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.removeByName("plan");
    c.fields.removeByName("plan_calc");
    app.save(c);
  }
  const p = app.findCollectionByNameOrId("patients");
  p.fields.removeByName("show_numbers");
  app.save(p);
});
