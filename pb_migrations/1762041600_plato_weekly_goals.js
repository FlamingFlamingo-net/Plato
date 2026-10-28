/// <reference path="../pb_data/types.d.ts" />
// Plato: service + weekly goals (spec "Feature: Weekly goals", slice 2).
// - patients.service: nutrition | training | both. New patients without one get nutrition (the hook; the screen's
//   preselected card), so older screens keep working; it can't be cleared later. Existing patients -> both.
// - Meal goal: meal_goal_per_day (1-5) meals checked a day, meal_goal_days (0 = Sin meta, 1-7) days a week.
// - Activity goal: activity_goal_min (10-300, step 5) minutes a day, activity_goal_days (0 = Sin meta, 1-7).
// - goal_history: set only by pb_hooks/goals.pb.js (one entry per week a goal changed); nobody writes it directly.
// Defaults by service (hook): meals 3 x 5 when nutrition is included, activity 30 min x 5 when training is.
// Undo (ask first): docker exec pocketbase /pb/pocketbase migrate down 1

const NOT_HISTORY = "@request.body.goal_history:isset = false";
const SERVICE_KEEP = '(@request.body.service:isset = false || @request.body.service != "")';

migrate((app) => {
  const p = app.findCollectionByNameOrId("patients");
  p.fields.add(new SelectField({ name: "service", maxSelect: 1, values: ["nutrition", "training", "both"] }));
  p.fields.add(new NumberField({ name: "meal_goal_days", onlyInt: true, min: 0, max: 7 }));
  p.fields.add(new NumberField({ name: "meal_goal_per_day", onlyInt: true, min: 0, max: 5 }));
  p.fields.add(new NumberField({ name: "activity_goal_days", onlyInt: true, min: 0, max: 7 }));
  p.fields.add(new NumberField({ name: "activity_goal_min", onlyInt: true, min: 0, max: 300 }));
  p.fields.add(new JSONField({ name: "goal_history", maxSize: 20000 }));
  p.createRule = `${p.createRule} && ${NOT_HISTORY}`;
  p.updateRule = `${p.updateRule} && ${SERVICE_KEEP} && ${NOT_HISTORY}`;
  app.save(p);

  // Existing patients: both goals on, so nothing disappears; history starts this week (UTC Monday).
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const from = d.toISOString().slice(0, 10);
  for (const r of app.findAllRecords("patients")) {
    r.set("service", "both");
    r.set("meal_goal_days", 5);
    r.set("meal_goal_per_day", 3);
    r.set("activity_goal_days", 5);
    r.set("activity_goal_min", 30);
    r.set("goal_history", [{ from, service: "both", meal_days: 5, meal_per_day: 3, act_days: 5, act_min: 30 }]);
    app.saveNoValidate(r);
  }
}, (app) => {
  const p = app.findCollectionByNameOrId("patients");
  p.createRule = p.createRule.replace(` && ${NOT_HISTORY}`, "");
  p.updateRule = p.updateRule.replace(` && ${SERVICE_KEEP} && ${NOT_HISTORY}`, "");
  for (const f of ["service", "meal_goal_days", "meal_goal_per_day", "activity_goal_days", "activity_goal_min", "goal_history"]) p.fields.removeByName(f);
  app.save(p);
});
