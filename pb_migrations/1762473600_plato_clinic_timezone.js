/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness: clinic time zone (spec "Feature: Appointment reminders + clinic time zone", slice 1).
// nutritionists.timezone: an IANA zone name ("America/Chihuahua"). Empty until the nutritionist's app fills it from
// the computer on the next open; changed in Ajustes. Appointments stay exact moments (UTC): nothing to convert.
// Patients already read their nutritionist's profile (shown only as the clinic-time note on their appointments).
// Undo (ask first): /pb/pocketbase migrate down 1

migrate((app) => {
  const c = app.findCollectionByNameOrId("nutritionists");
  c.fields.add(new TextField({ name: "timezone", max: 64, pattern: "^[A-Za-z]+(/[A-Za-z0-9_+-]+){0,2}$" }));
  app.save(c);
}, (app) => {
  const c = app.findCollectionByNameOrId("nutritionists");
  c.fields.removeByName("timezone");
  app.save(c);
});
