/// <reference path="../pb_data/types.d.ts" />
// Helper for feedback.pb.js (no ".pb." in the name, so PocketBase does not load it as a hook file).
// - feedback_at / feedback_edited are server-made (whatever the client sends is replaced)
// - stars are refused on progress photos (they rate the plate, not the body)
// - giving feedback marks the photo seen; clearing both comment and stars removes the feedback

function feedbackUpdate(e, withStars) {
  const body = e.requestInfo().body || {};
  const r = e.record;
  const before = r.original();
  if (!withStars && body.feedback_stars !== undefined) {
    throw new BadRequestError("Las fotos de progreso no llevan estrellas, solo comentario.");
  }
  // The client never sets these two.
  r.set("feedback_at", before.getString("feedback_at"));
  r.set("feedback_edited", before.getBool("feedback_edited"));

  const touched = body.feedback_text !== undefined || (withStars && body.feedback_stars !== undefined);
  if (touched) {
    const text = String(r.getString("feedback_text") || "").trim();
    r.set("feedback_text", text);
    const stars = withStars ? r.getInt("feedback_stars") : 0;
    const hadBefore = !!before.getString("feedback_at");
    const now = new Date().toISOString().replace("T", " ");
    if (!text && !stars) {
      r.set("feedback_at", "");        // removed
      r.set("feedback_edited", false);
    } else {
      const changed = text !== before.getString("feedback_text") || (withStars && stars !== before.getInt("feedback_stars"));
      if (changed || !hadBefore) {
        r.set("feedback_at", now);
        r.set("feedback_edited", hadBefore);
      }
      if (!r.getString("seen_at")) r.set("seen_at", now);
    }
  }
  e.next();
}

module.exports = { feedbackUpdate: feedbackUpdate };
