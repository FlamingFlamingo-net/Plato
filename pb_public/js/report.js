// report.js — "Reportar un problema" (spec "Feature: Reportar un problema"): a nutritionist reports a problem to the
// owner, who reads it in the admin panel. Up to 3 images; contact details only when allowed.
import { requireRole, list, request, signOut } from './api.js';
import { h, toast, busy, offlineBanner, shortDate, timeOf } from './ui.js';
import { shrink } from './photo.js';

offlineBanner();
const me = await requireRole('nutritionists');
document.getElementById('who').textContent = me.name;
document.getElementById('sign-out').addEventListener('click', signOut);

const MAX_IMAGES = 3, MAX_BYTES = 5 * 1024 * 1024, TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const STATUS = { nuevo: ['Nuevo', 'secondary'], en_revision: ['En revisión', 'outline'], resuelto: ['Resuelto', null] };
const form = document.getElementById('report-form');
const desc = document.getElementById('r-desc');
const contact = document.getElementById('r-contact');
const phone = document.getElementById('r-phone');
const email = document.getElementById('r-email');
const imageIn = document.getElementById('r-image');
const thumbs = document.getElementById('thumbs');
const addLabel = document.getElementById('add-image-label');

// ---------- Context sent with the report (shown, not hidden) ----------
// The page they came from: only its path (no ids or names).
let page = '';
try { const r = new URL(document.referrer); if (r.origin === location.origin && r.pathname !== location.pathname) page = r.pathname; } catch { /* typed or opened directly */ }
if (page) document.getElementById('back').href = page;
let appVersion = '';
const ua = navigator.userAgent;
const browserName = () => {
  const m = ua.match(/(Edg|OPR|Chrome|CriOS|Firefox|FxiOS|Version)\/([\d.]+)/);
  const os = /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
  const name = !m ? 'Navegador' : { Edg: 'Edge', OPR: 'Opera', CriOS: 'Chrome', FxiOS: 'Firefox', Version: 'Safari' }[m[1]] || m[1];
  return `${name}${m ? ` ${m[2].split('.')[0]}` : ''}${os ? ` · ${os}` : ''}`;
};
document.getElementById('ctx-page').textContent = page || 'Abierto directamente';
document.getElementById('ctx-browser').textContent = browserName();
document.getElementById('ctx-date').textContent = `${shortDate(new Date().toISOString().slice(0, 10))}, al enviar`;
fetch('/sw.js', { cache: 'no-store' }).then((r) => r.text()).then((t) => {
  appVersion = (t.match(/VERSION = '([^']+)'/) || [])[1] || '';
  document.getElementById('ctx-version').textContent = appVersion.replace('plato-', '') || '—';
}).catch(() => {});

// ---------- Description ----------
const count = document.getElementById('r-desc-count');
desc.addEventListener('input', () => { count.textContent = String(desc.value.length); if (desc.getAttribute('aria-invalid')) fieldError('r-desc', ''); });

// ---------- Images (up to 3; big photos are reduced, small ones sent as they are so text stays sharp) ----------
const images = [];   // { blob, name, url }
function renderThumbs() {
  thumbs.replaceChildren(...images.map((img, i) => h('li', {},
    h('img', { src: img.url, alt: `Imagen ${i + 1}`, width: 96, height: 96 }),
    h('button', { class: 'btn', 'data-variant': 'ghost', 'data-size': 'sm', type: 'button', 'aria-label': `Quitar imagen ${i + 1}`,
      onclick: () => { URL.revokeObjectURL(img.url); images.splice(i, 1); renderThumbs(); imageIn.focus(); } }, 'Quitar'))));
  const full = images.length >= MAX_IMAGES;
  imageIn.disabled = full;
  addLabel.toggleAttribute('aria-disabled', full);
  addLabel.querySelector('span').textContent = full ? 'Máximo 3 imágenes' : 'Agregar imagen';
}
imageIn.addEventListener('change', async () => {
  const file = imageIn.files[0];
  imageIn.value = '';
  if (!file) return;
  fieldError('r-image', '');
  if (images.length >= MAX_IMAGES) return fieldError('r-image', 'Puedes agregar hasta 3 imágenes.');
  if (!TYPES.includes(file.type)) return fieldError('r-image', 'Ese archivo no es una imagen JPG, PNG o WebP.');
  let blob = file, name = file.name || 'imagen';
  if (file.size > MAX_BYTES) {
    try { blob = await shrink(file, 2400); name = name.replace(/\.\w+$/, '') + '.jpg'; } catch { return fieldError('r-image', 'No pudimos leer esa imagen. Prueba con otra.'); }
    if (blob.size > MAX_BYTES) return fieldError('r-image', 'La imagen pesa demasiado (máx. 5 MB).');
  }
  images.push({ blob, name, url: URL.createObjectURL(blob) });
  renderThumbs();
});

