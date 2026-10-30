/// <reference path="../pb_data/types.d.ts" />
// Weekly goals (spec "Feature: Weekly goals", slice 2): defaults by service, value checks, and goal_history.
// History entry = the goals in force from a week's Monday: { from, service, meal_days, meal_per_day, act_days, act_min }.
// meal_per_day is "all" (every planned meal of the day) since "Snacks per diet"; older entries hold a number.
// "from" is the patient's local Monday, sent by the screen as goal_week (not stored). The server accepts it only
// within the real time-zone limits (UTC+14 / UTC-12); otherwise it uses the UTC Monday.
// (Hooks run in separate JS runtimes: everything is inside the handlers.)

onRecordCreateRequest((e) => {
  const G = require(`${__hooks}/goals_lib.js`);
  const r = e.record;
  const body = e.requestInfo().body || {};
  if (!r.getString("service")) r.set("service", "nutrition");
  const s = r.getString("service");
  const nutri = s === "nutrition" || s === "both", train = s === "training" || s === "both";
  if (body.meal_goal_days === undefined) r.set("meal_goal_days", nutri ? 5 : 0);
  if (body.activity_goal_days === undefined) r.set("activity_goal_days", train ? 5 : 0);
  if (body.activity_goal_min === undefined) r.set("activity_goal_min", 30);
  G.validate(r);
  r.set("goal_history", [G.entry(r, G.weekOf(body.goal_week))]);
  e.next();
}, "patients");

onRecordUpdateRequest((e) => {
  const G = require(`${__hooks}/goals_lib.js`);
  const r = e.record, o = r.original();
  const changed = G.FIELDS.some((f) => String(r.get(f)) !== String(o.get(f)));
  if (changed) {
    G.validate(r);
    let hist = [];
    try { hist = JSON.parse(o.getString("goal_history") || "[]") || []; } catch (_) { hist = []; }
    const en = G.entry(r, G.weekOf((e.requestInfo().body || {}).goal_week));
    hist = hist.filter((h) => h && h.from !== en.from).concat([en]).sort((a, b) => (a.from < b.from ? -1 : 1)).slice(-60);
    r.set("goal_history", hist);
  }
  e.next();
}, "patients");
