/// <reference path="../pb_data/types.d.ts" />
// Emails ignore capitals (spec "Fix: Emails ignore capitals").
// - every nutritionist/patient email is stored trimmed + lowercase, however it is saved (admin panel, invite, API)
// - sign-in finds the account whatever capitals are typed (also covers older cached copies of the app)
// (Hooks run in separate JS runtimes: everything is inside the handlers.)

onRecordCreate((e) => {
  const v = e.record.email();
  if (v) e.record.setEmail(String(v).trim().toLowerCase());
  e.next();
}, "nutritionists", "patients");

onRecordUpdate((e) => {
  const v = e.record.email();
  if (v && v !== String(v).trim().toLowerCase()) e.record.setEmail(String(v).trim().toLowerCase());
  e.next();
}, "nutritionists", "patients");

// PocketBase looks the email up letter for letter and leaves the record empty when nothing matches;
// then we look it up again in lowercase (stored emails are lowercase).
onRecordAuthWithPasswordRequest((e) => {
  if (!e.record && e.identity && (!e.identityField || e.identityField === "email")) {
    const lower = String(e.identity).trim().toLowerCase();
    if (lower !== e.identity) {
      try { e.record = e.app.findAuthRecordByEmail(e.collection, lower); } catch (_) { /* not found: normal failure */ }
    }
  }
  e.next();
}, "nutritionists", "patients");
