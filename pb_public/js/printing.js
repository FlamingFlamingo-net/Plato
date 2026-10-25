// printing.js — shared helpers for the print pages (weekly diet sheet, patient export).
import { requireRole, session } from './api.js';

// Wait for fonts, every image and two frames, then open the print dialog.
export async function printDocument() {
  await document.fonts.ready;
  await Promise.all([...document.images].filter((i) => i.src).map((i) => i.decode().catch(() => {})));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.print();
}

// Either role may open a print page. Returns {role, me}.
export async function requireAnyRole() {
  const s = session();
  const role = s?.collection === 'patients' ? 'patients' : 'nutritionists';
  return { role, me: await requireRole(role) };
}

// Small decorative plate for the sheet header (the product's signature), all slices filled.
export function miniPlate(size = 40) {
  const c = size / 2, r = c * 0.78;
  const slots = ['breakfast', 'snack_am', 'lunch', 'snack_pm', 'dinner'];
  const p = (a) => [c + r * Math.cos((a * Math.PI) / 180), c + r * Math.sin((a * Math.PI) / 180)];
  const slices = slots.map((s, i) => {
    const a0 = -90 + 72 * i + 2, a1 = -90 + 72 * (i + 1) - 2;
    const [x0, y0] = p(a0), [x1, y1] = p(a1);
    return `<path d="M${c},${c} L${x0},${y0} A${r},${r} 0 0 1 ${x1},${y1} Z" style="fill:var(--slot-${s})"/>`;
  }).join('');
  const span = document.createElement('span');
  span.className = 'sheet-plate';
  span.setAttribute('aria-hidden', 'true');
  // Static, trusted SVG (no data).
  span.innerHTML = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}"><circle cx="${c}" cy="${c}" r="${c - 1}" style="fill:var(--plate-rim);stroke:var(--border)"/>${slices}<circle cx="${c}" cy="${c}" r="${r * 0.4}" style="fill:#fff"/></svg>`;
  return span;
}

const df = new Intl.DateTimeFormat('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
export const printedOn = () => `Impreso el ${df.format(new Date())}`;
