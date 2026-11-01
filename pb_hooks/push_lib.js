/// <reference path="../pb_data/types.d.ts" />
// Helpers for pb_hooks/push.pb.js (required inside each handler). Web push itself ($webpush) is Go: main.go/webpush.go.

const MIN = 60000, HOUR = 3600000, DAY = 86400000;
const SUBJECT = "https://aht-fitness.fly.dev";   // VAPID contact: the app's address (no email in v1)

const pbDate = (s) => new Date(String(s).replace(" ", "T"));
const pbIso = (d) => d.toISOString().replace("T", " ");

// Only real push services: the server never posts to any other address.
// PLATO_PUSH_TEST_HOST is set only on throwaway test servers (a fake push service over plain http).
function allowedEndpoint(url) {
  const s = String(url || "");
  const test = $os.getenv("PLATO_PUSH_TEST_HOST");
  if (test && s.startsWith(`http://${test}/`)) return true;
  const m = /^https:\/\/([a-z0-9.-]+)(:443)?\/[^\s]*$/i.exec(s);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return host === "fcm.googleapis.com" || host === "android.googleapis.com"
    || host === "web.push.apple.com" || host.endsWith(".push.apple.com")
    || host === "updates.push.services.mozilla.com" || host.endsWith(".push.services.mozilla.com")
    || host.endsWith(".notify.windows.com");
}
// Browser keys: p256dh = 65-byte point (87 base64url chars), auth = 16 bytes (22 chars).
const validKeys = (p256dh, auth) => /^[A-Za-z0-9_-]{87}=?$/.test(String(p256dh || "")) && /^[A-Za-z0-9_-]{22}(==)?$/.test(String(auth || ""));

// The server's key pair, made once.
function keys(app) {
  try {
    const k = app.findFirstRecordByFilter("push_keys", "id != ''");
    return { publicKey: k.getString("public_key"), privateKey: k.getString("private_key") };
  } catch (_) { /* first use */ }
  const g = $webpush.generateKeys();
  if (g.error) throw new Error(`push keys: ${g.error}`);
  const r = new Record(app.findCollectionByNameOrId("push_keys"));
  r.set("public_key", g.publicKey);
  r.set("private_key", g.privateKey);
  app.save(r);
  return { publicKey: g.publicKey, privateKey: g.privateKey };
}

// One notification to every phone of the appointment's patient. kind: day | hour | moved | cancelled.
// The message holds no names, no notes: the phone writes the text (pb_public/sw.js).
function notify(app, appt, kind, now) {
  const subs = app.findRecordsByFilter("push_subscriptions", "patient = {:p}", "", 20, 0, { p: appt.getString("patient") });
  if (!subs.length) return { sent: 0, gone: 0 };
  let zone = "";
  try { zone = app.findRecordById("nutritionists", appt.getString("nutritionist")).getString("timezone"); } catch (_) { zone = ""; }
  const start = pbDate(appt.getString("starts_at"));
  const payload = JSON.stringify({ v: 1, kind, id: appt.id, at: start.toISOString(), minutes: appt.getInt("duration_min"), type: appt.getString("type"), zone });
  const k = keys(app);
  let sent = 0, gone = 0;
  for (const s of subs) {
    if (!allowedEndpoint(s.getString("endpoint"))) { app.delete(s); gone++; continue; }
    const r = $webpush.send({
      endpoint: s.getString("endpoint"), p256dh: s.getString("p256dh"), auth: s.getString("auth"), payload,
      publicKey: k.publicKey, privateKey: k.privateKey, subject: SUBJECT,
      ttl: Math.max(60, Math.floor((start.getTime() - now.getTime()) / 1000)), urgency: kind === "hour" ? "high" : "normal",
    });
    const status = Number(r.status);
    if (status === 404 || status === 410) { app.delete(s); gone++; continue; }   // the phone unsubscribed or was reset
    if (status >= 200 && status < 300) sent++;
    else app.logger().warn("push not accepted", "status", status, "error", String(r.error || ""), "body", String(r.body || "").slice(0, 120));
  }
  return { sent, gone };
}

// The job: reminders due at `now` (every 5 minutes; also POST /api/plato/push/run for superusers).
// Day-before: from 24 h before, if the appointment existed (unchanged) 24 h before and starts in more than 1 hour.
// One hour before: from 60 min before, if it existed (unchanged) 60 min before. Each one only once.
function runDue(app, now) {
  const out = [];
  const base = "cancelled_at = '' && patient.archived_at = '' && starts_at > {:now}";
  const due = (field, filter, params) => app.findRecordsByFilter("appointments", `${base} && ${field} = '' && ${filter}`, "starts_at", 500, 0, { now: pbIso(now), ...params });

  for (const a of due("reminded_day_at", "starts_at > {:hour} && starts_at <= {:day}", { hour: pbIso(new Date(now.getTime() + HOUR)), day: pbIso(new Date(now.getTime() + DAY)) })) {
    const start = pbDate(a.getString("starts_at")).getTime();
    const late = pbDate(a.getString("changed_at")).getTime() > start - DAY;   // made or moved less than 24 h before
    const r = late ? null : notify(app, a, "day", now);
    a.set("reminded_day_at", pbIso(now));
    app.save(a);
    out.push({ id: a.id, kind: "day", skipped: late, ...(r || {}) });
  }
  for (const a of due("reminded_hour_at", "starts_at <= {:hour}", { hour: pbIso(new Date(now.getTime() + HOUR)) })) {
    const start = pbDate(a.getString("starts_at")).getTime();
    const late = pbDate(a.getString("changed_at")).getTime() > start - HOUR;
    const r = late ? null : notify(app, a, "hour", now);
    a.set("reminded_hour_at", pbIso(now));
    app.save(a);
    out.push({ id: a.id, kind: "hour", skipped: late, ...(r || {}) });
  }
  return out;
}

module.exports = { allowedEndpoint, validKeys, keys, notify, runDue, pbDate, pbIso };
