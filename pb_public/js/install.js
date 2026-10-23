// install.js — registers the service worker and drives the in-site "Instalar app" button.
// Markup: <button id="install-app" hidden>…</button> + <p id="install-help" hidden>…</p>.
// The patient app adds the button later, then fires "plato:install-ready".
(function () {
  if ('serviceWorker' in navigator) {
    var hadController = !!navigator.serviceWorker.controller;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/sw.js').then(function (reg) {
        document.addEventListener('visibilitychange', function () { if (!document.hidden) reg.update(); });
        setInterval(function () { reg.update(); }, 30 * 60 * 1000);
      }).catch(function () { /* http on a LAN IP: no service worker, the site still works online */ });
    });
    // A new release took over: reload once so this tab runs the new code.
    var reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (!hadController) { hadController = true; return; }
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  var installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  var ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent);
  var deferred = null;

  function els() { return { button: document.getElementById('install-app'), help: document.getElementById('install-help') }; }

  function refresh() {
    var e = els();
    if (!e.button) return;
    e.button.hidden = installed || !(deferred || ios);
    if (!e.button.dataset.wired) {
      e.button.dataset.wired = '1';
      e.button.addEventListener('click', function () {
        if (deferred) {
          deferred.prompt();
          deferred.userChoice.finally(function () { deferred = null; refresh(); });
          return;
        }
        if (e.help) e.help.hidden = false;
      });
    }
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferred = event;
    refresh();
  });
  window.addEventListener('appinstalled', function () {
    installed = true;
    deferred = null;
    var e = els();
    if (e.help) e.help.hidden = true;
    refresh();
  });
  document.addEventListener('plato:install-ready', refresh);
  document.addEventListener('DOMContentLoaded', refresh);
})();
