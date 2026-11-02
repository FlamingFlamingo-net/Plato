/// <reference path="../pb_data/types.d.ts" />
// Catalogue archive (spec "Feature: Archive and restore catalogue items"): archived_at is the server's time.
// Any non-empty value means "archive now"; "" restores. New items always start active.
// (Patients use their own close / reopen routes in plato.pb.js.)

onRecordCreateRequest((e) => {
  e.record.set("archived_at", "");
  e.next();
}, "diet_templates");

onRecordUpdateRequest((e) => {
  const r = e.record, o = r.original();
  const was = !!o.getString("archived_at"), is = !!r.getString("archived_at");
  if (is && !was) r.set("archived_at", new Date().toISOString().replace("T", " "));
  if (is && was) r.set("archived_at", o.getString("archived_at"));
  e.next();
}, "diet_templates");
