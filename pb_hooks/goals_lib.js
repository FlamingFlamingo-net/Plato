/// <reference path="../pb_data/types.d.ts" />
// Shared helpers for pb_hooks/goals.pb.js (required inside each handler).

const FIELDS = ["service", "meal_goal_days", "activity_goal_days", "activity_goal_min"];
const H = 3600e3;
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const mondayOf = (s) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return ymd(d.getTime()); };

// The patient's local Monday if plausible, else the UTC Monday.
function weekOf(sent) {
  const now = Date.now();
  if (typeof sent === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sent) && mondayOf(sent) === sent) {
    const lo = mondayOf(ymd(now - 12 * H)), hi = mondayOf(ymd(now + 14 * H));
    if (sent >= lo && sent <= hi) return sent;
  }
  return mondayOf(ymd(now));
}

function validate(r) {
  const n = (f) => r.getInt(f);
  if (n("meal_goal_days") < 0 || n("meal_goal_days") > 7 || n("activity_goal_days") < 0 || n("activity_goal_days") > 7)
    throw new BadRequestError("Los días a la semana van de 1 a 7 (o sin meta).");
  const m = n("activity_goal_min");
  if (n("activity_goal_days") > 0 && (m < 10 || m > 300 || m % 5 !== 0))
    throw new BadRequestError("Los minutos al día van de 10 a 300, de 5 en 5.");
}

const entry = (r, from) => ({
  from, service: r.getString("service"),
  // Meal goal = all the day's planned meals (spec "Snacks per diet"); older entries keep their number.
  meal_days: r.getInt("meal_goal_days"), meal_per_day: "all",
  act_days: r.getInt("activity_goal_days"), act_min: r.getInt("activity_goal_min"),
});

module.exports = { FIELDS, weekOf, validate, entry };
