// charts.js — the plate (signature) and the weight line. Inline SVG, colors from CSS tokens.
import { SLOT_LABEL, dateOnly } from './api.js';
import { shortDate, num } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
};

// slots: [{slot, done}] in day order. One slice per planned meal; a logged meal fills its slice.
export function plate(slots, size = 220) {
  const c = size / 2;
  const rim = c - 4;
  const r = rim * 0.8;
  const done = slots.filter((x) => x.done).length;
  const svg = s('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: 'plato-plate', role: 'img' });
  const label = slots.length
    ? `Plato de hoy: ${done} de ${slots.length} comidas registradas. ` + slots.map((x) => `${SLOT_LABEL[x.slot]}: ${x.done ? 'registrada' : 'pendiente'}`).join('. ')
    : 'Hoy no hay comidas en tu plan.';
  svg.append(Object.assign(s('title'), { textContent: label }));
  svg.append(s('circle', { cx: c, cy: c, r: rim, class: 'plate-rim' }));
  svg.append(s('circle', { cx: c, cy: c, r: rim - 10, class: 'plate-well' }));

  const n = slots.length;
  const gap = n > 1 ? 4 : 0; // degrees between slices
  slots.forEach((x, i) => {
    const a0 = -90 + (360 / n) * i + gap / 2;
    const a1 = -90 + (360 / n) * (i + 1) - gap / 2;
    const cls = `plate-slice plate-slice--${x.slot}${x.done ? ' is-done' : ''}`;
    if (n === 1) {
      svg.append(s('circle', { cx: c, cy: c, r, class: cls }));
      return;
    }
    const p = (a) => [c + r * Math.cos((a * Math.PI) / 180), c + r * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(a0);
    const [x1, y1] = p(a1);
    const large = a1 - a0 > 180 ? 1 : 0;
    svg.append(s('path', { d: `M${c},${c} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`, class: cls }));
  });

  svg.append(s('circle', { cx: c, cy: c, r: r * 0.42, class: 'plate-center' }));
  const big = s('text', { x: c, y: c + 2, class: 'plate-count', 'text-anchor': 'middle', 'dominant-baseline': 'middle' });
  big.textContent = n ? `${done}/${n}` : '—';
  svg.append(big);
  const small = s('text', { x: c, y: c + r * 0.24, class: 'plate-caption', 'text-anchor': 'middle' });
  small.textContent = n && done === n ? '¡completo!' : 'comidas';
  svg.append(small);
  return svg;
}

// measurements sorted by date ascending: [{date, weight_kg}]
export function weightChart(measurements, { width = 560, height = 220 } = {}) {
  const pts = measurements.filter((m) => m.weight_kg).map((m) => ({ d: dateOnly(m.date), w: m.weight_kg }));
  const wrap = document.createElement('figure');
  wrap.className = 'plato-chart';
  if (!pts.length) {
    wrap.append(Object.assign(document.createElement('p'), { className: 'plato-muted', textContent: 'Aún no hay mediciones.' }));
    return wrap;
  }
  const pad = { l: 44, r: 16, t: 16, b: 34 };
  const ws = pts.map((p) => p.w);
  let lo = Math.min(...ws), hi = Math.max(...ws);
  if (hi - lo < 2) { lo -= 1; hi += 1; }
  const t = pts.map((p) => new Date(p.d).getTime());
  const t0 = Math.min(...t), t1 = Math.max(...t);
  const X = (ms) => (t1 === t0 ? (pad.l + width - pad.r) / 2 : pad.l + ((ms - t0) / (t1 - t0)) * (width - pad.l - pad.r));
  const Y = (w) => pad.t + (1 - (w - lo) / (hi - lo)) * (height - pad.t - pad.b);

  const first = pts[0], last = pts[pts.length - 1];
  const diff = last.w - first.w;
  const summary = pts.length === 1
    ? `Peso: ${num(last.w)} kg el ${shortDate(last.d)}.`
    : `Peso de ${num(first.w)} kg (${shortDate(first.d)}) a ${num(last.w)} kg (${shortDate(last.d)}), ${diff <= 0 ? 'bajó' : 'subió'} ${num(Math.abs(diff))} kg.`;

  const svg = s('svg', { viewBox: `0 0 ${width} ${height}`, role: 'img', class: 'plato-chart-svg', preserveAspectRatio: 'xMidYMid meet' });
  svg.append(Object.assign(s('title'), { textContent: summary }));
  for (const w of [lo, (lo + hi) / 2, hi]) {
    svg.append(s('line', { x1: pad.l, x2: width - pad.r, y1: Y(w), y2: Y(w), class: 'chart-grid' }));
    const lab = s('text', { x: pad.l - 8, y: Y(w), class: 'chart-label', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
    lab.textContent = num(w);
    svg.append(lab);
  }
  if (pts.length > 1) {
    svg.append(s('polyline', { points: pts.map((p, i) => `${X(t[i])},${Y(p.w)}`).join(' '), class: 'chart-line' }));
  }
  pts.forEach((p, i) => svg.append(s('circle', { cx: X(t[i]), cy: Y(p.w), r: 4.5, class: 'chart-dot' })));
  const ends = pts.length === 1 ? [[0, 'middle']] : [[0, 'start'], [pts.length - 1, 'end']];
  for (const [i, anchor] of ends) {
    const lab = s('text', { x: X(t[i]), y: height - 10, class: 'chart-label', 'text-anchor': anchor });
    lab.textContent = shortDate(pts[i].d);
    svg.append(lab);
  }
  wrap.append(svg);
  const cap = document.createElement('figcaption');
  cap.textContent = summary;
  wrap.append(cap);
  return wrap;
}
