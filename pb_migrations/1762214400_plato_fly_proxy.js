/// <reference path="../pb_data/types.d.ts" />
// AHT Fitness online (Fly.io): sign-in limits must count each user's real address.
// Behind Fly's proxy every request comes from the proxy; Fly puts the user's address in "Fly-Client-IP".
// Only trusted when actually running on Fly (FLY_APP_NAME is set there): on any other box a client could
// send that header itself and dodge the limits. Locally this migration changes nothing.
// Undo (ask first): /pb/pocketbase migrate down 1

migrate((app) => {
  if (!$os.getenv("FLY_APP_NAME")) return;
  const settings = app.settings();
  settings.trustedProxy.headers = ["Fly-Client-IP"];
  settings.trustedProxy.useLeftmostIP = false;
  app.save(settings);
}, (app) => {
  const settings = app.settings();
  settings.trustedProxy.headers = [];
  app.save(settings);
});
