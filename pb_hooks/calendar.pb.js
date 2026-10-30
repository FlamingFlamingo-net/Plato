/// <reference path="../pb_data/types.d.ts" />
// Google Calendar subscription link (spec "Feature: Agenda", Slice 2). Helpers in calendar_lib.js.
//   POST /api/plato/calendar/enable    nutritionist → turns the address on (keeps the token if there is one)
//   POST /api/plato/calendar/rotate    nutritionist → new token: the old address stops working at once
//   POST /api/plato/calendar/disable   nutritionist → no address works
//   GET  /api/plato/calendar/{file}    no sign-in (Google fetches it): "<token>.ics" of an enabled feed, else 404
// The file never holds private notes or cancelled appointments; range: 30 days back to 12 months ahead.

routerAdd("POST", "/api/plato/calendar/enable", (e) => {
  const L = require(`${__hooks}/calendar_lib.js`);
  const me = L.nutritionist(e);
  let f = L.feedOf(e.app, me.id);
  if (!f) {
    f = new Record(e.app.findCollectionByNameOrId("calendar_feeds"));
    f.set("nutritionist", me.id);
    f.set("token", $security.randomString(48));
  }
  f.set("enabled", true);
  e.app.save(f);
  return e.json(200, { token: f.getString("token"), enabled: true });
});

routerAdd("POST", "/api/plato/calendar/rotate", (e) => {
  const L = require(`${__hooks}/calendar_lib.js`);
  const me = L.nutritionist(e);
  let f = L.feedOf(e.app, me.id);
  if (!f) {
    f = new Record(e.app.findCollectionByNameOrId("calendar_feeds"));
    f.set("nutritionist", me.id);
  }
  f.set("token", $security.randomString(48));
  f.set("enabled", true);
  e.app.save(f);
  return e.json(200, { token: f.getString("token"), enabled: true });
});

routerAdd("POST", "/api/plato/calendar/disable", (e) => {
  const L = require(`${__hooks}/calendar_lib.js`);
  const me = L.nutritionist(e);
  const f = L.feedOf(e.app, me.id);
  if (f) { f.set("enabled", false); e.app.save(f); }
  return e.json(200, { enabled: false });
});

routerAdd("GET", "/api/plato/calendar/{file}", (e) => {
  const L = require(`${__hooks}/calendar_lib.js`);
  const m = /^([A-Za-z0-9]{40,80})\.ics$/.exec(e.request.pathValue("file") || "");
  if (!m) throw new NotFoundError("No encontrado.");
  let f = null;
  try { f = e.app.findFirstRecordByFilter("calendar_feeds", "token = {:t} && enabled = true", { t: m[1] }); } catch (_) { f = null; }
  if (!f) throw new NotFoundError("No encontrado.");
  const proto = e.request.header.get("X-Forwarded-Proto") || (e.request.tls ? "https" : "http");
  const origin = `${proto}://${e.request.host}`;
  e.response.header().set("Cache-Control", "no-store");
  return e.blob(200, "text/calendar; charset=utf-8", L.feedText(e.app, f.getString("nutritionist"), origin));
});
