// menu.js — nutritionist header on phones: the links fold into one "Menú" button (spec "Design: Small-phone layouts").
// Progressive: the markup keeps every link; CSS (max-width 40rem) hides the row until the button opens it.
const header = document.querySelector('header.plato-top:has(.plato-report-link)');
const row = header?.querySelector(':scope > .plato-row');
if (header && row) {
  row.id = 'nav-menu';
  row.classList.add('plato-menu-row');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn plato-menu-btn';
  btn.dataset.variant = 'ghost';
  btn.dataset.size = 'sm';
  btn.setAttribute('aria-expanded', 'false');
  btn.setAttribute('aria-controls', 'nav-menu');
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg><span>Menú</span>';
  header.append(btn);

  // Mark the current page for the links that do not say so already.
  for (const a of row.querySelectorAll('a[href]')) {
    if (!a.hasAttribute('aria-current') && new URL(a.href).pathname === location.pathname) a.setAttribute('aria-current', 'page');
  }

  const set = (open, refocus = false) => {
    header.toggleAttribute('data-menu-open', open);
    btn.setAttribute('aria-expanded', String(open));
    if (!open && refocus) btn.focus();
  };
  btn.addEventListener('click', () => set(!header.hasAttribute('data-menu-open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && header.hasAttribute('data-menu-open')) set(false, true); });
  document.addEventListener('click', (e) => { if (header.hasAttribute('data-menu-open') && !header.contains(e.target)) set(false); });
  row.addEventListener('click', (e) => { if (e.target.closest('a')) set(false); });
  // Leaving the phone layout (rotate / resize) closes it so nothing stays open invisibly.
  matchMedia('(min-width: 40.01rem)').addEventListener('change', (e) => { if (e.matches) set(false); });
}
