/// <reference path="../pb_data/types.d.ts" />
// Helpers for pb_hooks/calendar.pb.js (required inside each handler): the iCalendar file (RFC 5545).

const DAY = 864e5;

// TEXT values: escape backslash, semicolon, comma and newlines.
const esc = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// Fold lines longer than 75 octets (UTF-8), never splitting a character; continuation lines start with a space.
function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const cp = ch.codePointAt(0);
    const n = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    const limit = out.length ? 74 : 75;           // a continuation line spends one octet on the leading space
    if (bytes + n > limit) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += n;
  }
  out.push(cur);
  return out.join("\r\n ");
}

// PocketBase date "2026-11-01 22:00:00.000Z" -> "20261101T220000Z"
const stamp = (d) => new Date(String(d).replace(" ", "T")).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

function feedText(app, nutritionistId, origin) {
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString().replace("T", " ");
  const appts = app.findRecordsByFilter("appointments",
    "nutritionist = {:n} && cancelled_at = '' && starts_at >= {:from} && starts_at <= {:to}", "starts_at", 2000, 0,
    { n: nutritionistId, from: iso(now - 30 * DAY), to: iso(now + 365 * DAY) });
  const names = {};
  const nameOf = (id) => {
    if (!(id in names)) { try { names[id] = app.findRecordById("patients", id).getString("name"); } catch (_) { names[id] = "Paciente"; } }
    return names[id];
  };
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//AHT Fitness//Agenda//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:AHT Fitness — citas", "X-PUBLISHED-TTL:PT1H", "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  ];
  const dtstamp = stamp(iso(now));
  for (const a of appts) {
    const start = new Date(a.getString("starts_at").replace(" ", "T")).getTime();
    const end = start + a.getInt("duration_min") * 60000;
    const link = `${origin}/agenda.html?appt=${a.id}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${a.id}@aht-fitness`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${stamp(iso(start))}`,
      `DTEND:${stamp(iso(end))}`,
      `LAST-MODIFIED:${stamp(a.getString("updated"))}`,
      `SUMMARY:${esc(`Cita: ${nameOf(a.getString("patient"))} — ${a.getString("type")}`)}`,
      `DESCRIPTION:${esc(`Abrir en AHT Fitness: ${link}`)}`,
      `URL:${link}`,
      "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// Signed-in nutritionist or 401.
function nutritionist(e) {
  const auth = e.auth;
  if (!auth || auth.collection().name !== "nutritionists") throw new UnauthorizedError("Inicia sesión como nutrióloga o nutriólogo.");
  return auth;
}

function feedOf(app, nid) {
  try { return app.findFirstRecordByFilter("calendar_feeds", "nutritionist = {:n}", { n: nid }); } catch (_) { return null; }
}

module.exports = { feedText, nutritionist, feedOf, esc, fold };
