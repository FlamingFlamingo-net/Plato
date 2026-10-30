/// <reference path="../pb_data/types.d.ts" />
// Snacks per diet (spec "Feature: Snacks per diet"): a new diet or template without a snack number gets 2.
// (A number field can't tell "not sent" from 0, so the default lives here, on create only.)

onRecordCreateRequest((e) => {
  const body = e.requestInfo().body || {};
  if (body.snacks === undefined || body.snacks === null || body.snacks === "") e.record.set("snacks", 2);
  e.next();
}, "diets", "diet_templates");
