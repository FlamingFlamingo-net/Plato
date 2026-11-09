/// <reference path="../pb_data/types.d.ts" />
// Diets using dishes (spec "Feature: Diets using dishes, slice (c)"): what the collection rules cannot express.
// - diets / diet_templates.plan (dishes x servings per day and meal) is validated and snapshotted on every save (plan_lib.js);
//   plan_calc (the numbers) always belongs to the server: whatever a client sends is replaced
// - a saved diet keeps its snapshots until the nutritionist sends body.plan_refresh (dish ids, or "all")
// - a patient only receives plan_calc when the nutritionist switched numbers on for that patient (patients.show_numbers)
// (Hooks run in separate JS runtimes: the shared helpers are required inside each handler.)

onRecordCreateRequest((e) => {
  const P = require(`${__hooks}/plan_lib.js`);
  const body = e.requestInfo().body || {};
  if (body.snacks === undefined || body.snacks === null || body.snacks === "") e.record.set("snacks", 2);
  const out = P.build(e.app, e.record, null, body.plan_refresh);
  e.record.set("plan", out.plan);
  e.record.set("plan_calc", out.calc);
  e.next();
}, "diets", "diet_templates");

onRecordUpdateRequest((e) => {
  const P = require(`${__hooks}/plan_lib.js`);
  const body = e.requestInfo().body || {};
  const out = P.build(e.app, e.record, e.record.original(), body.plan_refresh);
  e.record.set("plan", out.plan);
  e.record.set("plan_calc", out.calc);
  e.next();
}, "diets", "diet_templates");

onRecordEnrich((e) => {
  try {
    const info = typeof e.requestInfo === "function" ? e.requestInfo() : e.requestInfo;   // a field on this event
    const a = info && info.auth;
    if (a && a.collection().name === "patients" && !a.getBool("show_numbers")) e.record.hide("plan_calc");
  } catch (err) { e.record.hide("plan_calc"); }   // when in doubt, show no numbers
  e.next();
}, "diets");
