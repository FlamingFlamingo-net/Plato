/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: snacks per diet + meal goal = all planned meals (spec "Feature: Snacks per diet").
// - diets.snacks and diet_templates.snacks: 0-4 colaciones a day (2 by default; existing ones -> 2).
// - meal_logs.slot gains snack_early ("Colación previa al desayuno") and snack_night ("Colación nocturna").
// - Meal goal: a day counts when ALL its planned meals are checked. Past weeks keep their history entries as written;
//   each patient whose current entry still has a number gets an entry from this week's (UTC) Monday with "all".
// Undo (ask first): /pb/pocketbase migrate down 1

const OLD_SLOTS = ["breakfast", "snack_am", "lunch", "snack_pm", "dinner"];

migrate((app) => {
  for (const name of ["diets", "diet_templates"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.add(new NumberField({ name: "snacks", onlyInt: true, min: 0, max: 4 }));
    app.save(c);
    for (const r of app.findAllRecords(name)) { r.set("snacks", 2); app.saveNoValidate(r); }
  }

  const logs = app.findCollectionByNameOrId("meal_logs");
  logs.fields.getByName("slot").values = ["snack_early", ...OLD_SLOTS, "snack_night", "extra"];
  app.save(logs);

  const d = new Date();
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  const monday = d.toISOString().slice(0, 10);
  for (const p of app.findAllRecords("patients")) {
    let hist = [];
    try { hist = JSON.parse(p.getString("goal_history") || "[]") || []; } catch (_) { hist = []; }
    const last = hist.length ? hist[hist.length - 1] : null;
    if (last && last.meal_per_day === "all") continue;
    const en = {
      from: monday, service: p.getString("service"),
      meal_days: p.getInt("meal_goal_days"), meal_per_day: "all",
      act_days: p.getInt("activity_goal_days"), act_min: p.getInt("activity_goal_min"),
    };
    hist = hist.filter((h) => h && h.from !== monday).concat([en]).sort((a, b) => (a.from < b.from ? -1 : 1));
    p.set("goal_history", hist);
    app.saveNoValidate(p);
  }
}, (app) => {
  for (const name of ["diets", "diet_templates"]) {
    const c = app.findCollectionByNameOrId(name);
    c.fields.removeByName("snacks");
    app.save(c);
  }
  const logs = app.findCollectionByNameOrId("meal_logs");
  logs.fields.getByName("slot").values = ["snack_early", ...OLD_SLOTS, "snack_night", "extra"];   // kept: logs may use them
  app.save(logs);
});
