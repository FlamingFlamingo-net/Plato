/// <reference path="../pb_data/types.d.ts" />
// Plato security fixes from the pb-audit of 2026-10-23 (spec: "Security" section).
//  1. Only the invite link sets a patient's email: nutritionists cannot choose it (no signing in as the patient).
//  3. Nutritionists cannot switch on a patient's emailVisibility or change "verified".
//  2/4. Rate limits on: sign-in, invite links, sign-up, and the API as a whole.
// Undo (ask first): docker exec pocketbase /pb/pocketbase migrate down 1

const isNutri = '@request.auth.collectionName = "nutritionists"';
const ownsPatient = `${isNutri} && nutritionist = @request.auth.id`;
const lockedOnCreate = ["joined", "email", "emailVisibility", "verified"];
const lockedOnUpdate = ["nutritionist", "joined", "email", "emailVisibility", "verified", "password"];
const notSet = (fields) => fields.map((f) => `@request.body.${f}:isset = false`).join(" && ");

migrate((app) => {
  const patients = app.findCollectionByNameOrId("patients");
  patients.createRule = `${isNutri} && @request.body.nutritionist = @request.auth.id && ${notSet(lockedOnCreate)}`;
  patients.updateRule = `${ownsPatient} && ${notSet(lockedOnUpdate)}`;
  app.save(patients);

  const settings = app.settings();
  settings.rateLimits.enabled = true;
  settings.rateLimits.rules = [
    // Password guessing: 10 sign-in attempts per minute per address.
    { label: "*:auth", audience: "", duration: 60, maxRequests: 10 },
    // Invite links (check, join, new link): 20 per minute per address.
    { label: "/api/plato/", audience: "", duration: 60, maxRequests: 20 },
    // Sign-ups and other creates by guests.
    { label: "*:create", audience: "@guest", duration: 60, maxRequests: 10 },
    // Everything else: generous, only stops floods.
    { label: "/api/", audience: "", duration: 10, maxRequests: 300 },
  ];
  app.save(settings);
}, (app) => {
  const patients = app.findCollectionByNameOrId("patients");
  patients.createRule = `${isNutri} && @request.body.nutritionist = @request.auth.id && @request.body.joined:isset = false`;
  patients.updateRule = `${ownsPatient} && @request.body.nutritionist:isset = false && @request.body.joined:isset = false && @request.body.email:isset = false && @request.body.password:isset = false`;
  app.save(patients);
  const settings = app.settings();
  settings.rateLimits.enabled = false;
  app.save(settings);
});