// ---------- Contact ----------
contact.addEventListener('change', () => {
  const on = contact.checked;
  document.getElementById('contact-fields').hidden = !on;
  if (on) {
    if (!phone.value && me.whatsapp) phone.value = me.whatsapp;
    if (!email.value && me.email) email.value = me.email;
  } else { for (const id of ['r-phone', 'r-email', 'r-contact']) fieldError(id, ''); }
});
const normPhone = (v) => { const s = v.trim(); return s ? (s.startsWith('+') ? '+' : '') + s.replace(/[^0-9]/g, '') : ''; };

// ---------- Errors next to each field ----------
function fieldError(id, message) {
  const el = document.getElementById(`${id}-error`);
  el.textContent = message; el.hidden = !message;
  const input = document.getElementById(id);
  if (input && input.tagName !== 'P') { if (message) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid'); }
  return !message;
}
function validate() {
  const errs = [];
  const d = desc.value.trim();
  if (!fieldError('r-desc', d.length < 10 ? 'Cuéntanos un poco más (mínimo 10 caracteres).' : d.length > 2000 ? 'Máximo 2,000 caracteres.' : '')) errs.push(desc);
  for (const id of ['r-phone', 'r-email', 'r-contact']) fieldError(id, '');
  if (contact.checked) {
    const p = normPhone(phone.value), m = email.value.trim();
    if (!p && !m) { fieldError('r-contact', 'Escribe un teléfono o un correo para que te contactemos.'); phone.setAttribute('aria-invalid', 'true'); errs.push(phone); }
    if (p && !/^\+?[0-9]{10,15}$/.test(p)) { fieldError('r-phone', 'De 10 a 15 dígitos (puede empezar con +).'); errs.push(phone); }
    if (m && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(m)) { fieldError('r-email', 'Escribe un correo válido.'); errs.push(email); }
  }
  errs[0]?.focus();
  return !errs.length;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validate()) return;
  const fd = new FormData();
  fd.append('nutritionist', me.id);
  fd.append('description', desc.value.trim());
  fd.append('page', page);
  fd.append('app_version', appVersion);
  fd.append('user_agent', ua.slice(0, 400));
  fd.append('contact_ok', String(contact.checked));
  if (contact.checked) { fd.append('contact_phone', normPhone(phone.value)); fd.append('contact_email', email.value.trim().toLowerCase()); }
  for (const img of images) fd.append('images', img.blob, img.name);
  try {
    await busy(document.getElementById('send'), () => request('/api/collections/issue_reports/records', { method: 'POST', form: fd }));
  } catch (err) {
    toast(err.status === 0 ? 'Sin conexión. Tu reporte no se envió.' : err.message, 'error');
    if (err.data?.images) fieldError('r-image', err.message);
    return;
  }
  const askedContact = contact.checked;
  form.reset(); count.textContent = '0';
  for (const img of images) URL.revokeObjectURL(img.url);
  images.length = 0; renderThumbs();
  document.getElementById('contact-fields').hidden = true;
  const sent = document.getElementById('sent');
  document.getElementById('sent-sub').textContent = askedContact ? 'Te contactaremos si hace falta.' : 'Lo revisaremos pronto.';
  sent.hidden = false; sent.focus();
  loadMine();
});

// ---------- Tus reportes ----------
async function loadMine() {
  const status = document.getElementById('mine-status');
  let rows;
  try { rows = await list('issue_reports', { sort: '-created', perPage: 50, fields: 'id,description,images,status,created' }); }
  catch (e) { status.textContent = e.message; return; }
  status.textContent = rows.length ? '' : 'Aún no has enviado reportes.';
  status.hidden = !rows.length ? false : true;
  document.getElementById('mine').replaceChildren(...rows.map((r) => {
    const [label, variant] = STATUS[r.status] || STATUS.nuevo;
    const first = r.description.split('\n')[0];
    const n = (r.images || []).length;
    return h('li', { class: 'plato-report-item' },
      h('div', { class: 'plato-row plato-row--between' },
        h('span', { class: 'plato-muted plato-small', text: `${shortDate(r.created)} · ${timeOf(r.created)}${n ? ` · ${n} ${n === 1 ? 'imagen' : 'imágenes'}` : ''}` }),
        h('span', { class: 'badge', 'data-variant': variant, text: label })),
      h('p', { text: first.length > 80 ? `${first.slice(0, 80)}…` : first }));
  }));
}
loadMine();
