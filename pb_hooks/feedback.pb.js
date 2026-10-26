/// <reference path="../pb_data/types.d.ts" />
// Photo feedback (spec "Feature: Photo feedback"). Runs on every update of a meal or progress photo.
// The update rules already limit who can write (the patient's nutritionist, open account) and protect
// the photo itself; the helper in feedback_lib.js keeps the feedback fields consistent.
// (Hooks run in separate JS runtimes: helpers are required inside each handler.)

onRecordUpdateRequest((e) => {
  require(`${__hooks}/feedback_lib.js`).feedbackUpdate(e, true);
}, "meal_logs");

onRecordUpdateRequest((e) => {
  require(`${__hooks}/feedback_lib.js`).feedbackUpdate(e, false);
}, "progress_photos");
