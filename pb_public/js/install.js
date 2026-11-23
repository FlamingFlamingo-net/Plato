// install.js — registers the service worker and drives the in-site "Instalar app" button.
// Markup: <button id="install-app" hidden>…</button> (index.html; the patient app adds it later, then fires "plato:install-ready").
// Android / desktop Chrome: the system install prompt. iPhone / iPad: websites cannot prompt, so the button opens a panel with
// Safari's own steps (spec "Design: iPhone 'Instalar app' panel"): iOS 26 layout, iOS 17-18 layout, or "solo desde Safari".
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

  var ua = window.navigator.userAgent;
  var installed = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  // iPadOS reports itself as a Mac: a Mac with a touch screen is an iPad.
  var ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var deferred = null;

  // Which steps? Other browsers and in-app browsers on iPhone cannot install (they lack "Safari/" or name themselves).
  function iosKind() {
    if (/CriOS|FxiOS|EdgiOS|OPiOS|Instagram|FBAN|FBAV|FB_IAB|Line\/|GSA\/|Snapchat|LinkedInApp|Twitter|WhatsApp/i.test(ua) || !/Safari\//.test(ua)) return 'other';
    var v = /Version\/(\d+)/.exec(ua);
    if (!v) return 'unknown';
    return Number(v[1]) >= 26 ? 'new' : 'old';
  }

  // Small line icons (ours, not Apple's images).
  var SVG = 'xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  var ICON = {
    more: '<svg ' + SVG + '><circle cx="12" cy="12" r="10"/><circle cx="7.5" cy="12" r=".6" fill="currentColor"/><circle cx="12" cy="12" r=".6" fill="currentColor"/><circle cx="16.5" cy="12" r=".6" fill="currentColor"/></svg>',
    share: '<svg ' + SVG + '><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/></svg>',
    add: '<svg ' + SVG + '><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
    toggle: '<svg ' + SVG + '><rect x="2" y="7" width="20" height="10" rx="5"/><circle cx="17" cy="12" r="3" fill="currentColor"/></svg>',
    done: '<svg ' + SVG + '><path d="M20 6 9 17l-5-5"/></svg>',
    safari: '<svg ' + SVG + '><circle cx="12" cy="12" r="10"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5z"/></svg>',
    link: '<svg ' + SVG + '><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
  };
  var STEPS = {
    new: [['more', 'Toca <b>•••</b> junto a la barra de dirección, abajo.'], ['share', 'Toca <b>Compartir</b> (el cuadro con la flecha hacia arriba).'],
      ['add', 'Toca <b>Agregar a inicio</b>. Si no lo ves, toca <b>Ver más</b>.'], ['toggle', 'Deja encendido <b>Abrir como app web</b> y toca <b>Agregar</b>.']],
    old: [['share', 'Toca <b>Compartir</b> en la barra de abajo (el cuadro con la flecha hacia arriba).'], ['add', 'Baja y toca <b>Agregar a inicio</b>.'], ['done', 'Toca <b>Agregar</b>.']],
    other: [['safari', 'La app solo se instala desde <b>Safari</b>. Copia el enlace con el botón de abajo.'], ['link', 'Abre <b>Safari</b>, pega el enlace en la barra de dirección y entra.'],
      ['add', 'Vuelve a tocar <b>Instalar app</b> y sigue los pasos.']],
  };

  var dialog = null, opener = null;
  function el(tag, attrs, html) {
    var n = document.createElement(tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (html != null) n.innerHTML = html;   // static text and icons only, never user data
    return n;
  }
  // kind: new | old | other | unknown (shows the iOS 26 steps plus a link to the older ones)
  function fill(kind) {
    var list = dialog.querySelector('.plato-install-steps');
    list.replaceChildren();
    STEPS[kind === 'unknown' ? 'new' : kind].forEach(function (s, i) {
      var li = el('li', {});
      li.append(el('span', { 'class': 'plato-install-num', 'aria-hidden': 'true' }, String(i + 1)), el('span', { 'class': 'plato-install-ico' }, ICON[s[0]]), el('span', {}, s[1]));
      list.append(li);
    });
    dialog.querySelector('.plato-install-older').hidden = kind !== 'unknown';
    dialog.querySelector('.plato-install-copy').hidden = kind !== 'other';
    dialog.querySelector('.plato-install-done').hidden = kind === 'other';
    dialog.dataset.kind = kind;
  }
  function panel() {
    if (dialog) return dialog;
    dialog = el('dialog', { 'class': 'dialog plato-install-dialog', id: 'install-panel', 'aria-labelledby': 'install-title' });
    var box = el('div', {});
    var head = el('header', {});
    head.append(el('h2', { id: 'install-title' }, 'Instala AHT Fitness en tu iPhone'), el('p', {}, 'Así la abres desde un ícono, como cualquier app. Toma un minuto.'));
    var sec = el('section', {});
    var older = el('button', { type: 'button', 'class': 'btn plato-install-older', 'data-variant': 'link', 'data-size': 'sm' }, '¿Tu iPhone es más antiguo? Ver esos pasos');
    older.addEventListener('click', function () { fill('old'); document.getElementById('install-ok').focus(); });
    var copy = el('button', { type: 'button', 'class': 'btn plato-install-copy', 'data-variant': 'outline' }, ICON.link + 'Copiar enlace');
    var copied = el('p', { 'class': 'plato-install-copied', role: 'status' });
    copy.addEventListener('click', function () {
      var url = location.origin + '/';
      var show = function (t) { copied.textContent = t + url; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(function () { show('Enlace copiado: '); }, function () { show('Copia este enlace: '); });
      else show('Copia este enlace: ');
    });
    sec.append(el('ol', { 'class': 'plato-install-steps' }), older, copy, copied,
      el('p', { 'class': 'plato-install-done' }, 'Listo: abre <b>AHT Fitness</b> desde el ícono de tu pantalla de inicio.'));
    var foot = el('footer', {});
    var ok = el('button', { type: 'button', 'class': 'btn', id: 'install-ok' }, 'Entendido');
    ok.addEventListener('click', function () { dialog.close(); });
    foot.append(ok);
    box.append(head, sec, foot);
    dialog.append(box);
    dialog.addEventListener('click', function (e) { if (e.target === dialog) dialog.close(); });   // tap outside
    dialog.addEventListener('close', function () { if (opener) opener.focus(); });
    document.body.append(dialog);
    return dialog;
  }
  function openPanel(button) {
    opener = button;
    panel();
    dialog.querySelector('.plato-install-copied').textContent = '';
    fill(iosKind());
    dialog.showModal();
    document.getElementById('install-ok').focus();
  }

  function refresh() {
    var button = document.getElementById('install-app');
    var oldHelp = document.getElementById('install-help');
    if (oldHelp) oldHelp.remove();   // the one-line hint is replaced by the panel
    if (!button) return;
    button.hidden = installed || !(deferred || ios);
    if (!button.dataset.wired) {
      button.dataset.wired = '1';
      if (ios) button.setAttribute('aria-haspopup', 'dialog');
      button.addEventListener('click', function () {
        if (deferred) {
          deferred.prompt();
          deferred.userChoice.finally(function () { deferred = null; refresh(); });
          return;
        }
        if (ios) openPanel(button);
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
    refresh();
  });
  document.addEventListener('plato:install-ready', refresh);
  document.addEventListener('DOMContentLoaded', refresh);
})();
