/// <reference path="../pb_data/types.d.ts" />
// "Reportar un problema" (spec "Feature: Reportar un problema"): what the collection rules cannot express.
// - text trimmed; page/version/browser cut to their limits; status always starts as "nuevo"
// - contact details only when contact_ok is on: then a phone or an email is required; phone -> digits (+ optional)
// - at most 10 reports per nutritionist in 24 h
// (Hooks run in separate JS runtimes: everything is inside the handler.)

onRecordCreateRequest((e) => {
  const r = e.record;
  const cut = (v, n) => String(v || "").trim().slice(0, n);
  r.set("description", String(r.getString("description") || "").trim());
  r.set("page", cut(r.getString("page"), 200));
  r.set("app_version", cut(r.getString("app_version"), 20));
  r.set("user_agent", cut(r.getString("user_agent"), 400));
  r.set("status", "nuevo");

  if (r.getBool("contact_ok")) {
    const raw = String(r.getString("contact_phone") || "").trim();
    const phone = raw ? (raw.startsWith("+") ? "+" : "") + raw.replace(/[^0-9]/g, "") : "";
    const email = String(r.getString("contact_email") || "").trim().toLowerCase();
    if (!phone && !email) throw new BadRequestError("Escribe un teléfono o un correo para que te contactemos.");
    if (phone && !/^\+?[0-9]{10,15}$/.test(phone)) throw new BadRequestError("El teléfono debe tener de 10 a 15 dígitos (puede empezar con +).");
    r.set("contact_phone", phone);
    r.set("contact_email", email);
  } else {
    r.set("contact_phone", "");
    r.set("contact_email", "");
  }

  const since = new Date(Date.now() - 24 * 3600e3).toISOString().replace("T", " ");
  const recent = e.app.findRecordsByFilter("issue_reports", "nutritionist = {:n} && created >= {:since}", "", 10, 0,
    { n: r.getString("nutritionist"), since });
  if (recent.length >= 10) throw new BadRequestError("Llegaste al límite de 10 reportes en 24 horas. Intenta mañana.");
  e.next();
}, "issue_reports");
